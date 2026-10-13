import { expect, test } from 'claude-code/testing'

import { detectOverride, extract, isTestCommand, windowed } from './features.ts'

test('an English trivial edit', () => {
  const f = extract('Fix the typo in README.md')
  expect(f.words).toBe(5)
  expect(f.short).toBe(true)
  expect(f.trivialVerb).toBe(true)
  expect(f.hasFilePath).toBe(true)
  expect(f.debug).toBe(false)
  expect(f.isQuestion).toBe(false)
})

test('a Dutch trivial edit: "typfout" counts and does not read as "fout"', () => {
  const f = extract('Herstel de typfout in README.md')
  expect(f.trivialVerb).toBe(true)
  expect(f.debug).toBe(false)
})

test('Dutch keywords reach every group', () => {
  expect(extract('pas dit overal aan').mechanical).toBe(true)
  expect(extract('de upload werkt niet').debug).toBe(true)
  expect(extract('het gaat af en toe mis').debugHard).toBe(true)
  expect(extract('moeten we dit opsplitsen?').architecture).toBe(true)
  expect(extract('hoe werkt de queue?').research).toBe(true)
  expect(extract('migreer de hele codebase').longHorizon).toBe(true)
  expect(extract('werkt nog steeds niet').stillBroken).toBe(true)
})

test('a stack trace and a file path inside it', () => {
  const f = extract('The upload handler crashes with this error:\nTypeError: x is undefined\n    at upload (src/upload.ts:42:13)')
  expect(f.debug).toBe(true)
  expect(f.hasStackTrace).toBe(true)
  expect(f.hasFilePath).toBe(true)
  expect(f.words).toBe(14)
})

test('"that didn\'t work" reads as still broken', () => {
  expect(extract("that didn't work").stillBroken).toBe(true)
  expect(extract('try again please').stillBroken).toBe(false)
})

test('an empty prompt has no words and no signals', () => {
  const f = extract('')
  expect(f.words).toBe(0)
  expect(f.short).toBe(false)
  expect(f.trivialVerb).toBe(false)
})

test('the failing-test count is carried through', () => {
  expect(extract('try again', 2).consecutiveTestFailures).toBe(2)
  expect(extract('try again').consecutiveTestFailures).toBe(0)
})

test('a long prompt is scanned by its head and tail only', () => {
  const text = `${'a'.repeat(5000)} typo ${'b'.repeat(5000)}`
  expect(windowed(text).length).toBe(8003)
  expect(extract(text).trivialVerb).toBe(false)
  expect(windowed('short')).toBe('short')
})

test('a 500 KB paste is handled in well under a second', () => {
  const paste = 'x'.repeat(500_000)
  const started = Date.now()
  expect(extract(paste).words).toBe(1)
  expect(Date.now() - started).toBeLessThan(500)
})

test('an override token names a model alias', () => {
  expect(detectOverride('!opus look at this')).toBe('opus')
  expect(detectOverride('please use !Haiku here')).toBe('haiku')
  expect(detectOverride('email a!opus@example.com')).toBeUndefined()
  expect(detectOverride('!gpt do it')).toBeUndefined()
  expect(detectOverride('no token')).toBeUndefined()
})

test('test commands are recognised', () => {
  for (const command of ['npm test', 'pnpm run test -- --watch=false', 'npx vitest run', 'pytest -q', 'go test ./...', 'dotnet test', 'node --test', 'cargo test'])
    expect(isTestCommand(command)).toBe(true)
  for (const command of ['npm install', 'git status', 'node build.js', 'ls test'])
    expect(isTestCommand(command)).toBe(false)
})

test('an ordinary "no" or "again" does not read as still broken', () => {
  for (const prompt of ["No, that's fine, go ahead", 'Nope, leave it as is', 'Try again, the other file this time', 'Run it again, it should pass now'])
    expect(extract(prompt).stillBroken).toBe(false)
  for (const prompt of ['still failing', 'same error as before', "that didn't help", 'dat werkte niet'])
    expect(extract(prompt).stillBroken).toBe(true)
})
