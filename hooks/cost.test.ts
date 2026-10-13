import { expect, test } from 'claude-code/testing'

import { estimateTurnCost, isCacheWarm } from './cost.ts'

const usd = (amount: number): number => Number(amount.toFixed(5))
const IMPL = { requests: 10, outputTokens: 5000 }
const TRIVIAL = { requests: 3, outputTokens: 500 }

test('standard implementation at 300K: warm Fable is cheaper than cold Sonnet', () => {
  expect(usd(estimateTurnCost('claude-fable-5-1', { contextTokens: 300_000, ...IMPL }, true))).toBe(1)
  expect(usd(estimateTurnCost('claude-sonnet-5-5', { contextTokens: 300_000, ...IMPL }, false))).toBe(1.79)
})

test('trivial edit at 300K: warm Fable is cheaper than cold Haiku at long-prompt prices', () => {
  expect(usd(estimateTurnCost('claude-fable-5-1', { contextTokens: 300_000, ...TRIVIAL }, true))).toBe(0.25)
  expect(usd(estimateTurnCost('claude-haiku-5-5', { contextTokens: 300_000, ...TRIVIAL }, false))).toBe(0.33125)
})

test('trivial edit at 30K: cold Haiku is far cheaper than warm Fable', () => {
  expect(usd(estimateTurnCost('claude-fable-5-1', { contextTokens: 30_000, ...TRIVIAL }, true))).toBe(0.0475)
  expect(usd(estimateTurnCost('claude-haiku-5-5', { contextTokens: 30_000, ...TRIVIAL }, false))).toBe(0.00685)
})

test('a cold cache charges the first request at the write price', () => {
  const shape = { contextTokens: 1_000_000, requests: 1, outputTokens: 0 }
  expect(usd(estimateTurnCost('claude-opus-5-5', shape, false))).toBe(8)
  expect(usd(estimateTurnCost('claude-opus-5-5', shape, true))).toBe(0.2)
})

test('an empty context costs output only', () => {
  expect(usd(estimateTurnCost('claude-opus-5-5', { contextTokens: 0, ...TRIVIAL }, false))).toBe(0.01)
})

test('a cache is warm only inside the TTL and over at least half the context', () => {
  const lastUse = { atMs: 1_000_000, contextTokens: 100_000 }
  expect(isCacheWarm(lastUse, 150_000, 1_000_000 + 59 * 60_000, 60)).toBe(true)
  expect(isCacheWarm(lastUse, 150_000, 1_000_000 + 60 * 60_000, 60)).toBe(false)
  expect(isCacheWarm(lastUse, 200_001, 1_000_000, 60)).toBe(false)
  expect(isCacheWarm(undefined, 0, 1_000_000, 60)).toBe(false)
})
