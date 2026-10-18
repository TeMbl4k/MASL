/**
 * Normalisation of user-entered text, shared by the API (via zod schemas) and the web,
 * so both count characters the same way.
 */

/**
 * Control and format characters (bidi overrides, zero-width spaces, BOM, NUL…), except
 * U+200D ZERO WIDTH JOINER, which emoji sequences need, and the whitespace controls,
 * which are turned into spaces or line breaks instead.
 */
const INVISIBLE = /(?![\u200D\t\n\v\f\r])[\p{Cc}\p{Cf}]/gu;
/** Letters and symbols that render as blank space (Hangul fillers, braille blank); treated as spaces. */
const BLANK = /[\u115F\u1160\u3164\uFFA0\u2800]/gu;
/** Invisible code points that survive INVISIBLE (U+200D, variation selectors…); they never count as content. */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
/** A zero width joiner at the edge of a word, or repeated, joins nothing. */
const LOOSE_JOINER = /^\u200D+|\u200D+$|\u200D(?=\u200D)/gu;
/** Three or more combining marks in a row: "Zalgo" text that overflows its line. */
const MARK_FLOOD = /\p{M}{3,}/u;

/** Characters a reader can see: the length without default-ignorable code points. */
export function visibleLength(value: string): number {
  return value.replace(IGNORABLE, '').length;
}

/** Whitespace runs collapsed to one space, loose joiners and words with nothing visible dropped, trimmed. */
function normalizeLine(line: string): string {
  return line
    .replace(BLANK, ' ')
    .split(/\s+/)
    .map((word) => word.replace(LOOSE_JOINER, ''))
    .filter((word) => visibleLength(word) > 0)
    .join(' ');
}

/**
 * One line: NFC, invisible characters removed, blank fillers and every whitespace run turned into
 * one space, words with nothing visible dropped, trimmed.
 */
export function normalizeSingleLine(value: string): string {
  return normalizeLine(value.normalize('NFC').replace(INVISIBLE, ''));
}

/**
 * Several lines: NFC, invisible characters removed, spaces collapsed and trimmed on each line,
 * at most two blank lines in a row, no blank lines at the start or the end.
 */
export function normalizeMultiLine(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?|[\u2028\u2029\v\f]/g, '\n')
    .replace(INVISIBLE, '')
    .split('\n')
    .map(normalizeLine)
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** True when the text has no run of 3+ combining marks. */
export function noMarkFlood(value: string): boolean {
  return !MARK_FLOOD.test(value);
}

/** Search key: one line, lower case, ё → е («Семёновская» matches «семеновская»). */
export function foldForSearch(value: string): string {
  return normalizeSingleLine(value).toLowerCase().replace(/ё/g, 'е');
}
