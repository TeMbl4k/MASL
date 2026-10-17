import { describe, expect, it } from 'vitest';
import {
  foldForSearch,
  noMarkFlood,
  normalizeMultiLine,
  normalizeSingleLine,
  visibleLength,
} from './text.js';

const ch = (...codes: number[]) => String.fromCodePoint(...codes);
const RIGHT_TO_LEFT_OVERRIDE = ch(0x202e);
const LEFT_TO_RIGHT_ISOLATE = ch(0x2066);
const ZERO_WIDTH_SPACE = ch(0x200b);
const ZERO_WIDTH_JOINER = ch(0x200d);
const BOM = ch(0xfeff);
const NUL = ch(0);
const DEL = ch(0x7f);
const NBSP = ch(0xa0);
const LINE_SEPARATOR = ch(0x2028);
const COMBINING_BREVE = ch(0x306);
const COMBINING_ACUTE = ch(0x301);
const VARIATION_SELECTOR_16 = ch(0xfe0f);
const HANGUL_FILLER = ch(0x3164);
const BRAILLE_BLANK = ch(0x2800);

describe('normalizeSingleLine', () => {
  it('composes to NFC, so «й» typed as и + breve is one character', () => {
    const decomposed = `Мои${COMBINING_BREVE}`;
    expect(decomposed).toHaveLength(4);
    expect(normalizeSingleLine(decomposed)).toBe('Мой');
  });

  it('strips bidi overrides, zero-width characters, BOM and control characters', () => {
    expect(
      normalizeSingleLine(
        `${RIGHT_TO_LEFT_OVERRIDE}Па${ZERO_WIDTH_SPACE}дел${LEFT_TO_RIGHT_ISOLATE} 2${NUL}×2${DEL}${BOM}`,
      ),
    ).toBe('Падел 2×2');
  });

  it('keeps the zero width joiner of emoji sequences', () => {
    const family = `👩${ZERO_WIDTH_JOINER}👩${ZERO_WIDTH_JOINER}👧`;
    expect(normalizeSingleLine(`Семьёй ${family}`)).toBe(`Семьёй ${family}`);
  });

  it('turns line breaks, tabs and unicode spaces into single spaces and trims', () => {
    expect(normalizeSingleLine('  Падел\n\t2×2 \r\n в   Лужниках  ')).toBe('Падел 2×2 в Лужниках');
    expect(normalizeSingleLine(`a${NBSP}${LINE_SEPARATOR}b`)).toBe('a b');
  });

  it('returns an empty string for blank or invisible-only input', () => {
    expect(normalizeSingleLine(`  ${ZERO_WIDTH_SPACE}\n${BOM} `)).toBe('');
  });

  it('treats Hangul fillers and the braille blank as spaces', () => {
    expect(normalizeSingleLine(HANGUL_FILLER.repeat(3))).toBe('');
    expect(normalizeSingleLine(ch(0x115f, 0x1160, 0x3164, 0xffa0))).toBe('');
    expect(normalizeSingleLine(BRAILLE_BLANK.repeat(3))).toBe('');
    expect(normalizeSingleLine(`Падел${BRAILLE_BLANK}2×2${HANGUL_FILLER}`)).toBe('Падел 2×2');
  });

  it('drops joiners that join nothing and words with nothing visible', () => {
    const J = ZERO_WIDTH_JOINER;
    expect(normalizeSingleLine(J.repeat(3))).toBe('');
    expect(normalizeSingleLine(`${J} ${J} ${J}`)).toBe('');
    expect(normalizeSingleLine(`${VARIATION_SELECTOR_16}${J}${VARIATION_SELECTOR_16}`)).toBe('');
    expect(normalizeSingleLine(`${J}Падел${J} ${J}2×2${J}`)).toBe('Падел 2×2');
    expect(normalizeSingleLine(`Падел ${VARIATION_SELECTOR_16} 2×2`)).toBe('Падел 2×2');
    expect(normalizeSingleLine(`👩${J}${J}👧`)).toBe(`👩${J}👧`);
  });
});

describe('visibleLength', () => {
  it('does not count joiners and variation selectors', () => {
    expect(visibleLength('Абв')).toBe(3);
    expect(visibleLength(`а${VARIATION_SELECTOR_16}${VARIATION_SELECTOR_16}`)).toBe(1);
    // Two surrogate pairs around one joiner, as zod counts string length.
    expect(visibleLength(`👩${ZERO_WIDTH_JOINER}👧`)).toBe(4);
  });
});

describe('normalizeMultiLine', () => {
  it('keeps line breaks, collapses spaces and trims each line', () => {
    expect(normalizeMultiLine('  Берите   ракетки \r\nУровень\tлюбой  ')).toBe(
      'Берите ракетки\nУровень любой',
    );
  });

  it('allows at most two blank lines in a row and none at the edges', () => {
    expect(normalizeMultiLine('\n\n  \nРаз\n\n\n\n\n\nДва\n\nТри\n \n')).toBe('Раз\n\n\nДва\n\nТри');
    expect(normalizeMultiLine('a\n\n\n\nb')).toBe('a\n\n\nb');
    expect(normalizeMultiLine('a\n\n\nb')).toBe('a\n\n\nb');
    expect(normalizeMultiLine('a\n\nb')).toBe('a\n\nb');
  });

  it('turns lines with nothing visible into blank lines', () => {
    expect(normalizeMultiLine(`Раз\n${HANGUL_FILLER}${BRAILLE_BLANK}\nДва`)).toBe('Раз\n\nДва');
    expect(normalizeMultiLine(`${ZERO_WIDTH_JOINER}\n${VARIATION_SELECTOR_16}`)).toBe('');
  });

  it('treats CR, form feed and the unicode line separator as line breaks', () => {
    expect(normalizeMultiLine(`a\rb${LINE_SEPARATOR}c\fd`)).toBe('a\nb\nc\nd');
  });

  it('strips invisible characters without joining lines', () => {
    expect(normalizeMultiLine(`Раз${RIGHT_TO_LEFT_OVERRIDE}\n${ZERO_WIDTH_SPACE}Два${NUL}`)).toBe('Раз\nДва');
  });
});

describe('noMarkFlood', () => {
  it('accepts ordinary text with one or two marks in a row', () => {
    expect(noMarkFlood('Падел 2×2')).toBe(true);
    expect(noMarkFlood(`замо${COMBINING_ACUTE}к`)).toBe(true);
    // Keycap emoji: digit + VS16 + combining enclosing keycap.
    expect(noMarkFlood(`1${ch(0xfe0f, 0x20e3)}`)).toBe(true);
  });

  it('rejects three or more combining marks in a row', () => {
    expect(noMarkFlood(`Z${COMBINING_ACUTE}${COMBINING_BREVE}${ch(0x308)}algo`)).toBe(false);
  });
});

describe('foldForSearch', () => {
  it('lower-cases, folds ё into е and normalises spaces', () => {
    expect(foldForSearch('  Семёновская ')).toBe('семеновская');
    expect(foldForSearch('ЁЛКИ\tПАЛКИ')).toBe('елки палки');
  });
});
