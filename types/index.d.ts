export type AutorouteModel = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'claude-opus-5-5' | 'claude-fable-5-1'

export type AutorouteEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type AutorouteClass =
  | 'trivial-edit'
  | 'impl-mechanical'
  | 'impl-standard'
  | 'debug-repro'
  | 'research'
  | 'debug-hard'
  | 'architecture'
  | 'long-refactor'

/** A route other than the session's own model. `effort` is set only when a class chose the route. */
export type AutorouteRoute = { model: AutorouteModel; effort?: AutorouteEffort; cls?: AutorouteClass }

export type AutorouteDecision = {
  turn: number
  rule: number
  source: 'override' | 'rules' | 'fallback' | 'none'
  model: AutorouteModel
  cls?: AutorouteClass
  stay?: number
  move?: number
}

export type AutorouteSession = {
  mode: 'auto' | 'off' | 'pinned'
  pinned?: AutorouteModel
  route?: AutorouteRoute
  /** The session model as the engine last named it, suffix included. */
  base?: string
  turns: number
  failingTests: number
  lastUse: Partial<Record<AutorouteModel, { atMs: number; contextTokens: number }>>
  unavailable: AutorouteModel[]
  decisions: AutorouteDecision[]
}

declare module 'claude-code' {
  interface PluginState {
    autoroute: { session: AutorouteSession }
  }
}
