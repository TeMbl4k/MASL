import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { QR_MARGIN, qrCode, qrSvgDocument } from './index.js';

/** The modules a path paints back as a matrix. */
function paint(size: number, path: string): boolean[][] {
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const [, x, y, len] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(len); i++) grid[Number(y)]![Number(x) + i] = true;
  }
  return grid;
}

describe('qrCode', () => {
  const link = 'https://t.me/masl_bot?startapp=p_0123456789ab_0123456789ab';

  it('paints exactly the dark modules of the encoder', () => {
    const { size, path } = qrCode(link);
    expect(paint(size, path)).toEqual(encode(link, { ecc: 'M', border: 0 }).data);
  });

  it('builds a black-on-white SVG file with a quiet zone', () => {
    const svg = qrSvgDocument(link);
    const { size, path } = qrCode(link);
    const side = size + 2 * QR_MARGIN;
    expect(svg).toContain(`viewBox="-${QR_MARGIN} -${QR_MARGIN} ${side} ${side}"`);
    expect(svg).toContain('fill="#FFFFFF"');
    expect(svg).toContain(`<path fill="#000000" d="${path}"/>`);
  });
});
