/** The routing decision for one turn, and the model a built-in subagent type gets. Pure. */
import type { AutorouteRoute } from '../types'
import { CELLS, engineEffortOf, modelAtTier, tierOf } from './catalog.ts'
import type { Effort, ModelId, TaskClass } from './catalog.ts'
import { classify, isConfident } from './classify.ts'
import { estimateTurnCost, isCacheWarm } from './cost.ts'
import type { LastUse } from './cost.ts'
import { extract } from './features.ts'

export type Mode = 'auto' | 'off' | 'pinned'
export type Source = 'override' | 'rules' | 'fallback' | 'none'
export type Route = AutorouteRoute

export type PolicyInput = {
  mode: Mode
  pinned?: ModelId
  /** The session's own model. */
  base: ModelId
  /** The sticky route; absent while the session runs on `base`. */
  route?: Route
  override?: ModelId
  /** A confident class only; absent on an abstain. */
  cls?: TaskClass
  source: Source
  isTriggered: boolean
  contextTokens: number
  nowMs: number
  lastUse: Readonly<Partial<Record<ModelId, LastUse>>>
  unavailable: readonly ModelId[]
  savingMargin: number
  cacheTtlMinutes: number
}

export type Decision = {
  /** The rule of spec section 4.5 that decided; 0 when the mod could not decide at all. */
  rule: number
  /** What this turn is sent to and what stays for later turns; absent means `base`, unrewritten. */
  route: Route | undefined
  resetsFailures: boolean
  estimates?: { stay: number; move: number }
}

const routeTo = (model: ModelId, base: ModelId, extra: Omit<Route, 'model'> = {}): Route | undefined =>
  model === base ? undefined : { model, ...extra }

export const decide = (input: PolicyInput): Decision => {
  const { base } = input
  const current = input.route?.model ?? base
  const isUsable = (model: ModelId): boolean => !input.unavailable.includes(model)
  const keep = (rule: number, resetsFailures = false): Decision => ({ rule, route: input.route, resetsFailures })

  if (input.mode === 'off') return { rule: 1, route: undefined, resetsFailures: false }
  if (input.mode === 'pinned') {
    // A pinned model that stopped answering is not sent to; pinning it again retries it.
    const pinned = input.pinned && isUsable(input.pinned) ? input.pinned : undefined
    return { rule: 2, route: pinned ? routeTo(pinned, base) : undefined, resetsFailures: false }
  }

  if (input.override)
    return isUsable(input.override) ? { rule: 3, route: routeTo(input.override, base), resetsFailures: false } : keep(3)

  if (input.isTriggered) {
    if (tierOf(current) < tierOf(base)) return { rule: 4, route: undefined, resetsFailures: true }
    const above = modelAtTier(tierOf(current) + 1)
    return above && isUsable(above.id) ? { rule: 5, route: routeTo(above.id, base), resetsFailures: true } : keep(5, true)
  }

  if (!input.cls) return keep(10)

  const cell = CELLS[input.cls]
  const wanted = cell.isHard && tierOf(cell.model) < tierOf(base) ? base : cell.model
  if (wanted === current) {
    // Same model, new class: the label follows the work, the effort stays as it was sent.
    const relabelled = input.route && input.route.cls !== input.cls ? { ...input.route, cls: input.cls } : input.route
    return { rule: 6, route: relabelled, resetsFailures: false }
  }
  if (!isUsable(wanted)) return keep(10)

  const route = routeTo(wanted, base, { effort: cell.effort, cls: input.cls })

  if (tierOf(wanted) > tierOf(current)) {
    if (tierOf(wanted) <= tierOf(base)) return { rule: 7, route, resetsFailures: false }
    return cell.isHard ? { rule: 8, route, resetsFailures: false } : keep(8)
  }

  const shape = { contextTokens: input.contextTokens, requests: cell.requests, outputTokens: cell.outputTokens }
  const isWarm = (model: ModelId): boolean =>
    isCacheWarm(input.lastUse[model], input.contextTokens, input.nowMs, input.cacheTtlMinutes)
  const estimates = {
    stay: estimateTurnCost(current, shape, isWarm(current)),
    move: estimateTurnCost(wanted, shape, isWarm(wanted)),
  }

  return estimates.move < estimates.stay * (1 - input.savingMargin)
    ? { rule: 9, route, resetsFailures: false, estimates }
    : { ...keep(9), estimates }
}

/**
 * The effort a rewritten request carries; undefined leaves it as the engine
 * set it. A route a class chose has its own. Any other route (an override, a
 * trigger, a pin) keeps what the person chose; but when the request only
 * carries the engine's default for the session's model, that default is
 * swapped for the one of the model the request now goes to.
 */
export const effortToSend = (route: Route, base: ModelId, asked: Effort | number | undefined): Effort | undefined => {
  if (route.effort) return route.effort
  return asked === engineEffortOf(base) ? engineEffortOf(route.model) : undefined
}

/**
 * The model a built-in subagent type is started on; undefined leaves the
 * choice to the caller. A subagent starts with an empty context, so no cost
 * check applies, and only the rules are asked, never the fallback.
 */
export const subagentModelFor = (subagentType: string, prompt: string): ModelId | undefined => {
  if (subagentType === 'Explore') return 'claude-haiku-5-5'
  if (subagentType !== 'general-purpose' && subagentType !== 'claude') return undefined

  const read = classify(extract(prompt))
  if (!isConfident(read)) return undefined
  if (read.cls === 'research' || read.cls === 'trivial-edit') return 'claude-haiku-5-5'
  if (read.cls === 'impl-standard' || read.cls === 'impl-mechanical' || read.cls === 'debug-repro')
    return 'claude-sonnet-5-5'

  return undefined
}
