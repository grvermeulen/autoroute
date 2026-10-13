import { expect, test } from 'claude-code/testing'

import { runTurn, world } from './testkit.ts'

const TRIVIAL = 'Fix the typo in README.md'
const bash = (command: string, agentId?: string) => ({ tool: 'Bash' as const, tool_use_id: 'u', command, ...(agentId ? { agentId } : {}) })

test('two failing test runs escalate one tier, once', async ($, on) => {
  const w = world(on)
  w.set.toolFails = true
  await $.tool.call(bash('npm test'))
  await $.tool.call({ tool: 'PowerShell', tool_use_id: 'u', command: 'npm test' })
  await runTurn($, 't1', 'try again', 'claude-sonnet-5-5')
  await runTurn($, 't2', 'ok', 'claude-sonnet-5-5')

  expect(w.sent).toEqual(['main:claude-opus-5-5:high', 'main:claude-opus-5-5:high'])
  expect(w.status.at(-1)).toBe('route: opus')
})

test('a passing run in between resets the count', async ($, on) => {
  const w = world(on)
  w.set.toolFails = true
  await $.tool.call(bash('npm test'))
  w.set.toolFails = false
  await $.tool.call(bash('npm test'))
  w.set.toolFails = true
  await $.tool.call(bash('npm test'))
  await runTurn($, 't1', 'try again', 'claude-sonnet-5-5')

  expect(w.sent).toEqual(['main:claude-sonnet-5-5:high'])
})

test('failing commands that are not test runs, and a subagent\'s test runs, do not count', async ($, on) => {
  const w = world(on)
  w.set.toolFails = true
  await $.tool.call(bash('npm install'))
  await $.tool.call(bash('git push'))
  await $.tool.call(bash('npm test', 'a1'))
  await $.tool.call(bash('npm test', 'a1'))
  await runTurn($, 't1', 'try again', 'claude-sonnet-5-5')

  expect(w.sent).toEqual(['main:claude-sonnet-5-5:high'])
})

test('"still broken" after a downgrade goes back to the session model', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', TRIVIAL)
  await runTurn($, 't2', 'werkt nog steeds niet')

  expect(w.sent).toEqual(['main:claude-haiku-5-5:medium', 'main:claude-opus-5-5:high'])
  expect(w.status.at(-1)).toBeUndefined()
})

test('"still broken" as the very first prompt is no trigger', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', 'werkt nog steeds niet')

  expect(w.sent).toEqual(['main:claude-opus-5-5:high'])
})

test('a routed model that never answers is not chosen again', async ($, on) => {
  const w = world(on)
  w.set.noUsage = true
  await runTurn($, 't1', TRIVIAL, 'claude-opus-5-5', 1, 'error')
  w.set.noUsage = false
  await runTurn($, 't2', TRIVIAL)

  expect(w.sent).toEqual(['main:claude-haiku-5-5:medium', 'main:claude-opus-5-5:high'])
  expect(w.toasts).toEqual(['autoroute: claude-haiku-5-5 did not answer; not routing to it again this session.'])
  expect(w.status.at(-1)).toBeUndefined()
})

test('an errored turn on the session\'s own model marks nothing unavailable', async ($, on) => {
  const w = world(on)
  w.set.noUsage = true
  await runTurn($, 't1', 'ok', 'claude-opus-5-5', 1, 'error')

  expect(w.toasts).toEqual([])
})

test('an ordinary "no, that is fine" is no trigger and escalates nothing', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', 'ok')
  await runTurn($, 't2', "No, that's fine, go ahead")

  expect(w.sent).toEqual(['main:claude-opus-5-5:high', 'main:claude-opus-5-5:high'])
})
