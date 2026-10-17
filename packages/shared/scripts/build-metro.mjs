// Builds src/metro/data.ts from the CSV files in src/metro/sources (see src/metro/SOURCE.md).
// Usage: pnpm --filter @masl/shared metro:build
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const COLOR_RE = /^#[0-9a-f]{6}$/;
const ID_RE = /^\d{1,2}a?-[a-z0-9-]+$/;

const TRANSLIT = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Deterministic Latin slug of a Russian station name: «Улица 1905 года» → ulitsa-1905-goda. */
export function slugify(name) {
  const latin = [...name.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  return latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Rows of a `;`-separated file with a header; checks the header and the column count. */
function readCsv(file, columns) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const names = header.split(';');
  for (const column of columns) {
    if (!names.includes(column)) throw new Error(`${file}: нет колонки ${column}`);
  }
  return lines.map((line, i) => {
    const cells = line.split(';');
    if (cells.length !== names.length) throw new Error(`${file}:${i + 2}: ожидалось ${names.length} колонок`);
    return Object.fromEntries(names.map((name, j) => [name, cells[j].trim()]));
  });
}

function coordinate(value, where) {
  if (!/^\d{2}\.\d+$/.test(value)) throw new Error(`${where}: координата «${value}» не число`);
  return Number(value);
}

/** Optional `id` cell that pins a committed id after a rename or a move; empty means derived. */
function pinnedId(value, where) {
  if (!value) return null;
  if (!ID_RE.test(value)) throw new Error(`${where}: id «${value}» не в формате линия-название`);
  return value;
}

const quote = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Builds the text of data.ts: Metro4all stations with remap.csv applied, plus additions.csv.
 * Station id = `${line id lowercased}-${slug of the name}` unless the optional `id` column of remap.csv or
 * additions.csv pins it; the output is sorted by id and has no timestamps.
 * Line kinds are checked by the MetroKind type, the id format by metro.test.ts.
 */
export function buildMetroData(sourcesDir) {
  const lines = readCsv(join(sourcesDir, 'lines.csv'), ['id', 'name_ru', 'color', 'kind']).map((row) => {
    if (!COLOR_RE.test(row.color)) throw new Error(`lines.csv: цвет «${row.color}» линии ${row.id}`);
    return { id: row.id, name: row.name_ru, color: row.color, kind: row.kind };
  });
  const lineIds = new Set(lines.map((line) => line.id));
  if (lineIds.size !== lines.length) throw new Error('lines.csv: повторяется id линии');

  const remap = new Map();
  for (const row of readCsv(join(sourcesDir, 'remap.csv'), [
    'id_station',
    'line_id',
    'name_ru',
    'closed',
    'id',
  ])) {
    if (remap.has(row.id_station)) throw new Error(`remap.csv: станция ${row.id_station} указана дважды`);
    if (row.closed !== '' && row.closed !== '1')
      throw new Error(`remap.csv: closed «${row.closed}», нужно 1 или пусто`);
    remap.set(row.id_station, row);
  }

  const raw = [];
  const metro4allIds = new Set();
  const metro4all = readCsv(join(sourcesDir, 'metro4all-stations.csv'), [
    'id_station',
    'id_line',
    'name_ru',
    'lat',
    'lon',
  ]);
  for (const row of metro4all) {
    const fix = remap.get(row.id_station);
    const where = `metro4all-stations.csv: станция ${row.id_station}`;
    metro4allIds.add(row.id_station);
    raw.push({
      lineId: fix?.line_id || row.id_line,
      name: fix?.name_ru || row.name_ru,
      lat: coordinate(row.lat, where),
      lng: coordinate(row.lon, where),
      closed: fix?.closed === '1',
      pinned: pinnedId(fix?.id, `remap.csv: станция ${row.id_station}`),
      where,
    });
  }
  for (const key of remap.keys()) {
    if (!metro4allIds.has(key)) throw new Error(`remap.csv: в Metro4all нет станции ${key}`);
  }

  const additions = readCsv(join(sourcesDir, 'additions.csv'), [
    'line_id',
    'name_ru',
    'lat',
    'lng',
    'source_url',
  ]);
  additions.forEach((row, i) => {
    const where = `additions.csv:${i + 2}`;
    if (!row.source_url.startsWith('https://')) throw new Error(`${where}: нет source_url`);
    raw.push({
      lineId: row.line_id,
      name: row.name_ru,
      lat: coordinate(row.lat, where),
      lng: coordinate(row.lng, where),
      closed: false,
      pinned: pinnedId(row.id, where),
      where,
    });
  });

  const seen = new Set();
  const stations = raw.map(({ lineId, name, lat, lng, closed, pinned, where }) => {
    if (!lineIds.has(lineId)) throw new Error(`${where}: неизвестная линия ${lineId}`);
    const id = pinned ?? `${lineId.toLowerCase()}-${slugify(name)}`;
    if (seen.has(id)) throw new Error(`${where}: id ${id} уже занят`);
    seen.add(id);
    return { id, name, lineId, lat, lng, closed };
  });
  stations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const lineRows = lines.map(
    (line) =>
      `  { id: ${quote(line.id)}, name: ${quote(line.name)}, color: ${quote(line.color)}, kind: ${quote(line.kind)} },`,
  );
  const stationRows = stations.map(
    (s) =>
      `  { id: ${quote(s.id)}, name: ${quote(s.name)}, lineId: ${quote(s.lineId)}, lat: ${s.lat}, lng: ${s.lng}` +
      `${s.closed ? ', closed: true' : ''} },`,
  );
  return [
    '// GENERATED by scripts/build-metro.mjs from src/metro/sources; do not edit by hand.',
    '// Regenerate with: pnpm --filter @masl/shared metro:build',
    '// Sources: Metro4all (NextGIS) and Wikipedia, CC BY-SA 4.0',
    '// (https://creativecommons.org/licenses/by-sa/4.0/); see SOURCE.md.',
    "import type { MetroKind } from '../enums.js';",
    '',
    'export interface MetroLine {',
    '  id: string;',
    '  name: string;',
    '  color: `#${string}`;',
    '  kind: MetroKind;',
    '}',
    '',
    'export interface MetroStation {',
    '  id: string;',
    '  name: string;',
    '  lineId: string;',
    '  lat: number;',
    '  lng: number;',
    '  /** Removed from the network; kept so that the id is never reused. */',
    '  closed?: true;',
    '}',
    '',
    'export const METRO_LINES: readonly MetroLine[] = [',
    ...lineRows,
    '];',
    '',
    'export const MOSCOW_STATIONS: readonly MetroStation[] = [',
    ...stationRows,
    '];',
    '',
  ].join('\n');
}

/** Ids of an existing data.ts: a committed id must never disappear (rename or move keeps the id). */
function committedIds(file) {
  if (!existsSync(file)) return [];
  return [...readFileSync(file, 'utf8').matchAll(/\{ id: '([^']+)', name: [^}]*lineId:/g)].map((m) => m[1]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const metroDir = fileURLToPath(new URL('../src/metro/', import.meta.url));
  const target = join(metroDir, 'data.ts');
  const text = buildMetroData(join(metroDir, 'sources'));
  const lost = committedIds(target).filter((id) => !text.includes(`{ id: '${id}',`));
  if (lost.length > 0) {
    console.error(
      `Пропали id станций: ${lost.join(', ')}. Id не меняются и не переиспользуются: закрытую станцию ` +
        'помечают closed, а при переименовании или переносе на другую линию прежний id записывают в колонку id ' +
        'файла remap.csv или additions.csv (SOURCE.md).',
    );
    process.exit(1);
  }
  writeFileSync(target, text);
  console.log(`Записан ${target}`);
}
