import { expect, test } from 'claude-code/testing'

import { drain, runTurn, world } from './testkit.ts'

const TRIVIAL = 'Fix the typo in README.md'
const PLAIN = 'Add a createdAt field to the invoice model and expose it in the list endpoint'
const DESIGN = 'Should we split the billing module into its own service, and what are the trade-offs?'

test('a trivial prompt on Opus goes to Haiku for every step of the turn', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', TRIVIAL, 'claude-opus-5-5', 3)

  expect(w.sent).toEqual(['main:claude-haiku-5-5:medium', 'main:claude-haiku-5-5:medium', 'main:claude-haiku-5-5:medium'])
  expect(w.asked).toEqual([])
  expect(w.status.at(-1)).toBe('route: haiku · medium (trivial-edit)')
})

test('a subagent step passes through untouched, even inside a routed turn', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: TRIVIAL, turnId: 't1' })
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3 }))
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, agentId: 'a1' }))

  expect(w.sent).toEqual(['main:claude-haiku-5-5:medium', 'a1:claude-opus-5-5:high'])
})

test('when the rules abstain the fallback is asked and its label is followed', async ($, on) => {
  const w = world(on)
  w.set.label = 'trivial-edit'
  await runTurn($, 't1', PLAIN)

  expect(w.asked).toEqual([`<message>\n${PLAIN}\n</message>`])
  expect(w.sent).toEqual(['main:claude-haiku-5-5:medium'])
})

test('the fallback can be switched off', { options: { fallbackClassifier: false } }, async ($, on) => {
  const w = world(on)
  w.set.label = 'trivial-edit'
  await runTurn($, 't1', PLAIN)

  expect(w.asked).toEqual([])
  expect(w.sent).toEqual(['main:claude-opus-5-5:high'])
})

test('a fallback that answers nonsense, or does not answer, leaves the request unchanged', async ($, on) => {
  const w = world(on)
  w.set.label = 'banana'
  await runTurn($, 't1', PLAIN)
  w.set.isAnswered = false
  await runTurn($, 't2', PLAIN)

  expect(w.asked).toHaveLength(2)
  expect(w.sent).toEqual(['main:claude-opus-5-5:high', 'main:claude-opus-5-5:high'])
})

test('a short follow-up asks nobody and keeps the route', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', TRIVIAL)
  await runTurn($, 't2', 'ok thanks')

  expect(w.asked).toEqual([])
  expect(w.sent).toEqual(['main:claude-haiku-5-5:medium', 'main:claude-haiku-5-5:medium'])
})

test('a large warm context stays on the session model; a small one moves', async ($, on) => {
  const w = world(on)
  w.set.contextTokens = 300_000
  await runTurn($, 't1', DESIGN, 'claude-fable-5-1')
  await runTurn($, 't2', TRIVIAL, 'claude-fable-5-1')
  expect(w.sent).toEqual(['main:claude-fable-5-1:high', 'main:claude-fable-5-1:high'])

  w.set.contextTokens = 30_000
  await runTurn($, 't3', DESIGN, 'claude-fable-5-1')
  await runTurn($, 't4', TRIVIAL, 'claude-fable-5-1')
  expect(w.sent.at(-1)).toBe('main:claude-haiku-5-5:medium')
})

test('a session model outside the catalog is never rewritten; a [1m] suffix is recognised', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', TRIVIAL, 'claude-opus-5')
  await runTurn($, 't2', TRIVIAL, 'claude-opus-5-5[1m]')

  expect(w.sent).toEqual(['main:claude-opus-5:high', 'main:claude-haiku-5-5:medium'])
})

test('an override token routes without touching effort; an unknown one is no override', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', '!sonnet walk through the plan with me')
  expect(w.sent).toEqual(['main:claude-sonnet-5-5:high'])
  expect(w.status.at(-1)).toBe('route: sonnet')

  await runTurn($, 't2', '!gpt fix the typo in README.md')
  expect(w.sent.at(-1)).toBe('main:claude-haiku-5-5:medium')
})

test('an empty prompt and a 500 KB paste go out unchanged', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', '')
  await runTurn($, 't2', 'x'.repeat(500_000))

  expect(w.asked).toEqual([])
  expect(w.sent).toEqual(['main:claude-opus-5-5:high', 'main:claude-opus-5-5:high'])
})

test('a step for a turn the module never saw start passes through', async ($, on) => {
  const w = world(on)
  await drain($.turn.step({ turnId: 'lost', index: 4, model: 'claude-opus-5-5', effort: 'high', messageCount: 9 }))

  expect(w.sent).toEqual(['main:claude-opus-5-5:high'])
})
