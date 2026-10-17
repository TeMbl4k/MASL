import { describe, expect, it } from 'vitest';
import { params } from './params.js';

async function matches(value: string): Promise<boolean> {
  const result = await params.uuid['~standard'].validate(value);
  return !result.issues;
}

describe('uuid param matcher', () => {
  it('accepts lobby ids', async () => {
    expect(await matches('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
    expect(await matches('0F8FAD5B-D9CB-469F-A165-70867728950E')).toBe(true);
  });

  it('rejects anything else, so the route falls through to 404', async () => {
    expect(await matches('42')).toBe(false);
    expect(await matches('0f8fad5b-d9cb-469f-a165-70867728950')).toBe(false);
    expect(await matches('0f8fad5b-d9cb-469f-a165-70867728950e/manage')).toBe(false);
    expect(await matches('')).toBe(false);
  });
});
