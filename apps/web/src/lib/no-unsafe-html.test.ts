import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T-WEB-1: user text (titles, descriptions, names, addresses) reaches the DOM only through
// Svelte's escaping, and browser storage only through lib/storage.ts.

const SRC = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'lib/no-unsafe-html.test.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(svelte|ts)$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Source without whole-line comments, so a comment that names an API doesn't count as using it.
 * Deliberately not a parser: only lines that start as a comment are dropped, so a `//` or `/*`
 * inside a string can never hide code.
 */
function code(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(line))
    .join('\n');
}

const files = sourceFiles(SRC)
  .map((path) => ({ path: relative(SRC, path).split('\\').join('/'), source: readFileSync(path, 'utf8') }))
  .filter((file) => file.path !== SELF);

function offenders(pattern: RegExp, skip: (path: string) => boolean = () => false): string[] {
  return files.filter((file) => !skip(file.path) && pattern.test(code(file.source))).map((file) => file.path);
}

describe('no unsafe HTML sinks', () => {
  it('does not let strings that look like comments hide a sink', () => {
    expect(code("const g = 'a //b'; document.body.innerHTML = g;")).toContain('innerHTML');
    expect(code("const glob = '**/*.svelte';\nel.innerHTML = glob;\n/* */")).toContain('innerHTML');
    expect(code('// el.innerHTML\n * innerHTML\n<!-- {@html} -->')).not.toMatch(/innerHTML|@html/);
  });

  it('scans the app sources', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((file) => file.path === 'lib/components/Avatar.svelte')).toBe(true);
  });

  it('has no raw HTML rendering', () => {
    expect(offenders(/\{@html\b/)).toEqual([]);
    expect(offenders(/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/)).toEqual([]);
    // MapLibre popups: setDOMContent or setText only.
    expect(offenders(/\bsetHTML\s*\(/)).toEqual([]);
  });

  it('touches browser storage only in lib/storage.ts', () => {
    expect(offenders(/\b(localStorage|sessionStorage)\b/, (path) => path === 'lib/storage.ts')).toEqual([]);
  });

  it('loads every image without a Referer', () => {
    const images = files.flatMap((file) =>
      [...code(file.source).matchAll(/<img\b[^>]*>/g)].map((match) => ({ path: file.path, tag: match[0] })),
    );
    expect(images.some((image) => image.path === 'lib/components/Avatar.svelte')).toBe(true);
    expect(images.filter((image) => !/referrerpolicy="no-referrer"/.test(image.tag))).toEqual([]);
  });
});
