import { describe, expect, it } from 'vitest';
import { fallbackPoint } from './place.js';

const SUGGESTION = { lat: 55.7966, lng: 37.5535 };
const DYNAMO = { id: 'dinamo', lat: 55.7897, lng: 37.5582 };

describe('fallbackPoint (no map)', () => {
  it('keeps the picked suggestion point when a station is picked after it', () => {
    expect(fallbackPoint(SUGGESTION, DYNAMO)).toEqual(SUGGESTION);
  });

  it('uses the station coordinates without a suggestion point', () => {
    expect(fallbackPoint(null, DYNAMO)).toEqual({ lat: DYNAMO.lat, lng: DYNAMO.lng });
  });

  it('has no point before a station or a suggestion is picked', () => {
    expect(fallbackPoint(null, null)).toBeNull();
  });
});
