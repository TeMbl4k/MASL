import { FEEDBACK_RATINGS } from '@masl/shared';
import { decodeCallback, encodeCallback, type BotCallback } from './callbacks.js';

const ID = '0b9c6f2e-6a51-4d3e-9a43-2f1e4d6b7c8a';

describe('bot callback data', () => {
  const all: BotCallback[] = [
    { action: 'quorum_lower', lobbyId: ID },
    { action: 'quorum_cancel', lobbyId: ID },
    { action: 'quorum_cancel_confirm', lobbyId: ID },
    { action: 'quorum_keep', lobbyId: ID },
    { action: 'attendance_toggle', memberId: ID },
    { action: 'attendance_save', lobbyId: ID },
    ...FEEDBACK_RATINGS.map((rating) => ({ action: 'feedback' as const, lobbyId: ID, rating })),
  ];

  it('round-trips every callback within 64 bytes', () => {
    for (const callback of all) {
      const data = encodeCallback(callback);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(decodeCallback(data)).toEqual(callback);
    }
    expect(new Set(all.map(encodeCallback)).size).toBe(all.length);
  });

  it('rejects data it never sends', () => {
    for (const data of [
      '',
      'q:lower',
      `q:drop:${ID}`,
      'q:lower:1',
      `f:great:${ID}`,
      `a:t:${ID.toUpperCase()}`,
    ]) {
      expect(decodeCallback(data)).toBeNull();
    }
  });
});
