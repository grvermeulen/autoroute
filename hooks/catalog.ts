/** Models, prices and class cells. The only place a price is written down. */
import type { AutorouteClass, AutorouteEffort, AutorouteModel } from '../types'

export type ModelId = AutorouteModel
export type Effort = AutorouteEffort
export type TaskClass = AutorouteClass

/** USD per million tokens. `cacheWrite` is the one-hour write. */
export type Prices = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Model = {
  id: ModelId
  alias: string
  tier: number
  prices: Prices
  longPrompt?: { over: number; prices: Prices }
  /** The effort Claude Code resolves for this model when the person set none (read off build 2.1.295). */
  engineEffort: Effort
}

export const PRICES_CHECKED_ON = '2026-10-13'

export const MODELS: readonly Model[] = [
  {
    id: 'claude-haiku-5-5',
    alias: 'haiku',
    tier: 0,
    prices: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.2 },
    // Billed as assumed: a 436K-token request cost $1.00 per million for the cache write.
    longPrompt: { over: 100_000, prices: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 1 } },
    engineEffort: 'medium',
  },
  {
    id: 'claude-sonnet-5-5',
    alias: 'sonnet',
    tier: 1,
    prices: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 4 },
    engineEffort: 'medium',
  },
  {
    id: 'claude-opus-5-5',
    alias: 'opus',
    tier: 2,
    prices: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 },
    engineEffort: 'medium',
  },
  {
    id: 'claude-fable-5-1',
    alias: 'fable',
    tier: 3,
    prices: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 20 },
    engineEffort: 'high',
  },
]

/**
 * What a class asks for. `requests` and `outputTokens` are the turn shape the
 * cost estimate assumes; the eval's replay measures the real values.
 */
export type Cell = { model: ModelId; effort: Effort; isHard: boolean; requests: number; outputTokens: number }

export const CELLS: Readonly<Record<TaskClass, Cell>> = {
  'trivial-edit': { model: 'claude-haiku-5-5', effort: 'medium', isHard: false, requests: 3, outputTokens: 500 },
  'impl-mechanical': { model: 'claude-sonnet-5-5', effort: 'medium', isHard: false, requests: 10, outputTokens: 4000 },
  'impl-standard': { model: 'claude-sonnet-5-5', effort: 'high', isHard: false, requests: 10, outputTokens: 5000 },
  'debug-repro': { model: 'claude-sonnet-5-5', effort: 'high', isHard: false, requests: 10, outputTokens: 4000 },
  research: { model: 'claude-sonnet-5-5', effort: 'medium', isHard: false, requests: 6, outputTokens: 2000 },
  'debug-hard': { model: 'claude-opus-5-5', effort: 'high', isHard: true, requests: 10, outputTokens: 5000 },
  architecture: { model: 'claude-opus-5-5', effort: 'xhigh', isHard: true, requests: 10, outputTokens: 5000 },
  'long-refactor': { model: 'claude-fable-5-1', effort: 'high', isHard: true, requests: 10, outputTokens: 5000 },
}

export const TASK_CLASSES = Object.keys(CELLS) as TaskClass[]

export const modelById = (id: string): Model | undefined => MODELS.find(model => model.id === id)

export const modelByAlias = (alias: string): Model | undefined =>
  MODELS.find(model => model.alias === alias.toLowerCase())

export const modelAtTier = (tier: number): Model | undefined => MODELS.find(model => model.tier === tier)

export const tierOf = (id: ModelId): number => modelById(id)?.tier ?? 0

export const engineEffortOf = (id: ModelId): Effort => modelById(id)?.engineEffort ?? 'medium'

/** `claude-opus-5-5[1m]` and `claude-opus-5-5` are the same catalog model. */
export const toCatalogId = (engineModel: string): ModelId | undefined =>
  modelById(engineModel.replace(/\[[^\]]*\]$/, ''))?.id

export const pricesFor = (model: Model, contextTokens: number): Prices =>
  model.longPrompt && contextTokens > model.longPrompt.over ? model.longPrompt.prices : model.prices
