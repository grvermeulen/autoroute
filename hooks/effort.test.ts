import { expect, test } from 'claude-code/testing'

import { engineEffortOf } from './catalog.ts'
import { effortToSend } from './policy.ts'

test("the engine's default effort per model, as read off build 2.1.295", () => {
  expect(engineEffortOf('claude-haiku-5-5')).toBe('medium')
  expect(engineEffortOf('claude-sonnet-5-5')).toBe('medium')
  expect(engineEffortOf('claude-opus-5-5')).toBe('medium')
  expect(engineEffortOf('claude-fable-5-1')).toBe('high')
})

test('a route a class chose sends its own effort', () => {
  const route = { model: 'claude-sonnet-5-5' as const, effort: 'high' as const, cls: 'impl-standard' as const }

  expect(effortToSend(route, 'claude-opus-5-5', 'medium')).toBe('high')
})

test("a route without one swaps the session model's default for the routed model's", () => {
  expect(effortToSend({ model: 'claude-fable-5-1' }, 'claude-opus-5-5', 'medium')).toBe('high')
  expect(effortToSend({ model: 'claude-haiku-5-5' }, 'claude-fable-5-1', 'high')).toBe('medium')
})

test('an effort the person chose themselves is left as it is', () => {
  expect(effortToSend({ model: 'claude-fable-5-1' }, 'claude-opus-5-5', 'xhigh')).toBeUndefined()
  expect(effortToSend({ model: 'claude-fable-5-1' }, 'claude-opus-5-5', 12000)).toBeUndefined()
  expect(effortToSend({ model: 'claude-fable-5-1' }, 'claude-opus-5-5', undefined)).toBeUndefined()
})
