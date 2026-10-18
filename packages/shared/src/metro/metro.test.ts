import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildMetroData } from '../../scripts/build-metro.mjs';
import { MOSCOW_BOUNDS } from '../constants.js';
import { METRO_KINDS } from '../enums.js';
import {
  haversineMeters,
  METRO_ATTRIBUTION,
  METRO_LINES,
  MOSCOW_STATIONS,
  nearestStation,
  placeHint,
  searchStations,
  stationById,
} from './index.js';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const open = MOSCOW_STATIONS.filter((s) => !s.closed);
const lineKind = new Map(METRO_LINES.map((line) => [line.id, line.kind]));
const linesOf = (name: string) => open.filter((s) => s.name === name).map((s) => s.lineId);

/** Values of the optional `id` column of a sources CSV: ids pinned after a rename or a move. */
function pinnedIds(file: string): string[] {
  const [header = '', ...rows] = readFileSync(here(`./sources/${file}`), 'utf8')
    .trim()
    .split(/\r?\n/);
  const column = header.split(';').indexOf('id');
  return column < 0 ? [] : rows.map((row) => row.split(';')[column] ?? '').filter((id) => id !== '');
}

describe('metro dataset: ids and fields', () => {
  it('has unique ids in the line-name format', () => {
    const ids = MOSCOW_STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{1,2}a?-[a-z0-9-]+$/);
  });

  it('builds every id from its line unless the sources pin it', () => {
    const pinned = new Set([...pinnedIds('remap.csv'), ...pinnedIds('additions.csv')]);
    for (const s of MOSCOW_STATIONS) {
      if (!pinned.has(s.id)) expect(s.id.startsWith(`${s.lineId.toLowerCase()}-`), s.id).toBe(true);
    }
  });

  it('keeps a pinned id when remap.csv renames or moves a station', () => {
    const dir = mkdtempSync(join(tmpdir(), 'metro-'));
    try {
      cpSync(here('./sources'), dir, { recursive: true });
      const remap = join(dir, 'remap.csv');
      // Metro4all station 1 is «Бульвар Рокоссовского» on line 1: rename it, move it to line 2, keep its id.
      writeFileSync(remap, `${readFileSync(remap, 'utf8')}1;2;Тестовая;;1-bulvar-rokossovskogo;проверка\n`);
      const text = buildMetroData(dir);
      expect(text).toContain("{ id: '1-bulvar-rokossovskogo', name: 'Тестовая', lineId: '2',");
      expect(text).not.toContain("id: '2-testovaya'");
      writeFileSync(remap, `${readFileSync(remap, 'utf8')}2;;;;Bad Id;проверка\n`);
      expect(() => buildMetroData(dir)).toThrow(/Bad Id/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('references only known lines with hex colours and known kinds', () => {
    expect(new Set(METRO_LINES.map((line) => line.id)).size).toBe(METRO_LINES.length);
    for (const line of METRO_LINES) {
      expect(line.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(METRO_KINDS).toContain(line.kind);
    }
    for (const s of MOSCOW_STATIONS) expect(lineKind.has(s.lineId)).toBe(true);
  });

  it('keeps every point inside MOSCOW_BOUNDS', () => {
    for (const s of MOSCOW_STATIONS) {
      expect(s.lat, s.id).toBeGreaterThanOrEqual(MOSCOW_BOUNDS.south);
      expect(s.lat, s.id).toBeLessThanOrEqual(MOSCOW_BOUNDS.north);
      expect(s.lng, s.id).toBeGreaterThanOrEqual(MOSCOW_BOUNDS.west);
      expect(s.lng, s.id).toBeLessThanOrEqual(MOSCOW_BOUNDS.east);
    }
  });
});

describe('metro dataset: coverage', () => {
  it('covers the 2026 network', () => {
    expect(open.length).toBeGreaterThanOrEqual(280);
    expect(open.filter((s) => lineKind.get(s.lineId) === 'mcc').length).toBeGreaterThanOrEqual(31);
    expect(new Set(open.map((s) => lineKind.get(s.lineId)))).toEqual(new Set(METRO_KINDS));
    expect(open.some((s) => s.lineId === '8A')).toBe(true);
  });

  it('includes the reference stations', () => {
    expect(linesOf('Динамо')).toEqual(['2']);
    expect(linesOf('Белорусская').sort()).toEqual(['2', '5']);
    expect(linesOf('Мнёвники')).toEqual(['11']);
    expect(linesOf('Савёловская').sort()).toEqual(['11', '9']);
    expect(linesOf('Лужники').map((id) => lineKind.get(id))).toEqual(['mcc']);
    expect(linesOf('Некрасовка')).toEqual(['15']);
    expect(linesOf('Коммунарка')).toEqual(['16']);
  });

  it('places every open station 200 m – 7 km from its nearest neighbour on the same line', () => {
    const outliers: string[] = [];
    for (const s of open) {
      const nearest = Math.min(
        ...open.filter((o) => o.lineId === s.lineId && o.id !== s.id).map((o) => haversineMeters(s, o)),
      );
      if (nearest < 200 || nearest > 7000) outliers.push(`${s.id}: ${Math.round(nearest)} m`);
    }
    expect(outliers).toEqual([]);
  });
});

describe('metro functions', () => {
  it('finds «Динамо» as the nearest station', () => {
    const { station, line, distanceM } = nearestStation({ lat: 55.7897, lng: 37.5582 });
    expect(station.name).toBe('Динамо');
    expect(line.id).toBe('2');
    expect(distanceM).toBeLessThan(50);
  });

  it('breaks ties by the lowest id', () => {
    // Metro4all gives both Таганская platforms the same point.
    const a = stationById('5-taganskaya')!.station;
    const b = stationById('7-taganskaya')!.station;
    expect(haversineMeters(a, b)).toBe(0);
    expect(nearestStation(a).station.id).toBe('5-taganskaya');
    expect(nearestStation(b).station.id).toBe('5-taganskaya');
  });

  it('gives the hint by line kind', () => {
    const dinamo = stationById('2-dinamo')!;
    const luzhniki = stationById('14-luzhniki')!;
    expect(placeHint(dinamo.station, dinamo.line)).toBe('м. Динамо');
    expect(placeHint(luzhniki.station, luzhniki.line)).toBe('МЦК Лужники');
    expect(stationById('2-no-such-station')).toBeNull();
  });

  it('searches case-folded with ё = е and groups lines by name', () => {
    expect(searchStations('семеновская').map((g) => g.name)).toEqual(['Семёновская']);
    const [savyolovskaya] = searchStations('САВЕЛОВСКАЯ');
    expect(savyolovskaya?.entries.map((e) => e.line.id)).toEqual(['9', '11']);
    const kiev = searchStations('киев');
    expect(kiev.map((g) => g.name)).toEqual(['Киевская']);
    expect(kiev[0]?.entries).toHaveLength(3);
    expect(searchStations('').reduce((n, g) => n + g.entries.length, 0)).toBe(open.length);
  });
});

describe('metro provenance', () => {
  it('gives every addition a source URL', () => {
    const [header, ...rows] = readFileSync(here('./sources/additions.csv'), 'utf8').trim().split('\n');
    expect(header).toBe('line_id;name_ru;lat;lng;source_url;id');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.split(';')[4]).toMatch(/^https:\/\/\S+$/);
  });

  it('keeps the id of a renamed station', () => {
    expect(stationById('14-moskva-siti')?.station.name).toBe('Деловой центр');
  });

  it('documents both sources and their licence', () => {
    const source = readFileSync(here('./SOURCE.md'), 'utf8');
    expect(source).toContain('Metro4all');
    expect(source).toContain('Википедия');
    expect(source.match(/CC BY-SA 4\.0/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(source).toContain(METRO_ATTRIBUTION);
  });

  it('matches the generator output', () => {
    expect(readFileSync(here('./data.ts'), 'utf8')).toBe(buildMetroData(here('./sources')));
  });
});
