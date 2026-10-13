import { expect, test } from 'claude-code/testing'

import { decide, subagentModelFor } from './policy.ts'
import type { PolicyInput } from './policy.ts'

const NOW = 10_000_000
const at = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  mode: 'auto',
  base: 'claude-opus-5-5',
  source: 'rules',
  isTriggered: false,
  contextTokens: 0,
  nowMs: NOW,
  lastUse: {},
  unavailable: [],
  savingMargin: 0.2,
  cacheTtlMinutes: 60,
  ...over,
})
const usd = (amount: number | undefined): number => Number((amount ?? Number.NaN).toFixed(5))

test('rule 1: off changes nothing', () => {
  expect(decide(at({ mode: 'off', cls: 'trivial-edit', route: { model: 'claude-haiku-5-5' } }))).toEqual({
    rule: 1,
    route: undefined,
    resetsFailures: false,
  })
})

test('rule 2: pinned sends the pinned model, and nothing when it is the base', () => {
  expect(decide(at({ mode: 'pinned', pinned: 'claude-fable-5-1' })).route).toEqual({ model: 'claude-fable-5-1' })
  expect(decide(at({ mode: 'pinned', pinned: 'claude-opus-5-5' })).route).toBeUndefined()
  expect(decide(at({ mode: 'pinned', pinned: 'claude-fable-5-1' })).rule).toBe(2)
})

test('rule 3: an override wins over a trigger and a class', () => {
  const got = decide(at({ override: 'claude-haiku-5-5', isTriggered: true, cls: 'architecture' }))
  expect(got.rule).toBe(3)
  expect(got.route).toEqual({ model: 'claude-haiku-5-5' })
})

test('rule 3: an override naming the base clears the route; an unavailable one keeps it', () => {
  const route = { model: 'claude-haiku-5-5' as const }
  expect(decide(at({ override: 'claude-opus-5-5', route })).route).toBeUndefined()
  expect(decide(at({ override: 'claude-sonnet-5-5', route, unavailable: ['claude-sonnet-5-5'] })).route).toEqual(route)
})

test('rule 4: a trigger below the base goes back to the base', () => {
  const got = decide(at({ isTriggered: true, route: { model: 'claude-haiku-5-5' } }))
  expect(got).toEqual({ rule: 4, route: undefined, resetsFailures: true })
})

test('rule 5: a trigger on the base goes one tier up', () => {
  const got = decide(at({ isTriggered: true }))
  expect(got.rule).toBe(5)
  expect(got.route).toEqual({ model: 'claude-fable-5-1' })
  expect(got.resetsFailures).toBe(true)
})

test('rule 5: at the top tier a trigger stays put but still resets the counter', () => {
  const got = decide(at({ isTriggered: true, base: 'claude-fable-5-1' }))
  expect(got).toEqual({ rule: 5, route: undefined, resetsFailures: true })
})

test('rule 6: the wanted model is already in use', () => {
  expect(decide(at({ cls: 'architecture' })).rule).toBe(6)
  expect(decide(at({ cls: 'architecture' })).route).toBeUndefined()
})

test('rule 6: a hard class is never routed below the session model', () => {
  const got = decide(at({ base: 'claude-fable-5-1', cls: 'debug-hard' }))
  expect(got.rule).toBe(6)
  expect(got.route).toBeUndefined()
})

test('rule 7: moving up toward the base needs no cost check', () => {
  const route = { model: 'claude-haiku-5-5' as const }
  const got = decide(at({ cls: 'impl-mechanical', route }))
  expect(got.rule).toBe(7)
  expect(got.route).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium', cls: 'impl-mechanical' })
  expect(decide(at({ cls: 'architecture', route })).route).toBeUndefined()
})

test('rule 8: above the base only for a hard class', () => {
  const hard = decide(at({ base: 'claude-sonnet-5-5', cls: 'architecture' }))
  expect(hard.rule).toBe(8)
  expect(hard.route).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh', cls: 'architecture' })

  const plain = decide(at({ base: 'claude-haiku-5-5', cls: 'impl-standard' }))
  expect(plain.rule).toBe(8)
  expect(plain.route).toBeUndefined()
})

const FABLE_WARM = { 'claude-fable-5-1': { atMs: NOW - 60_000, contextTokens: 300_000 } }

test('rule 9: standard implementation at 300K stays on warm Fable', () => {
  const got = decide(at({ base: 'claude-fable-5-1', cls: 'impl-standard', contextTokens: 300_000, lastUse: FABLE_WARM }))
  expect(got.rule).toBe(9)
  expect(got.route).toBeUndefined()
  expect(usd(got.estimates?.stay)).toBe(1)
  expect(usd(got.estimates?.move)).toBe(1.79)
})

test('rule 9: a trivial edit at 300K stays, at 30K it moves to Haiku', () => {
  const big = decide(at({ base: 'claude-fable-5-1', cls: 'trivial-edit', contextTokens: 300_000, lastUse: FABLE_WARM }))
  expect(big.route).toBeUndefined()
  expect(usd(big.estimates?.move)).toBe(0.33125)

  const small = decide(at({ base: 'claude-fable-5-1', cls: 'trivial-edit', contextTokens: 30_000, lastUse: FABLE_WARM }))
  expect(small.rule).toBe(9)
  expect(small.route).toEqual({ model: 'claude-haiku-5-5', effort: 'medium', cls: 'trivial-edit' })
  expect(usd(small.estimates?.stay)).toBe(0.0475)
  expect(usd(small.estimates?.move)).toBe(0.00685)
})

test('rule 9: a warm cheaper cache, or an expired expensive one, tips the 300K case', () => {
  const bothWarm = { ...FABLE_WARM, 'claude-haiku-5-5': { atMs: NOW - 60_000, contextTokens: 300_000 } }
  expect(decide(at({ base: 'claude-fable-5-1', cls: 'trivial-edit', contextTokens: 300_000, lastUse: bothWarm })).route?.model).toBe(
    'claude-haiku-5-5',
  )

  const expired = { 'claude-fable-5-1': { atMs: NOW - 61 * 60_000, contextTokens: 300_000 } }
  const got = decide(at({ base: 'claude-fable-5-1', cls: 'trivial-edit', contextTokens: 300_000, lastUse: expired }))
  expect(got.route?.model).toBe('claude-haiku-5-5')
  expect(usd(got.estimates?.stay)).toBe(6.175)
})

test('rule 10: no class keeps the sticky route', () => {
  const route = { model: 'claude-haiku-5-5' as const, effort: 'medium' as const, cls: 'trivial-edit' as const }
  expect(decide(at({ route, source: 'none' }))).toEqual({ rule: 10, route, resetsFailures: false })
})

test('rule 10: a class whose model is unavailable keeps what there is', () => {
  const got = decide(at({ cls: 'trivial-edit', unavailable: ['claude-haiku-5-5'] }))
  expect(got.rule).toBe(10)
  expect(got.route).toBeUndefined()
})

test('subagents: Explore always, general-purpose by its prompt, others never', () => {
  expect(subagentModelFor('Explore', 'anything at all')).toBe('claude-haiku-5-5')
  expect(subagentModelFor('general-purpose', 'How does the retry logic in the queue worker work?')).toBe('claude-haiku-5-5')
  expect(subagentModelFor('claude', 'Apply the same fix across all handlers')).toBe('claude-sonnet-5-5')
  expect(subagentModelFor('general-purpose', 'Should we split the billing module into its own service, and what are the trade-offs?')).toBeUndefined()
  expect(subagentModelFor('general-purpose', 'do the thing')).toBeUndefined()
  expect(subagentModelFor('Plan', 'How does the retry logic in the queue worker work?')).toBeUndefined()
  expect(subagentModelFor('router:scout', 'How does the retry logic in the queue worker work?')).toBeUndefined()
})
