/** Feature record to a task class. Deterministic weighted scoring, no model call. */
import { CELLS } from './catalog.ts'
import type { TaskClass } from './catalog.ts'
import type { Features } from './features.ts'

export type Classification = { cls: TaskClass | undefined; margin: number; fired: readonly string[] }

type Rule = {
  id: string
  /** "Nothing else matched" is not evidence: a class reached only by these is capped. */
  isResidual?: true
  on: (f: Features) => boolean
  w: Partial<Record<TaskClass, number>>
}

const RULES: readonly Rule[] = [
  { id: 'trivial-verb', on: f => f.trivialVerb, w: { 'trivial-edit': 3 } },
  { id: 'short-and-scoped', on: f => f.short && f.hasFilePath, w: { 'trivial-edit': 2 } },
  { id: 'short-no-detail', on: f => f.short && !f.hasFilePath && !f.isQuestion, w: { 'trivial-edit': 0.5 } },

  { id: 'mechanical-scope', on: f => f.mechanical, w: { 'impl-mechanical': 2.5, 'trivial-edit': 0.5 } },
  { id: 'mechanical-and-paths', on: f => f.mechanical && f.hasFilePath, w: { 'impl-mechanical': 1 } },

  { id: 'debug-language', on: f => f.debug, w: { 'debug-repro': 2.5, architecture: -1 } },
  { id: 'stack-trace', on: f => f.hasStackTrace, w: { 'debug-repro': 3, architecture: -2, research: -1 } },
  { id: 'code-block', on: f => f.hasCodeBlock, w: { 'debug-repro': 0.5 } },
  { id: 'no-repro', on: f => f.debugHard, w: { 'debug-hard': 4, 'debug-repro': -1.5 } },
  { id: 'repeated-failures', on: f => f.consecutiveTestFailures >= 2, w: { 'debug-hard': 2.5 } },

  { id: 'design-language', on: f => f.architecture, w: { architecture: 3 } },
  { id: 'design-and-long', on: f => f.architecture && f.long, w: { architecture: 1.5 } },
  { id: 'open-question', on: f => f.isQuestion && !f.hasFilePath, w: { architecture: 0.5, research: 1 } },

  { id: 'research-language', on: f => f.research, w: { research: 3 } },
  { id: 'question-form', on: f => f.isQuestion, w: { research: 1, 'trivial-edit': -1 } },

  { id: 'long-horizon', on: f => f.longHorizon, w: { 'long-refactor': 3 } },
  { id: 'long-horizon-wide', on: f => f.longHorizon && f.mechanical, w: { 'long-refactor': 1.5, 'impl-mechanical': 1 } },

  {
    id: 'implementation-shape',
    isResidual: true,
    on: f => !f.isQuestion && !f.debug && !f.architecture && f.words > 8,
    w: { 'impl-standard': 2 },
  },
  {
    id: 'implementation-paths',
    isResidual: true,
    on: f => !f.isQuestion && f.hasFilePath && f.words > 12,
    w: { 'impl-standard': 1 },
  },
]

/** Below this total score no class is named, however cleanly it leads. */
const MIN_EVIDENCE = 1.5
const RESIDUAL_MARGIN_CAP = 0.15
export const ABSTAIN_MARGIN = 0.2

const NONE: Classification = { cls: undefined, margin: 0, fired: [] }

export const classify = (features: Features): Classification => {
  const scores = new Map<TaskClass, number>((Object.keys(CELLS) as TaskClass[]).map(cls => [cls, 0]))
  const hits = RULES.filter(rule => rule.on(features))

  for (const rule of hits)
    for (const [cls, weight] of Object.entries(rule.w) as [TaskClass, number][])
      scores.set(cls, (scores.get(cls) ?? 0) + weight)

  const fired = hits.map(rule => rule.id)
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  if (!top || top[1] < MIN_EVIDENCE) return { ...NONE, fired }

  const [cls, score] = top
  const separation = Math.max(0, Math.min(1, (score - (second?.[1] ?? 0)) / score))
  const contributors = hits.filter(rule => (rule.w[cls] ?? 0) > 0)
  const isResidualOnly = contributors.length > 0 && contributors.every(rule => rule.isResidual)
  const margin = isResidualOnly ? Math.min(separation, RESIDUAL_MARGIN_CAP) : separation

  return { cls, margin: Number(margin.toFixed(3)), fired }
}

export const isConfident = (read: Classification): boolean => read.cls !== undefined && read.margin >= ABSTAIN_MARGIN
