import { encode } from 'uqr';

/**
 * QR codes of MASL links (stage 7), apart from the main entry: only the card screen and the
 * server's print file load the encoder. Medium error correction survives a scuffed sticker.
 */
export interface QrCode {
  /** Modules per side, without a quiet zone. */
  size: number;
  /** The dark modules as one SVG path in module units, a run of a row per subpath. */
  path: string;
}

export function qrCode(text: string): QrCode {
  const { size, data } = encode(text, { ecc: 'M', border: 0 });
  const runs: string[] = [];
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x++;
      runs.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  });
  return { size, path: runs.join('') };
}

/** The quiet zone a scanner needs around the code, in modules. */
export const QR_MARGIN = 4;

/** A standalone SVG file of the code: black on white, any print size stays sharp. */
export function qrSvgDocument(text: string): string {
  const { size, path } = qrCode(text);
  const side = size + 2 * QR_MARGIN;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${QR_MARGIN} -${QR_MARGIN} ${side} ${side}" width="${side * 10}" height="${side * 10}" shape-rendering="crispEdges">`,
    `<rect x="-${QR_MARGIN}" y="-${QR_MARGIN}" width="${side}" height="${side}" fill="#FFFFFF"/>`,
    `<path fill="#000000" d="${path}"/>`,
    '</svg>',
    '',
  ].join('\n');
}
