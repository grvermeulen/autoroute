/** What one turn is estimated to cost on a model, given how much of its context is cached. */
import { modelById, pricesFor } from './catalog.ts'
import type { ModelId } from './catalog.ts'

export type TurnShape = { contextTokens: number; requests: number; outputTokens: number }

export type LastUse = { atMs: number; contextTokens: number }

/**
 * USD for one turn. The first request reads the context from cache when it is
 * warm and writes it otherwise; every later request reads it.
 */
export const estimateTurnCost = (model: ModelId, shape: TurnShape, isWarm: boolean): number => {
  const entry = modelById(model)
  if (!entry) return Number.POSITIVE_INFINITY

  const prices = pricesFor(entry, shape.contextTokens)
  const first = shape.contextTokens * (isWarm ? prices.cacheRead : prices.cacheWrite)
  const later = Math.max(0, shape.requests - 1) * shape.contextTokens * prices.cacheRead

  return (first + later + shape.outputTokens * prices.output) / 1_000_000
}

/** Warm: the model answered within the TTL over at least half of today's context. */
export const isCacheWarm = (
  lastUse: LastUse | undefined,
  contextTokens: number,
  nowMs: number,
  ttlMinutes: number,
): boolean =>
  lastUse !== undefined && nowMs - lastUse.atMs < ttlMinutes * 60_000 && lastUse.contextTokens >= contextTokens / 2
