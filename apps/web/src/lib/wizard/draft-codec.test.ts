import { describe, expect, it } from 'vitest';
import { decodeDraft, encodeDraft } from './draft-codec.js';
import type { DraftValues, WizardStep } from './validate.js';

const CANARY_ADDRESS = 'CANARY-ул. Тестовая, 1';
const CANARY_POINT = { lat: 55.791234, lng: 37.564321 };

const draft: DraftValues & { step: WizardStep } = {
  requestId: '0f8c2a9e-4b1d-4c3e-9a7f-2d5b6c8e1f00',
  step: 2,
  category: 'sport',
  title: 'Падел 2×2',
  description: 'Ракетки есть',
  day: '2026-10-18',
  hour: 19,
  minute: 30,
  durationMinutes: 120,
  point: CANARY_POINT,
  address: CANARY_ADDRESS,
  slots: 3,
  minKarmaOn: true,
  minKarma: 40,
  paymentFormat: 'split',
};

describe('encodeDraft', () => {
  it('never stores the exact point or the address', () => {
    const encoded = encodeDraft(draft);
    expect(encoded).not.toContain('CANARY');
    expect(encoded).not.toContain(String(CANARY_POINT.lat));
    expect(encoded).not.toContain(String(CANARY_POINT.lng));
    const keys = Object.keys(JSON.parse(encoded) as object);
    expect(keys).not.toContain('point');
    expect(keys).not.toContain('address');
    expect(keys).not.toContain('location');
  });

  it('keeps only the listed fields, even when the draft carries more', () => {
    const extended = { ...draft, addressTouched: true, exactPlace: { address: CANARY_ADDRESS } };
    expect(encodeDraft(extended)).toBe(encodeDraft(draft));
  });
});

describe('decodeDraft', () => {
  it('round-trips everything but the point and the address', () => {
    const { point: _point, address: _address, ...rest } = draft;
    expect(decodeDraft(encodeDraft(draft))).toEqual(rest);
  });

  it('accepts a draft without a category yet', () => {
    expect(decodeDraft(encodeDraft({ ...draft, category: null }))?.category).toBeNull();
  });

  it('rejects missing, broken and foreign values', () => {
    expect(decodeDraft(null)).toBeNull();
    expect(decodeDraft('')).toBeNull();
    expect(decodeDraft('{not json')).toBeNull();
    expect(decodeDraft('null')).toBeNull();
    expect(decodeDraft('[]')).toBeNull();
    const stored = JSON.parse(encodeDraft(draft)) as Record<string, unknown>;
    const variant = (patch: Record<string, unknown>) => decodeDraft(JSON.stringify({ ...stored, ...patch }));
    expect(variant({})).not.toBeNull();
    expect(variant({ v: 2 })).toBeNull();
    expect(variant({ requestId: 'not-a-uuid' })).toBeNull();
    expect(variant({ step: 4 })).toBeNull();
    expect(variant({ category: 'dating' })).toBeNull();
    expect(variant({ paymentFormat: 'cash' })).toBeNull();
    expect(variant({ hour: 24 })).toBeNull();
    expect(variant({ minute: 2.5 })).toBeNull();
    expect(variant({ day: '18.10.2026' })).toBeNull();
    expect(variant({ title: 42 })).toBeNull();
    expect(variant({ minKarmaOn: 'yes' })).toBeNull();
  });

  it('drops a point or an address planted in storage', () => {
    const stored = JSON.parse(encodeDraft(draft)) as Record<string, unknown>;
    const decoded = decodeDraft(JSON.stringify({ ...stored, point: CANARY_POINT, address: CANARY_ADDRESS }));
    expect(decoded).not.toBeNull();
    expect(JSON.stringify(decoded)).not.toContain('CANARY');
    expect(decoded).not.toHaveProperty('point');
  });
});
