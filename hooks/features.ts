/** Prompt text to a feature record. Pure: no engine calls, no state. */

const RE = {
  trivialVerb:
    /\b(typo|misspell|spelling|rename|reformat|prettier|lint|bump the|bump version|add a comment|remove unused|delete unused|drop the (trailing|unused|dead)|trailing whitespace|dead code|unused import|sort imports|reorder imports|update the copyright|fix indentation|change the (label|string|text|wording|copy)|typfout|spelfout|tikfout|hernoem|formatteer|opmaak|verwijder ongebruikte|ongebruikte import|pas de (tekst|titel|label) aan)\b/i,
  mechanical:
    /\b(all|every|everything|each of the|the rest of|across (the|all)|throughout|everywhere|consistently|the same (change|way|fix)|one by one|for each|still (uses?|points? at|references?|calls?)|alle|elke|elk|overal|in het hele project|in de hele codebase|dezelfde (wijziging|aanpassing)|een voor een)\b/i,
  debug:
    /\b(bug|broken|crash(es|ing)?|error|exception|fail(s|ed|ing)?|regression|stack ?trace|traceback|not working|doesn'?t work|returns? (null|undefined|500)|(shows?|showing|returns?|displays?|gives?) (duplicates?|nothing|the wrong|an? (empty|blank))|(comes?|coming) out wrong|(is|are|looks?) (wrong|incorrect|off)|after the (last )?(deploy|release|merge|upgrade)|kapot|crasht|foutmelding|fout|werkt niet|doet het niet|mislukt|klopt niet|gaat mis)\b/i,
  debugHard:
    /\b(intermittent|flaky|flakey|sometimes|occasionally|race condition|deadlock|heisenbug|only in (prod|production|ci)|but only in|works? (locally|on my machine)|can'?t reproduce|cannot reproduce|no idea why|unclear why|randomly|soms|af en toe|willekeurig|niet reproduceerbaar|alleen in productie|geen idee waarom)\b/i,
  architecture:
    /\b(architect(ure)?|design|approach|should we|trade[- ]?offs?|options?|alternatives|strategy|rfc|adr|proposal|pros and cons|how should|what'?s the best way|schema design|api contract|boundaries|decide whether|need to (decide|choose)|choose between|worth (doing|splitting|moving)|architectuur|ontwerp|aanpak|afweging(en)?|moeten we|zullen we|wat is de beste manier|opties|alternatieven|voor- en nadelen)\b/i,
  research:
    /\b(how does|where is|where does|what is|what does|which file|explain|walk (me )?through|understand|find (the|all|where)|trace (the|through)|why does .* exist|show me|what happens when|hoe werkt|waar staat|waar wordt|waar zit|wat doet|welk bestand|leg uit|zoek uit|laat zien|wat gebeurt er als)\b/i,
  longHorizon:
    /\b(refactor|migrat(e|ion)|rewrite|port (the|this|all)|move all .* (to|onto|over to)|upgrade .* across|whole (codebase|repo|project)|entire (codebase|repo|project)|across (all|every) (module|service|package)|touches (most|many|all|every)|multi[- ]?(day|week)|migreer|migratie|herschrijf|hele (codebase|repo|project))\b/i,
  // Only phrases that say the last attempt failed. This acts (rules 4 and 5),
  // so a bare "no", "nope" or "again" must not match.
  stillBroken:
    /\b(still (broken|failing|fails|doesn'?t|not)|same error|didn'?t work|that didn'?t|werkt nog steeds niet|nog steeds (kapot|fout|niet)|dezelfde fout|zelfde fout|dat werkte niet)\b/i,
  // The path segment is length-bounded on purpose: an unbounded quantifier
  // backtracks catastrophically on a large pasted blob.
  filePath:
    /(?:^|[\s"'`([{,])[\w@.\\/-]{1,120}\.(ts|tsx|js|jsx|mjs|cjs|cs|java|py|go|rb|rs|php|sql|json|ya?ml|md|css|scss|html|razor|cshtml)\b/i,
  stackTrace:
    /(^\s+at\s+\S|Traceback \(most recent call last\)|^\s*File ".*", line \d+|\bat [\w.$]+\(.*:\d+:\d+\)|Unhandled exception)/m,
  codeBlock: /```/,
  question: /\?\s*$/,
}

export type Features = {
  words: number
  short: boolean
  long: boolean
  trivialVerb: boolean
  mechanical: boolean
  debug: boolean
  debugHard: boolean
  architecture: boolean
  research: boolean
  longHorizon: boolean
  stillBroken: boolean
  hasFilePath: boolean
  hasStackTrace: boolean
  hasCodeBlock: boolean
  isQuestion: boolean
  consecutiveTestFailures: number
}

const WINDOW = 4000

/**
 * The head and tail of a long prompt. The head carries the instruction, the
 * tail the pasted output; the middle of a large paste says nothing more.
 */
export const windowed = (text: string): string =>
  text.length <= WINDOW * 2 ? text : `${text.slice(0, WINDOW)}\n…\n${text.slice(-WINDOW)}`

export const extract = (prompt: string, consecutiveTestFailures = 0): Features => {
  const text = windowed(prompt)
  const trimmed = prompt.trim()
  const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length

  return {
    words,
    short: words > 0 && words <= 12,
    long: words >= 60,
    trivialVerb: RE.trivialVerb.test(text),
    mechanical: RE.mechanical.test(text),
    debug: RE.debug.test(text),
    debugHard: RE.debugHard.test(text),
    architecture: RE.architecture.test(text),
    research: RE.research.test(text),
    longHorizon: RE.longHorizon.test(text),
    stillBroken: RE.stillBroken.test(text),
    hasFilePath: RE.filePath.test(text),
    hasStackTrace: RE.stackTrace.test(text),
    hasCodeBlock: RE.codeBlock.test(text),
    isQuestion: RE.question.test(text),
    consecutiveTestFailures,
  }
}

const OVERRIDE = /(^|\s)!(haiku|sonnet|opus|fable)\b/i

/** The alias a `!alias` token names, lower-cased; undefined when there is none. */
export const detectOverride = (prompt: string): string | undefined =>
  OVERRIDE.exec(windowed(prompt))?.[2]?.toLowerCase()

const TEST_COMMAND =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|jest|vitest)\b|\bnpx\s+(?:jest|vitest)\b|\b(?:jest|vitest|pytest|rspec|phpunit)\b|\bgo\s+test\b|\bdotnet\s+test\b|\bmvn\b[^\n]*\btest\b|\.?\/?gradlew?\b[^\n]*\btest\b|\bcargo\s+test\b|\bpython\s+-m\s+(?:pytest|unittest)\b|\bnode\s+--test\b/i

export const isTestCommand = (command: string): boolean => TEST_COMMAND.test(command)

// "0 failed" is a pass: the count must start with a non-zero digit.
const FAILURE_IN_OUTPUT =
  /\b[1-9]\d*\s+(?:failed|failing)\b|\bFAIL\b|\bFAILED\b|Test Run Failed|Tests? failed|BUILD FAILURE|AssertionError/

/**
 * Whether a test run failed: by its exit status, or by what the runner
 * printed. A piped run (`npm test | tail`) exits with the pipe's status, so
 * the text is the only sign there.
 */
export const didTestRunFail = (hasErrored: boolean, output: string): boolean =>
  hasErrored || FAILURE_IN_OUTPUT.test(windowed(output))
