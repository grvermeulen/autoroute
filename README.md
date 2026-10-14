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

## Results

Twelve coding tasks, each run ten times without a plugin and ten times with
autoroute, every run starting on Claude Opus 5.5:

| | No plugin | autoroute | Change |
|---|---|---|---|
| Runs passed | 120/120 | 119/120 | |
| Cost | $18.17 | $11.14 | −39% |
| All tokens | 12,975,788 | 11,676,506 | −10.0% |
| Output tokens | 331,445 | 307,356 | −7.3% |
| Cache read tokens | 11,510,809 | 9,873,398 | −14.2% |
| Cache write tokens | 1,131,584 | 1,454,718 | +28.6% |
| Run time | 4,079 s | 3,219 s | −21.1% |

Cost falls much further than tokens do: the saving comes from sending work to
cheaper models, not from using fewer tokens. Cache writes go up because a model
the session switches to has to build its own prompt cache; the cost check
weighs that before it switches down.

### By type of work

Change in mean cost and time per run, against no plugin. Without the plugin
every run passed.

| Type of work | Tasks | autoroute sent it to | Passed | Cost | Time |
|---|---|---|---|---|---|
| Trivial edit | typo-fix, rename-function | Haiku, some Sonnet | 20/20 | −74% | −21% |
| Mechanical change | mechanical-logger | Sonnet | 10/10 | −48% | −30% |
| Standard implementation | implement-validator, implement-validator-nl, feature-with-tests | Sonnet | 30/30 | −47% | −19% |
| Bug with a stack trace | bug-stacktrace | Sonnet | 10/10 | −50% | −33% |
| Question about the code | research-question | Sonnet | 10/10 | −60% | −48% |
| Intermittent bug | bug-intermittent | Opus | 10/10 | −6% | −4% |
| Design decision | architecture-question | Opus | 9/10 | +2% | +9% |
| Multi-turn session | session-build (7 turns), session-debug (6 turns) | Haiku, Sonnet or Opus, turn by turn | 20/20 | −31% | −20% |

Routine work (small edits, implementation to a clear spec, a bug that
reproduces, a question about how the code works) moves to Haiku or Sonnet and
costs about half as much or less. Hard work (an intermittent bug, a design
decision) stays on the session's model by design, so it costs and takes about
the same; the design question's +2% and +9% are within its run-to-run spread.
Real sessions mix the two, as the two multi-turn tasks do: they cost 31% less.
What you save depends on your own mix.

The typo fix alone costs 97% less on Haiku. The rename prompt is one the
keyword rules cannot place, and the Haiku label it gets varies: it went to
Sonnet in 7 of 10 runs, which is why trivial edits as a whole save 74%.

### How it was tested

- `claude plugin eval` on Claude Code 2.1.295, on 13 and 14 October 2026. The
  jury model was Claude Sonnet 5.5.
- The tasks work on a small JavaScript shop project (cart, orders, discounts,
  inventory). A code task passes when hidden tests, never shown to the model,
  pass on the files the run left behind. The two question tasks are judged by a
  jury of three model votes.
- Both arms also loaded a small eval-only helper that copies the project into
  each run and types the scripted follow-up prompts of the two session tasks.
  A question run with and without the helper cost the same, $0.045 both ways.
- Cost is each run's requests at list prices, cache writes included, plus the
  jury's calls for the two question tasks. Time is wall-clock seconds per run.
- When its keyword rules cannot place a prompt, autoroute asks Haiku for a
  label. A run's bill does not hold that call, so it was measured by replaying
  the same requests: 100 calls in all (43% of turns), about 390 input and 10
  output tokens each, $0.0044 together, or 0.04% of the cost. They are in the
  token rows above, and their time, about one second each, is inside the run
  times.
- The one failed run was a design question that autoroute kept on Opus, the
  model the baseline uses. In an earlier eval of three runs per task, the
  baseline failed the same question once.

### What this does not show

- Twelve tasks on one small codebase show that the saving repeats for these
  kinds of work, not that it carries over to every codebase, or to long
  sessions with large contexts.
- The eval sandbox gives no shell on Windows, so no run could execute tests:
  every code task was a single-shot edit, and the move back up after two
  failing test runs was not exercised.
- The two arms ran one after the other, so a drift in API response times is
  not controlled for.
- The twelve-task suite and its harness are not part of this repository.

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
