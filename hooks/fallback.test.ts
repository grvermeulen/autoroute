import { expect, test } from 'claude-code/testing'

import { TASK_CLASSES } from './catalog.ts'
import { FALLBACK_MODEL, MIN_WORDS, SYSTEM, buildFallbackRequest, parseLabel } from './fallback.ts'

test('the request is small, cheap and bounded in time', () => {
  const request = buildFallbackRequest('Add a createdAt field to the invoice model')
  expect(request).toEqual({
    model: 'claude-haiku-5-5',
    system: SYSTEM,
    prompt: '<message>\nAdd a createdAt field to the invoice model\n</message>',
    maxTokens: 16,
    effort: 'low',
    timeoutMs: 4000,
  })
  expect(FALLBACK_MODEL).toBe('claude-haiku-5-5')
  expect(MIN_WORDS).toBe(4)
})

test('a long prompt is sent by its head and tail', () => {
  expect(buildFallbackRequest('x'.repeat(50_000)).prompt.length).toBe(8024)
})

test('the system text defines every class and the way out', () => {
  for (const cls of TASK_CLASSES) expect(SYSTEM).toContain(`${cls}:`)
  expect(SYSTEM).toContain('unclear:')
})

test('a clean label parses, with or without stray case and punctuation', () => {
  expect(parseLabel('trivial-edit')).toBe('trivial-edit')
  expect(parseLabel('  Debug-Hard.\n')).toBe('debug-hard')
  expect(parseLabel('`architecture`')).toBe('architecture')
})

test('anything that is not exactly one label parses to nothing', () => {
  for (const reply of ['unclear', 'banana', '', 'the label is trivial-edit', 'trivial-edit or research'])
    expect(parseLabel(reply)).toBeUndefined()
})
