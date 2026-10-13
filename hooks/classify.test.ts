import { expect, test } from 'claude-code/testing'

import { classify, isConfident } from './classify.ts'
import { extract } from './features.ts'

const read = (prompt: string, failures = 0) => classify(extract(prompt, failures))

test('trivial edit, English and Dutch', () => {
  for (const prompt of ['Fix the typo in README.md', 'Herstel de typfout in README.md']) {
    const got = read(prompt)
    expect(got.cls).toBe('trivial-edit')
    expect(got.margin).toBe(1)
    expect(got.fired).toEqual(['trivial-verb', 'short-and-scoped'])
  }
})

test('mechanical change across files', () => {
  const got = read('Apply the same fix across all handlers')
  expect(got.cls).toBe('impl-mechanical')
  expect(got.margin).toBe(0.6)
})

test('a bug with a stack trace', () => {
  const got = read('The upload handler crashes with this error:\nTypeError: x is undefined\n    at upload (src/upload.ts:42:13)')
  expect(got.cls).toBe('debug-repro')
  expect(got.margin).toBe(0.818)
})

test('an intermittent failure', () => {
  const got = read('The login test is flaky, it fails sometimes but only in CI')
  expect(got.cls).toBe('debug-hard')
  expect(got.margin).toBe(0.75)
})

test('a design question, English and Dutch', () => {
  for (const prompt of [
    'Should we split the billing module into its own service, and what are the trade-offs?',
    'Moeten we de facturatie opsplitsen in een eigen service, en wat zijn de afwegingen?',
  ]) {
    const got = read(prompt)
    expect(got.cls).toBe('architecture')
    expect(got.margin).toBe(0.429)
  }
})

test('a codebase question, English and Dutch', () => {
  for (const prompt of ['How does the retry logic in the queue worker work?', 'Hoe werkt de retry-logica in de queue worker?']) {
    const got = read(prompt)
    expect(got.cls).toBe('research')
    expect(got.margin).toBe(0.9)
  }
})

test('a migration', () => {
  const got = read('Migrate the whole codebase from Moment to date-fns')
  expect(got.cls).toBe('long-refactor')
  expect(got.margin).toBe(0.833)
})

test('two failing test runs point at a hard bug', () => {
  const got = read('try again please', 2)
  expect(got.cls).toBe('debug-hard')
  expect(got.margin).toBe(0.8)
})

test('plain implementation is named but capped below the abstain margin', () => {
  const got = read('Add a createdAt field to the invoice model and expose it in the list endpoint')
  expect(got.cls).toBe('impl-standard')
  expect(got.margin).toBe(0.15)
  expect(isConfident(got)).toBe(false)
})

test('too little evidence names no class', () => {
  for (const prompt of ['ok', '', 'ja doe maar']) {
    const got = read(prompt)
    expect(got.cls).toBeUndefined()
    expect(got.margin).toBe(0)
    expect(isConfident(got)).toBe(false)
  }
})

test('confidence starts at a margin of 0.2', () => {
  expect(isConfident({ cls: 'research', margin: 0.2, fired: [] })).toBe(true)
  expect(isConfident({ cls: 'research', margin: 0.19, fired: [] })).toBe(false)
  expect(isConfident({ cls: undefined, margin: 1, fired: [] })).toBe(false)
})
