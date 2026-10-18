import { describe, expect, it } from 'vitest';
import { ApiError, ResponseShapeError } from './api.js';
import { describeError, isAbort, OFFLINE_MESSAGE, SERVER_DOWN_MESSAGE } from './errors.js';

describe('describeError', () => {
  it('shows the API message and asks for a reload on a schema mismatch', () => {
    expect(describeError(new ApiError(409, 'Все места заняты'))).toEqual({
      kind: 'message',
      text: 'Все места заняты',
    });
    expect(describeError(new ResponseShapeError())).toEqual({ kind: 'update' });
  });

  it('maps network failures and proxy errors to fixed texts', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'message',
      text: OFFLINE_MESSAGE,
    });
    expect(describeError(new ApiError(502, 'Ошибка 502'))).toEqual({
      kind: 'message',
      text: SERVER_DOWN_MESSAGE,
    });
  });

  it('recognises aborted requests', () => {
    expect(isAbort(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isAbort(new TypeError('Failed to fetch'))).toBe(false);
  });
});
