import { atom, read, update } from 'claude-code'
import type { Register, StateDollar } from 'claude-code'

import type { AutorouteDecision, AutorouteSession } from '../types'
import { modelByAlias, modelById, tierOf, toCatalogId } from './catalog.ts'
import type { ModelId, TaskClass } from './catalog.ts'
import { classify, isConfident } from './classify.ts'
import { MIN_WORDS, buildFallbackRequest, parseLabel } from './fallback.ts'
import { detectOverride, didTestRunFail, extract, isTestCommand } from './features.ts'
import { decide, effortToSend, subagentModelFor } from './policy.ts'
import type { Decision, Route, Source } from './policy.ts'
import { readSettings } from './settings.ts'

const INITIAL: AutorouteSession = { mode: 'auto', turns: 0, failingTests: 0, lastUse: {}, unavailable: [], decisions: [] }
const session = atom({ plugin: 'autoroute', key: 'session' } as const, INITIAL)

/** The mod could not decide: the request goes out as the engine made it. */
const UNDECIDED: Decision = { rule: 0, route: undefined, resetsFailures: false }

const dropRoute = ({ route: _route, ...rest }: AutorouteSession): AutorouteSession => rest
const dropPinned = ({ pinned: _pinned, ...rest }: AutorouteSession): AutorouteSession => rest
const aliasOf = (model: string): string => modelById(model)?.alias ?? model

const routeText = (s: AutorouteSession): string | undefined =>
  s.route &&
  `${aliasOf(s.route.model)}${s.route.effort ? ` · ${s.route.effort}` : ''}${s.route.cls ? ` (${s.route.cls})` : ''}`

/** The status line: the active route, or nothing while the session runs on its own model. */
const statusOf = (s: AutorouteSession): string | undefined => {
  if (s.mode === 'off') return undefined
  // A session model outside the catalog is never rerouted, pinned or not.
  if (s.base !== undefined && !toCatalogId(s.base)) return undefined
  if (s.mode === 'pinned')
    return s.pinned && `route: ${aliasOf(s.pinned)} (pinned${s.unavailable.includes(s.pinned) ? ', not answering' : ''})`
  const text = routeText(s)
  return text && `route: ${text}`
}

/** The route the state holds right now, with nothing decided anew. */
const heldRoute = (s: AutorouteSession, base: ModelId): Route | undefined => {
  const isPinUsable = s.pinned !== undefined && !s.unavailable.includes(s.pinned)
  const held = s.mode === 'auto' ? s.route : s.mode === 'pinned' && s.pinned && isPinUsable ? { model: s.pinned } : undefined
  return held && held.model !== base ? held : undefined
}

const usd = (amount: number): string => `$${amount.toFixed(4)}`

/** What `/route` prints: mode, session model, route, and the last ten decisions. */
const reportOf = (s: AutorouteSession): string => {
  const base =
    s.base === undefined ? 'not seen yet' : toCatalogId(s.base) ? s.base : `${s.base} (not in the catalog; not routing)`

  return [
    `mode: ${s.mode}${s.mode === 'pinned' && s.pinned ? ` (${s.pinned})` : ''}`,
    `base: ${base}`,
    `route: ${routeText(s) ?? 'none (on the session model)'}`,
    ...s.decisions.map(
      d =>
        `turn ${d.turn}: rule ${d.rule}, ${d.source}${d.cls ? `, ${d.cls}` : ''} -> ${d.model}` +
        (d.stay !== undefined && d.move !== undefined ? ` (stay ${usd(d.stay)}, move ${usd(d.move)})` : ''),
    ),
  ].join('\n')
}

// A test run that fails twice in a row is the "stuck" signal of rule 5.
// Only the main loop's own runs count: a subagent's are its own business.
const countTestRun = async ($: StateDollar, command: string, hasFailed: boolean): Promise<void> => {
  if (!isTestCommand(command)) return
  await update($, session, s => ({ ...s, failingTests: hasFailed ? s.failingTests + 1 : 0 }))
}

export const register: Register = (on, options) => {
  const { useFallback, savingMargin, cacheTtlMinutes } = readSettings(options)

  // Per-turn memory. A reload loses it, which costs one unrouted turn.
  const prompts = new Map<string, string>()
  const decided = new Map<string, Decision>()
  const answeredBy = new Map<string, Map<ModelId, number>>()
  let lastContextTokens: number | undefined

  on('turn.start', (_$, e, next) => {
    prompts.set(e.turnId, e.text)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    // The decision is made once, in the turn's first main-loop step, inside
    // this dispatch: a `$` call made after its own dispatch ended is not
    // guaranteed to be honoured, so nothing is started in `turn.start`.
    const settle = async (): Promise<Decision> => {
      // `e.model` is what the engine resolved for this step. When the engine
      // itself fell back to another model (the session's was overloaded), that
      // model is taken as the session's for this turn: the mod cannot tell.
      const base = toCatalogId(e.model)
      const s = await read($, session)
      if (!base) {
        if (s.base !== e.model) await update($, session, now => ({ ...now, base: e.model }))
        return UNDECIDED
      }

      // No prompt on record and not the turn's first step: the module was
      // reloaded mid-turn. Carry on with the route the state holds, so the
      // model does not change between steps, and decide nothing anew.
      if (!prompts.has(e.turnId) && e.index > 0) return { rule: 0, route: heldRoute(s, base), resetsFailures: false }

      const text = prompts.get(e.turnId) ?? ''
      const features = extract(text, s.failingTests)
      let override: ModelId | undefined
      let cls: TaskClass | undefined
      let source: Source = 'none'

      if (s.mode === 'auto') {
        const alias = detectOverride(text)
        override = alias ? modelByAlias(alias)?.id : undefined
        const byRules = classify(features)
        if (override) {
          source = 'override'
        } else if (isConfident(byRules)) {
          cls = byRules.cls
          source = 'rules'
        } else if (useFallback && features.words >= MIN_WORDS) {
          const reply = await $.model.complete(buildFallbackRequest(text)).catch(() => undefined)
          cls = reply?.isAnswered ? parseLabel(reply.text) : undefined
          if (cls) source = 'fallback'
        }
      }

      const usage = lastContextTokens === undefined ? await $.session.usage().catch(() => undefined) : undefined
      const made = decide({
        mode: s.mode,
        pinned: s.pinned,
        base,
        route: s.route,
        override,
        cls,
        source,
        isTriggered: s.mode === 'auto' && (s.failingTests >= 2 || (features.stillBroken && s.turns > 0)),
        contextTokens: lastContextTokens ?? usage?.context.tokens ?? 0,
        nowMs: await $.clock.now(),
        lastUse: s.lastUse,
        unavailable: s.unavailable,
        savingMargin,
        cacheTtlMinutes,
      })

      const entry: AutorouteDecision = {
        turn: s.turns + 1,
        rule: made.rule,
        source,
        model: made.route?.model ?? base,
        ...(cls ? { cls } : {}),
        ...(made.estimates ? { stay: made.estimates.stay, move: made.estimates.move } : {}),
      }
      await update($, session, now => {
        // Off and pinned leave the automatic route as it was, for when `auto` returns.
        const kept = now.mode !== 'auto' ? now : made.route ? { ...now, route: made.route } : dropRoute(now)
        return {
          ...kept,
          base: e.model,
          failingTests: made.resetsFailures ? 0 : kept.failingTests,
          decisions: [...kept.decisions, entry].slice(-10),
        }
      })

      return made
    }

    let decision = decided.get(e.turnId)
    if (!decision) {
      decision = await settle().catch(() => UNDECIDED)
      decided.set(e.turnId, decision)
    }

    const route = decision.route
    const sessionModel = toCatalogId(e.model)
    const effort = route && sessionModel ? effortToSend(route, sessionModel, e.effort) : undefined
    const result = yield* next(route ? { ...e, model: route.model, ...(effort ? { effort } : {}) } : e)

    if (result.usage) {
      const contextTokens =
        result.usage.input_tokens + result.usage.cache_read_input_tokens + result.usage.cache_creation_input_tokens
      lastContextTokens = contextTokens
      const model = toCatalogId(result.usage.model)
      if (model) {
        const seen = answeredBy.get(e.turnId) ?? new Map<ModelId, number>()
        seen.set(model, contextTokens)
        answeredBy.set(e.turnId, seen)
      }
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done

    const seen = answeredBy.get(e.turnId)
    const routed = decided.get(e.turnId)?.route?.model
    // The turn died before any response while it was routed: stop using that
    // model this session. A transient API error is misread the same way; the
    // price is one model left unused until the next session.
    const failed = e.reason === 'error' && seen === undefined ? routed : undefined
    prompts.delete(e.turnId)
    decided.delete(e.turnId)
    answeredBy.delete(e.turnId)

    try {
      const atMs = await $.clock.now()
      const used: AutorouteSession['lastUse'] = {}
      for (const [model, contextTokens] of seen ?? []) used[model] = { atMs, contextTokens }
      await update($, session, s => {
        const counted = { ...s, turns: s.turns + 1, lastUse: { ...s.lastUse, ...used } }
        if (!failed) return counted
        const marked = {
          ...counted,
          unavailable: counted.unavailable.includes(failed) ? counted.unavailable : [...counted.unavailable, failed],
        }
        return marked.route?.model === failed ? dropRoute(marked) : marked
      })
      if (failed) $.ui.toast(`autoroute: ${failed} did not answer; not routing to it again this session.`)
      $.ui.status(statusOf(await read($, session)))
    } catch {
      // Bookkeeping only: the turn has already ended as it should.
    }

    return done
  })

  // A denied command never ran, so it says nothing about the tests either way.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined)
      await countTestRun($, e.command, didTestRunFail(ran.isError === true, ran.text ?? '')).catch(() => {})
    return ran
  })

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined)
      await countTestRun($, e.command, didTestRunFail(ran.isError === true, ran.text ?? '')).catch(() => {})
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    // A fork, a teammate, a workflow agent, a spawn that names a model, and
    // a plugin's own agent type each already have their model.
    const isOurs =
      !e.fork && !e.isTeammate && e.workflow === undefined && e.model === undefined && e.provider.plugin === 'engine'
    if (!isOurs) return next(e)

    const pick = async (): Promise<ModelId | undefined> => {
      const base = toCatalogId(e.parentModel)
      const s = await read($, session)
      if (!base || s.mode === 'off') return undefined

      // Pinned means pinned: nothing is classified, the subagent follows the pin.
      const wanted =
        s.mode === 'pinned' ? s.pinned : (subagentModelFor(e.subagentType, e.prompt) ?? s.route?.model)
      if (!wanted || wanted === base || s.unavailable.includes(wanted)) return undefined

      return tierOf(wanted) > tierOf(base) ? undefined : wanted
    }

    const model = await pick().catch(() => undefined)
    return model ? next({ ...e, model }) : next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Show or set model routing: /route [off | auto | pin <haiku|sonnet|opus|fable>]',
    })
    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)

    if (verb === 'off' || verb === 'auto') {
      const mode = verb === 'off' ? ('off' as const) : ('auto' as const)
      await update($, session, s => ({ ...dropPinned(s), mode }))
    } else if (verb === 'pin') {
      const model = modelByAlias(arg)
      if (!model) return { text: `autoroute: unknown model "${arg}". Use haiku, sonnet, opus or fable.` }
      // Pinning a model again is how a person retries one that stopped answering.
      await update($, session, s => ({
        ...s,
        mode: 'pinned' as const,
        pinned: model.id,
        unavailable: s.unavailable.filter(id => id !== model.id),
      }))
    } else if (verb !== '') {
      return { text: 'autoroute: use /route, /route off, /route auto, or /route pin <haiku|sonnet|opus|fable>.' }
    }

    const s = await read($, session)
    $.ui.status(statusOf(s))

    return { text: reportOf(s) }
    // A hook that fails is skipped, and this command has nothing beneath it:
    // without an answer here the person would see nothing at all.
  }).catch(() => ({ text: 'autoroute: /route failed and changed nothing. Try again.' }))
}
