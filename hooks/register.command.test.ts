import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { runTurn, world } from './testkit.ts'

const TRIVIAL = 'Fix the typo in README.md'
const route = async ($: Engine, args = ''): Promise<string> =>
  (await $.command.run({ command: 'route', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })).text ?? ''

test('the command is registered when the session starts', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '.', surface: null, isInteractive: false })

  expect(w.commands).toEqual(['route'])
})

test('before any turn the report says so', async ($, on) => {
  world(on)

  expect(await route($)).toBe(['mode: auto', 'base: not seen yet', 'route: none (on the session model)'].join('\n'))
})

test('after a routed turn the report shows the route and why', async ($, on) => {
  world(on)
  await runTurn($, 't1', TRIVIAL)
  const text = await route($)

  expect(text).toContain('mode: auto\nbase: claude-opus-5-5\nroute: haiku · medium (trivial-edit)\n')
  expect(text).toMatch(/turn 1: rule 9, rules, trivial-edit -> claude-haiku-5-5 \(stay \$0\.0100, move \$0\.000\d\)$/)
})

test('a session model outside the catalog is named as such', async ($, on) => {
  world(on)
  await runTurn($, 't1', TRIVIAL, 'claude-opus-5')

  expect(await route($)).toContain('base: claude-opus-5 (not in the catalog; not routing)')
})

test('off stops routing and auto brings the earlier route back', async ($, on) => {
  const w = world(on)
  await runTurn($, 't1', TRIVIAL)
  expect(await route($, 'off')).toContain('mode: off')
  expect(w.status.at(-1)).toBeUndefined()
  await runTurn($, 't2', TRIVIAL)
  expect(await route($, 'auto')).toContain('mode: auto')
  await runTurn($, 't3', 'ok')

  expect(w.sent).toEqual(['main:claude-haiku-5-5:medium', 'main:claude-opus-5-5:high', 'main:claude-haiku-5-5:medium'])
})

test('pin holds one model, classifies nothing, and leaves effort alone', async ($, on) => {
  const w = world(on)
  expect(await route($, 'pin Fable')).toContain('mode: pinned (claude-fable-5-1)')
  expect(w.status.at(-1)).toBe('route: fable (pinned)')
  await runTurn($, 't1', TRIVIAL)
  await runTurn($, 't2', 'Add a createdAt field to the invoice model and expose it in the list endpoint')

  expect(w.sent).toEqual(['main:claude-fable-5-1:high', 'main:claude-fable-5-1:high'])
  expect(w.asked).toEqual([])
})

test('a wrong argument changes nothing and says what is accepted', async ($, on) => {
  world(on)
  expect(await route($, 'pin gpt')).toBe('autoroute: unknown model "gpt". Use haiku, sonnet, opus or fable.')
  expect(await route($, 'pin')).toBe('autoroute: unknown model "". Use haiku, sonnet, opus or fable.')
  expect(await route($, 'faster')).toBe('autoroute: use /route, /route off, /route auto, or /route pin <haiku|sonnet|opus|fable>.')
  expect(await route($)).toContain('mode: auto')
})
