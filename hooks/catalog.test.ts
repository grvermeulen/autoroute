import { expect, test } from 'claude-code/testing'

import { CELLS, MODELS, TASK_CLASSES, modelAtTier, modelByAlias, modelById, pricesFor, tierOf, toCatalogId } from './catalog.ts'

test('engine model ids reduce to catalog ids', () => {
  expect(toCatalogId('claude-opus-5-5')).toBe('claude-opus-5-5')
  expect(toCatalogId('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
  expect(toCatalogId('claude-fable-5-1[1m]')).toBe('claude-fable-5-1')
})

test('a model outside the catalog reduces to nothing', () => {
  expect(toCatalogId('claude-opus-5')).toBeUndefined()
  expect(toCatalogId('claude-haiku-4-5-20251001')).toBeUndefined()
  expect(toCatalogId('')).toBeUndefined()
})

test('tiers run 0 to 3 from Haiku to Fable', () => {
  expect(MODELS.map(m => [m.alias, m.tier])).toEqual([
    ['haiku', 0],
    ['sonnet', 1],
    ['opus', 2],
    ['fable', 3],
  ])
  expect(tierOf('claude-opus-5-5')).toBe(2)
  expect(modelAtTier(3)?.id).toBe('claude-fable-5-1')
  expect(modelAtTier(4)).toBeUndefined()
})

test('aliases resolve whatever their case', () => {
  expect(modelByAlias('Opus')?.id).toBe('claude-opus-5-5')
  expect(modelByAlias('gpt')).toBeUndefined()
})

test('the one-hour cache write is twice the input price on every model', () => {
  for (const model of MODELS) expect(model.prices.cacheWrite).toBe(model.prices.input * 2)
})

test('Haiku switches to its long-prompt prices above 100K context', () => {
  const haiku = modelById('claude-haiku-5-5')
  if (!haiku) throw new Error('haiku missing')
  expect(pricesFor(haiku, 100_000).input).toBe(0.1)
  expect(pricesFor(haiku, 100_001).input).toBe(0.5)
  expect(pricesFor(haiku, 100_001).cacheRead).toBe(0.05)
})

test('every class has a cell that names a catalog model', () => {
  expect(TASK_CLASSES).toHaveLength(8)
  for (const cls of TASK_CLASSES) expect(modelById(CELLS[cls].model)).toBeDefined()
  expect(TASK_CLASSES.filter(cls => CELLS[cls].isHard)).toEqual(['debug-hard', 'architecture', 'long-refactor'])
})
