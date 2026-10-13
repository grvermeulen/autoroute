import { expect, test } from 'claude-code/testing'

import { runTurn, world } from './testkit.ts'

const QUESTION = 'How does the retry logic in the queue worker work?'
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

test('Explore starts on Haiku', async ($, on) => {
  const w = world(on)
  await $.agent.spawn(spawn({ subagentType: 'Explore' }))

  expect(w.spawned).toEqual(['claude-haiku-5-5'])
})

test('a general-purpose agent follows the rules reading of its prompt', async ($, on) => {
  const w = world(on)
  await $.agent.spawn(spawn({ prompt: QUESTION }))
  await $.agent.spawn(spawn({ prompt: 'Apply the same fix across all handlers' }))
  await $.agent.spawn(spawn({ prompt: 'do the thing' }))

  expect(w.spawned).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'inherit'])
  expect(w.asked).toEqual([])
})

test('while the main turn is routed, an undecided subagent follows the route', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', 'Fix the typo in README.md')
  await $.agent.spawn(spawn({ prompt: 'do the thing' }))
  await $.agent.spawn(spawn({ subagentType: 'Plan', prompt: 'plan it' }))

  expect(w.spawned).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5'])
})

test('a subagent is never started above the session model', async ($, on) => {
  const w = world(on)
  await $.agent.spawn(spawn({ prompt: 'Apply the same fix across all handlers', parentModel: 'claude-haiku-5-5' }))

  expect(w.spawned).toEqual(['inherit'])
})

test('forks, teammates, explicit models and plugin agents are left alone', async ($, on) => {
  const w = world(on)
  await $.agent.spawn(spawn({ subagentType: 'Explore', fork: true }))
  await $.agent.spawn(spawn({ subagentType: 'Explore', isTeammate: true as const }))
  await $.agent.spawn(spawn({ subagentType: 'Explore', model: 'claude-opus-5-5' }))
  await $.agent.spawn(spawn({ subagentType: 'router:scout', prompt: QUESTION, provider: { plugin: 'router', tier: 'user' as const } }))

  expect(w.spawned).toEqual(['inherit', 'inherit', 'claude-opus-5-5', 'inherit'])
})

test('a parent on a model outside the catalog is left alone', async ($, on) => {
  const w = world(on)
  await $.agent.spawn(spawn({ subagentType: 'Explore', parentModel: 'claude-opus-5' }))

  expect(w.spawned).toEqual(['inherit'])
})
