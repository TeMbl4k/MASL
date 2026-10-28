import { describe, expect, it } from 'vitest';
import { params } from './params.js';

async function matches(value: string, matcher: keyof typeof params = 'uuid'): Promise<boolean> {
  const result = await params[matcher]['~standard'].validate(value);
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

describe('code param matcher', () => {
  it('accepts public codes only', async () => {
    expect(await matches('a1b2c3d4e5f6', 'code')).toBe(true);
    expect(await matches('A1B2C3D4E5F6', 'code')).toBe(false);
    expect(await matches('a1b2c3d4e5f', 'code')).toBe(false);
    expect(await matches('0f8fad5b-d9cb-469f-a165-70867728950e', 'code')).toBe(false);
  });
});
