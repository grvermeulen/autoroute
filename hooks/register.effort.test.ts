import { expect, test } from 'claude-code/testing'

import { runTurn, world } from './testkit.ts'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

test("!fable from an Opus session at the engine's default runs Fable at its own default", async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', '!fable look at this with me', 'claude-opus-5-5', 1, 'answer', 'medium')

  expect(w.sent).toEqual(['main:claude-fable-5-1:high'])
})

test('an effort the person set is carried over unchanged', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', '!fable look at this with me', 'claude-opus-5-5', 1, 'answer', 'xhigh')

  expect(w.sent).toEqual(['main:claude-fable-5-1:xhigh'])
})

test('a pin does the same swap', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'route', args: 'pin fable', ...RUN })
  await runTurn($, 't1', 'ok', 'claude-opus-5-5', 1, 'answer', 'medium')

  expect(w.sent).toEqual(['main:claude-fable-5-1:high'])
})
