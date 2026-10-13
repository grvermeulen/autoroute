import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { drain, runTurn, world } from './testkit.ts'

const TRIVIAL = 'Fix the typo in README.md'
const QUESTION = 'How does the retry logic in the queue worker work?'
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const route = async ($: Engine, args = ''): Promise<string> =>
  (await $.command.run({ command: 'route', args, ...RUN })).text ?? ''
const pipedTest = { tool: 'Bash' as const, tool_use_id: 'u', command: 'npm test 2>&1 | tail -n 20' }
const spawn = (over: Record<string, unknown> = {}) => ({
  tool_use_id: 'u1',
  prompt: 'look around',
  description: 'look',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
  ...over,
})

test('a denied test run neither counts nor resets the count', async ($, on) => {
  const w = world(on)
  w.set.toolFails = true
  await $.tool.call(pipedTest)
  w.set.toolDenied = true
  await $.tool.call(pipedTest)
  w.set.toolDenied = false
  await $.tool.call(pipedTest)
  await runTurn($, 't1', 'try again', 'claude-sonnet-5-5')

  expect(w.sent).toEqual(['main:claude-opus-5-5:high'])
})

test('a piped test run that exits 0 but prints failures counts as failing', async ($, on) => {
  const w = world(on)
  w.set.toolText = 'Tests: 2 failed, 5 passed'
  await $.tool.call(pipedTest)
  await $.tool.call(pipedTest)
  await runTurn($, 't1', 'try again', 'claude-sonnet-5-5')

  expect(w.sent).toEqual(['main:claude-opus-5-5:high'])
})

test('a run that prints "0 failed" resets the count', async ($, on) => {
  const w = world(on)
  w.set.toolText = 'Tests: 2 failed, 5 passed'
  await $.tool.call(pipedTest)
  w.set.toolText = 'Tests: 0 failed, 7 passed'
  await $.tool.call(pipedTest)
  w.set.toolText = 'Tests: 1 failed, 6 passed'
  await $.tool.call(pipedTest)
  await runTurn($, 't1', 'try again', 'claude-sonnet-5-5')

  expect(w.sent).toEqual(['main:claude-sonnet-5-5:high'])
})

test('while pinned, subagents follow the pin and nothing is classified', async ($, on) => {
  const w = world(on)
  await route($, 'pin sonnet')
  await $.agent.spawn(spawn({ subagentType: 'Explore' }))
  await $.agent.spawn(spawn({ prompt: QUESTION }))
  expect(w.spawned).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5'])

  await route($, 'pin fable')
  await $.agent.spawn(spawn({ subagentType: 'Explore' }))
  expect(w.spawned.at(-1)).toBe('inherit')
})

test('a pinned model that stops answering is left alone until it is pinned again', async ($, on) => {
  const w = world(on)
  await route($, 'pin fable')
  w.set.noUsage = true
  await runTurn($, 't1', 'ok', 'claude-opus-5-5', 1, 'error')
  w.set.noUsage = false
  await runTurn($, 't2', 'ok')

  expect(w.sent).toEqual(['main:claude-fable-5-1:high', 'main:claude-opus-5-5:high'])
  expect(w.status.at(-1)).toBe('route: fable (pinned, not answering)')

  await route($, 'pin fable')
  await runTurn($, 't3', 'ok')

  expect(w.sent.at(-1)).toBe('main:claude-fable-5-1:high')
  expect(w.status.at(-1)).toBe('route: fable (pinned)')
})

test('a step that arrives after a reload carries on with the held route and decides nothing', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', TRIVIAL)
  await drain($.turn.step({ turnId: 'lost', index: 3, model: 'claude-opus-5-5', effort: 'high', messageCount: 9 }))

  expect(w.sent).toEqual(['main:claude-haiku-5-5:medium', 'main:claude-haiku-5-5:medium'])
  expect(await route($)).not.toContain('turn 2:')
})

test('a step that arrives after a reload does not act on a trigger mid-turn', async ($, on) => {
  const w = world(on)
  w.set.toolFails = true
  await $.tool.call(pipedTest)
  await $.tool.call(pipedTest)
  await drain($.turn.step({ turnId: 'lost', index: 2, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 7 }))

  expect(w.sent).toEqual(['main:claude-sonnet-5-5:high'])
})

test('a pin on a session model outside the catalog shows no route', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', TRIVIAL, 'claude-opus-5')
  await route($, 'pin fable')

  expect(w.status.at(-1)).toBeUndefined()
})

test('an out-of-range saving margin counts as unset', { options: { savingMargin: 5 } }, async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', TRIVIAL)

  expect(w.sent).toEqual(['main:claude-haiku-5-5:medium'])
})

test('/route answers even when it fails inside', async ($, on) => {
  world(on)
  const out = await $.command.run({ command: 'route', ...RUN } as never)

  expect(out.text).toBe('autoroute: /route failed and changed nothing. Try again.')
})
