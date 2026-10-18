const KM = 1000;
/** Up to this distance the label keeps one decimal. */
const DECIMAL_KM_BELOW = 10 * KM;

/** Distance label: «< 1 км», «2,4 км», «3 км», «12 км». The API already rounds to 100 m. */
export function formatDistance(meters: number): string {
  if (meters < KM) return '< 1 км';
  if (meters < DECIMAL_KM_BELOW) {
    const km = (Math.round(meters / 100) / 10).toFixed(1).replace(/\.0$/, '').replace('.', ',');
    return `${km} км`;
  }
  return `${Math.round(meters / KM)} км`;
}
