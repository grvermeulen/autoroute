/** What the tests put beneath the mod: the engine's side of each event, recorded. */
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** Reads a streamed event to its end and answers its result. */
export const drain = async <C, R>(stream: AsyncGenerator<C, R>): Promise<R> => {
  let step = await stream.next()
  while (!step.done) step = await stream.next()
  return step.value
}

export type World = {
  /** One line per model request: `<agentId or main>:<model>:<effort>`. */
  sent: string[]
  status: (string | undefined)[]
  toasts: string[]
  /** The prompt of each fallback call. */
  asked: string[]
  /** The model each subagent was started with; `inherit` when none was named. */
  spawned: string[]
  commands: string[]
  clock: MockClock
  set: {
    /** What the fallback model replies. */
    label: string
    /** False: the fallback call comes back unanswered. */
    isAnswered: boolean
    /** Cached context every response reports. */
    contextTokens: number
    /** True: a tool call comes back errored. */
    toolFails: boolean
    /** True: a tool call is refused before it runs. */
    toolDenied: boolean
    /** What a tool call prints. */
    toolText: string
    /** True: a model request comes back with no response at all. */
    noUsage: boolean
  }
}

export const world = (on: On): World => {
  const w: World = {
    sent: [],
    status: [],
    toasts: [],
    asked: [],
    spawned: [],
    commands: [],
    clock: mock.clock(on, { now: 10_000_000 }),
    set: {
      label: 'unclear',
      isAnswered: true,
      contextTokens: 0,
      toolFails: false,
      toolDenied: false,
      toolText: 'ok',
      noUsage: false,
    },
  }

  on('model.complete', async (_$, e) => {
    w.asked.push(e.prompt)
    return w.set.isAnswered
      ? { value: { isAnswered: true as const, text: w.set.label, usage: USAGE } }
      : { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE } }
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('ui.status', async (_$, e) => {
    w.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', async (_$, e) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('turn.step', async function* (_$, e) {
    w.sent.push(`${e.agentId ?? 'main'}:${e.model}:${e.effort ?? '-'}`)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: w.set.noUsage ? '' : 'ok',
      toolUses: [],
      stopReason: w.set.noUsage ? null : ('end_turn' as const),
      usage: w.set.noUsage ? null : { ...USAGE, cache_read_input_tokens: w.set.contextTokens, model: e.model },
    }
  })
  on('agent.spawn', async (_$, e) => {
    w.spawned.push(e.model ?? 'inherit')
    return { model: e.model ?? e.parentModel }
  })
  on('tool.call', async () => {
    if (w.set.toolDenied) return { deny: 'denied by a rule' }
    return w.set.toolFails
      ? { isError: true as const, result: 'failed', text: w.set.toolText }
      : { result: 'ok', text: w.set.toolText }
  })

  return w
}

/** One whole main-loop turn: start, `steps` model requests, complete. */
export const runTurn = async (
  $: Engine,
  turnId: string,
  text: string,
  model = 'claude-opus-5-5',
  steps = 1,
  reason: 'answer' | 'error' = 'answer',
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'high',
): Promise<void> => {
  await $.turn.start({ text, turnId })
  for (let index = 0; index < steps; index += 1)
    await drain($.turn.step({ turnId, index, model, effort, messageCount: 3 + index }))
  await $.turn.complete({ answer: reason === 'answer' ? 'ok' : '', durationMs: 5, isAborted: false, turnId, reason })
}
