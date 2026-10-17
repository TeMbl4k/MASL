/** Russian noun forms for 1, 2–4 and 5+: ['встреча', 'встречи', 'встреч']. */
export type PluralForms = readonly [one: string, few: string, many: string];

/** The form that goes with `n`: 1 встреча, 2 встречи, 5 встреч, 11 встреч, 21 встреча. */
export function pluralForm(n: number, forms: PluralForms): string {
  const abs = Math.abs(Math.trunc(n));
  const lastTwo = abs % 100;
  const last = abs % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** «5 встреч». */
export function plural(n: number, forms: PluralForms): string {
  return `${n} ${pluralForm(n, forms)}`;
}

export const LOBBY_FORMS: PluralForms = ['встреча', 'встречи', 'встреч'];
export const APPLICATION_FORMS: PluralForms = ['заявка', 'заявки', 'заявок'];
export const NEW_APPLICATION_FORMS: PluralForms = ['новая заявка', 'новые заявки', 'новых заявок'];
