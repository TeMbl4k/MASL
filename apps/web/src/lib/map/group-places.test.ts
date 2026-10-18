import type { LobbyCardDto, MapStationDto } from '@masl/shared';
import { describe, expect, it } from 'vitest';
import { groupPlaces, placesToGeoJson } from './group-places.js';

function card(id: string, startsAt: string): LobbyCardDto {
  return { id, startsAt } as LobbyCardDto;
}

function station(
  stationId: string,
  hint: string,
  lineColor: string | null,
  point: { lat: number; lng: number },
  lobbies: LobbyCardDto[],
): MapStationDto {
  return {
    place: { hint, stationId, lineName: null, lineColor, point, farFromMetro: false },
    lobbies,
  };
}

const ring = station('5-belorusskaya', 'м. Белорусская', '#8D5B2D', { lat: 55.7752, lng: 37.5822 }, [
  card('b', '2026-10-18T16:00:00.000Z'),
]);
const radial = station('2-belorusskaya', 'м. Белорусская', '#4FB04F', { lat: 55.7774, lng: 37.5826 }, [
  card('a', '2026-10-18T15:00:00.000Z'),
  card('c', '2026-10-18T16:00:00.000Z'),
]);
const dynamo = station('2-dinamo', 'м. Динамо', '#4FB04F', { lat: 55.7898, lng: 37.5582 }, [
  card('d', '2026-10-17T19:00:00.000Z'),
]);

describe('groupPlaces', () => {
  it('merges the stations of an interchange into one place', () => {
    const [belorusskaya] = groupPlaces([ring, radial]);
    expect(groupPlaces([ring, radial])).toHaveLength(1);
    expect(belorusskaya.key).toBe('м. Белорусская');
    expect(belorusskaya.lineColors).toEqual(['#8D5B2D', '#4FB04F']);
    expect(belorusskaya.point.lat).toBeCloseTo(55.7763, 4);
    expect(belorusskaya.point.lng).toBeCloseTo(37.5824, 4);
  });

  it('orders lobbies by start, then id, and places by their earliest lobby', () => {
    const places = groupPlaces([ring, radial, dynamo]);
    expect(places.map((p) => p.key)).toEqual(['м. Динамо', 'м. Белорусская']);
    expect(places[1].lobbies.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('skips empty stations, repeated colours and missing colours', () => {
    const empty = station('9-x', 'м. Пусто', '#000000', { lat: 55.7, lng: 37.6 }, []);
    const noColor = station('2-belorusskaya-old', 'м. Белорусская', null, radial.place.point, []);
    const places = groupPlaces([
      radial,
      { ...radial, place: { ...radial.place, stationId: 'dup' } },
      empty,
      noColor,
    ]);
    expect(places.map((p) => p.key)).toEqual(['м. Белорусская']);
    expect(places[0].lineColors).toEqual(['#4FB04F']);
  });

  it('builds point features with the lobby count', () => {
    const geojson = placesToGeoJson(groupPlaces([dynamo, ring, radial]));
    expect(geojson.features).toEqual([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [37.5582, 55.7898] },
        properties: { key: 'м. Динамо', hint: 'м. Динамо', count: 1 },
      },
      expect.objectContaining({ properties: { key: 'м. Белорусская', hint: 'м. Белорусская', count: 3 } }),
    ]);
  });
});
