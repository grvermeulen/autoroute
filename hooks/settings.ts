/** The mod's options as `register` receives them. A value out of range reads as unset. */

export type Settings = { useFallback: boolean; savingMargin: number; cacheTtlMinutes: number }

export const DEFAULTS: Settings = { useFallback: true, savingMargin: 0.2, cacheTtlMinutes: 60 }

const within = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback

export const readSettings = (options: Readonly<Record<string, unknown>>): Settings => ({
  useFallback: options.fallbackClassifier !== false,
  // At 1 or above no downgrade could ever pass; below 0 every one would.
  savingMargin: within(options.savingMargin, 0, 0.95, DEFAULTS.savingMargin),
  // Zero or less would make every cache cold; a day is the longest worth assuming.
  cacheTtlMinutes: within(options.cacheTtlMinutes, 1, 24 * 60, DEFAULTS.cacheTtlMinutes),
})
