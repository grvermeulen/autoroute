# autoroute

Picks the Claude model for each turn of a session, and for each subagent, from
what the prompt asks for.

- Simple work goes to a cheaper model, but only when an estimate that counts
  the prompt cache says the switch saves at least 20%.
- Hard work (architecture, a bug with no reproduction, a large refactor) never
  runs below the session's own model, and may run above it.
- Two failing test runs in a row, or a prompt saying the last attempt did not
  work, move the session back up.
- A route stays until a later prompt gives a clear reason to change it.

## Install

At the prompt of a Claude Code session in a terminal:

    /plugin install autoroute --marketplace grvermeulen/autoroute

Answer `y` to add the marketplace, then pick a scope; the user scope comes
first. The next screen sets the options below, or keeps their defaults.
Routing starts in that session.

Built and tested on Claude Code 2.1.295. The one-line install needs 2.1.275 or
later. To try it for one session from a clone instead:

    claude --plugin-dir ./autoroute

## Seeing what it did

A route is sticky, in both directions. Two places show it:

- The status line shows the active route, for example
  `route: sonnet · high (impl-standard)`. It is empty while the session runs
  on its own model.
- `/route` prints the mode, the session model, the current route, and the last
  ten decisions with the rule that made each one.

## Control

| You type | Effect |
|---|---|
| `/route` | The report described above |
| `/route off` | No routing this session |
| `/route auto` | Routing on again, with the route it had before |
| `/route pin opus` | Every turn, and every built-in subagent, on that model (`haiku`, `sonnet`, `opus`, `fable`). Nothing is classified while pinned |
| `!opus` in a prompt | That model from this turn on. Works in `auto` mode only; ignored while pinned or off |

A model that did not answer is not used again in the session, and a toast says
so. Pin it again to retry it.

A session whose own model is not one of the four in `hooks/catalog.ts` is never
rerouted; `/route` says so.

A route made by `!model`, a trigger or a pin runs at the effort you set. If you
set none, it runs at the routed model's own default, not the session model's.

## What counts as a failing test run

A command that looks like a test run (`npm test`, `pytest`, `go test`,
`node --test`, and the like) counts as failing when it exits non-zero or when
its output reports failures (`2 failed`, `FAIL`, `AssertionError`). The second
check matters for piped runs such as `npm test | tail`, which exit with the
pipe's status. A command that was denied counts as neither.

## Options

Set in `/config`. A value outside its range reads as the default.

- **Fallback classifier** (on): when the keyword rules cannot place a prompt,
  one short Haiku call labels it. About $0.0002 and one second per prompt.
- **Saving margin** (0.2, from 0 to 0.95): how much cheaper, by estimate, a
  model must be before the router switches down.
- **Cache TTL (minutes)** (60, from 1 to 1440): how long a model's prompt
  cache is assumed to stay warm.

## Prices

Model prices are in `hooks/catalog.ts`, with the date they were last checked.
Update them there.

## Checks

    claude plugin validate .
    claude plugin test .

`evals/` holds two one-case checks that run for real against the API: `smoke`
(a prompt the rules place) and `fallback` (a prompt only the Haiku call can
place).

## License

MIT. See [LICENSE](LICENSE).
