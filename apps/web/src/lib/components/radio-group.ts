/**
 * Arrow-key navigation of a `role="radiogroup"` made of buttons with `role="radio"`: moves
 * focus and selects, as native radios do. Returns the index to select, or null to ignore the key.
 */
export function radioKeyTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
