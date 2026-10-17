import {
  LOBBY_CATEGORIES,
  LOBBY_DESCRIPTION_MAX,
  LOBBY_TITLE_MAX,
  PAYMENT_FORMATS,
  type LobbyCategory,
  type PaymentFormat,
} from '@masl/shared';
import type { StorageKey } from '../storage.js';
import { WIZARD_STEPS, type DraftValues, type WizardStep } from './validate.js';

/**
 * The wizard draft as stored across app restarts. The exact pin and the address are never part
 * of it: the codec picks the persisted fields one by one, so a new draft field stays in memory
 * until it is added here on purpose.
 */

export const DRAFT_STORAGE_KEY: StorageKey = 'masl:lobby-draft:v1';
const VERSION = 1;

export type PersistedDraft = Omit<DraftValues, 'point' | 'address'> & { step: WizardStep };

export function encodeDraft(draft: DraftValues & { step: WizardStep }): string {
  const persisted: PersistedDraft & { v: number } = {
    v: VERSION,
    requestId: draft.requestId,
    step: draft.step,
    category: draft.category,
    title: draft.title,
    description: draft.description,
    day: draft.day,
    hour: draft.hour,
    minute: draft.minute,
    durationMinutes: draft.durationMinutes,
    slots: draft.slots,
    minKarmaOn: draft.minKarmaOn,
    minKarma: draft.minKarma,
    paymentFormat: draft.paymentFormat,
  };
  return JSON.stringify(persisted);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isInt = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/**
 * A stored draft, or null when there is none or it doesn't look like one (an older format,
 * a hand-edited value). The values are re-validated by the wizard before publishing.
 */
export function decodeDraft(raw: string | null): PersistedDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const valid =
    d.v === VERSION &&
    typeof d.requestId === 'string' &&
    UUID.test(d.requestId) &&
    WIZARD_STEPS.includes(d.step as WizardStep) &&
    (d.category === null || oneOf(LOBBY_CATEGORIES, d.category)) &&
    isText(d.title, LOBBY_TITLE_MAX * 2) &&
    isText(d.description, LOBBY_DESCRIPTION_MAX * 2) &&
    typeof d.day === 'string' &&
    DAY.test(d.day) &&
    isInt(d.hour, 0, 23) &&
    isInt(d.minute, 0, 59) &&
    isInt(d.durationMinutes, 1, 24 * 60) &&
    isInt(d.slots, 0, 1000) &&
    typeof d.minKarmaOn === 'boolean' &&
    isInt(d.minKarma, 0, 1000) &&
    oneOf(PAYMENT_FORMATS, d.paymentFormat);
  if (!valid) return null;
  return {
    requestId: d.requestId as string,
    step: d.step as WizardStep,
    category: d.category as LobbyCategory | null,
    title: d.title as string,
    description: d.description as string,
    day: d.day as string,
    hour: d.hour as number,
    minute: d.minute as number,
    durationMinutes: d.durationMinutes as number,
    slots: d.slots as number,
    minKarmaOn: d.minKarmaOn as boolean,
    minKarma: d.minKarma as number,
    paymentFormat: d.paymentFormat as PaymentFormat,
  };
}
