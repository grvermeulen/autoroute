import { expect, test } from 'claude-code/testing'

import { didTestRunFail } from './features.ts'
import { readSettings } from './settings.ts'

test('a test run fails by its exit status', () => {
  expect(didTestRunFail(true, '')).toBe(true)
  expect(didTestRunFail(true, 'Tests: 0 failed, 7 passed')).toBe(true)
})

test('a test run that exits 0 fails by what the runner printed', () => {
  for (const output of [
    'Tests: 2 failed, 5 passed',
    '10 failed',
    '3 failing',
    'FAIL src/app.test.ts',
    'FAILED tests/test_x.py::test_y',
    'AssertionError: expected 1 to be 2',
    'BUILD FAILURE',
  ])
    expect(didTestRunFail(false, output)).toBe(true)
})

test('a clean run, or one that reports zero failures, passes', () => {
  for (const output of ['Tests: 0 failed, 7 passed', ' 12 pass\n 0 fail', 'all good', ''])
    expect(didTestRunFail(false, output)).toBe(false)
})

test('options in range are taken as given', () => {
  expect(readSettings({ fallbackClassifier: false, savingMargin: 0.35, cacheTtlMinutes: 5 })).toEqual({
    useFallback: false,
    savingMargin: 0.35,
    cacheTtlMinutes: 5,
  })
  expect(readSettings({ savingMargin: 0 }).savingMargin).toBe(0)
})

test('missing or out-of-range options read as their defaults', () => {
  const defaults = { useFallback: true, savingMargin: 0.2, cacheTtlMinutes: 60 }
  for (const options of [
    {},
    { savingMargin: 5 },
    { savingMargin: -0.1 },
    { savingMargin: 1 },
    { savingMargin: Number.NaN },
    { cacheTtlMinutes: 0 },
    { cacheTtlMinutes: -3 },
    { savingMargin: 'x', cacheTtlMinutes: 'y' },
  ])
    expect(readSettings(options)).toEqual(defaults)
})
