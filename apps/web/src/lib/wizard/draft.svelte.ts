import {
  classifyMetroDistance,
  LOBBY_DEFAULT_SLOTS,
  LOBBY_DURATION_DEFAULT_MINUTES,
  LOBBY_MIN_KARMA_PRESETS,
  MINUTE_MS,
  validateLobbyStart,
  type GeoPointDto,
  type Instant,
  type LobbyCardDto,
  type LobbyCategory,
  type PaymentFormat,
  type PersonDto,
  type PublicPlaceDto,
} from '@masl/shared';
import { storage } from '../storage.js';
import { decodeDraft, DRAFT_STORAGE_KEY, encodeDraft, type PersistedDraft } from './draft-codec.js';
import { defaultStart } from './defaults.js';
import { startsAtOf, stepIssues, type DraftValues, type StepIssues, type WizardStep } from './validate.js';

type Metro = typeof import('@masl/shared/metro');

/** Payment format preselected in a new draft (the approved mockup). */
const DEFAULT_PAYMENT_FORMAT: PaymentFormat = 'split';
const AUTOSAVE_MS = 500;

/**
 * The creation wizard's state for one lobby. The exact point and the address live in memory
 * only; everything else is autosaved (draft-codec.ts) so the draft survives an app restart.
 */
export class LobbyDraft implements DraftValues {
  requestId = $state<string>(crypto.randomUUID());
  step = $state<WizardStep>(1);
  category = $state<LobbyCategory | null>(null);
  title = $state('');
  description = $state('');
  day = $state('');
  hour = $state(19);
  minute = $state(0);
  durationMinutes = $state(LOBBY_DURATION_DEFAULT_MINUTES);
  point = $state<GeoPointDto | null>(null);
  address = $state('');
  /** The host typed or picked the address, so reverse geocoding no longer overwrites it. */
  addressTouched = $state(false);
  /** Station picked in the no-map fallback (the point is then the station's or a suggestion's). */
  fallbackStationId = $state<string | null>(null);
  slots = $state(LOBBY_DEFAULT_SLOTS);
  minKarmaOn = $state(false);
  minKarma = $state<number>(LOBBY_MIN_KARMA_PRESETS[0]);
  paymentFormat = $state<PaymentFormat>(DEFAULT_PAYMENT_FORMAT);
  /** «Далее» was tapped on a step: its errors are shown from then on. */
  tried = $state<Record<WizardStep, boolean>>({ 1: false, 2: false, 3: false });

  /** The metro dataset, loaded on demand for the place preview and the 5 km rule. */
  metro = $state<Metro | null>(null);

  startsAt = $derived(startsAtOf(this));
  endsAt = $derived(
    this.startsAt
      ? new Date(Date.parse(this.startsAt) + this.durationMinutes * MINUTE_MS).toISOString()
      : null,
  );

  /** Nearest station of the pin: what participants will see instead of the address. */
  nearest = $derived(this.metro && this.point ? this.metro.nearestStation(this.point) : null);

  /** The host entered something worth keeping (a draft to save and to confirm leaving). */
  dirty = $derived(
    this.category !== null ||
      this.title.trim() !== '' ||
      this.description.trim() !== '' ||
      this.address.trim() !== '' ||
      this.point !== null ||
      this.step > 1,
  );

  /** What autosave writes; null when there is nothing worth keeping. */
  serialized = $derived(this.dirty ? encodeDraft(this.values) : null);

  constructor(now: Instant) {
    this.#setStart(now);
  }

  get values(): DraftValues & { step: WizardStep } {
    return {
      requestId: this.requestId,
      step: this.step,
      category: this.category,
      title: this.title,
      description: this.description,
      day: this.day,
      hour: this.hour,
      minute: this.minute,
      durationMinutes: this.durationMinutes,
      point: this.point,
      address: this.address,
      slots: this.slots,
      minKarmaOn: this.minKarmaOn,
      minKarma: this.minKarma,
      paymentFormat: this.paymentFormat,
    };
  }

  /** Problems of a step at `now`, with the metro rule once the dataset is loaded. */
  issues(step: WizardStep, now: Instant): StepIssues {
    return stepIssues(step, this.values, now, this.metro?.nearestStation);
  }

  /** Starts over: a new request id and the defaults. */
  reset(now: Instant): void {
    this.requestId = crypto.randomUUID();
    this.step = 1;
    this.category = null;
    this.title = '';
    this.description = '';
    this.durationMinutes = LOBBY_DURATION_DEFAULT_MINUTES;
    this.point = null;
    this.address = '';
    this.addressTouched = false;
    this.fallbackStationId = null;
    this.slots = LOBBY_DEFAULT_SLOTS;
    this.minKarmaOn = false;
    this.minKarma = LOBBY_MIN_KARMA_PRESETS[0];
    this.paymentFormat = DEFAULT_PAYMENT_FORMAT;
    this.tried = { 1: false, 2: false, 3: false };
    this.#setStart(now);
  }

  /**
   * Continues a stored draft. The pin and the address were not stored, so a draft saved on
   * step 3 reopens on step 2; a start that has passed meanwhile gets the default.
   */
  restore(saved: PersistedDraft, now: Instant): void {
    this.reset(now);
    this.requestId = saved.requestId;
    this.step = saved.step === 1 ? 1 : 2;
    this.category = saved.category;
    this.title = saved.title;
    this.description = saved.description;
    this.durationMinutes = saved.durationMinutes;
    this.slots = saved.slots;
    this.minKarmaOn = saved.minKarmaOn;
    this.minKarma = saved.minKarma;
    this.paymentFormat = saved.paymentFormat;
    const startsAt = startsAtOf(saved);
    if (startsAt && validateLobbyStart(startsAt, now) === null) {
      this.day = saved.day;
      this.hour = saved.hour;
      this.minute = saved.minute;
    }
  }

  /** Loads the metro dataset once (a separate chunk). */
  async loadMetro(): Promise<Metro | null> {
    if (this.metro) return this.metro;
    try {
      this.metro = await import('@masl/shared/metro');
    } catch {
      // Offline: the preview waits, the server still checks the place.
    }
    return this.metro;
  }

  /** The public place participants will see; null without a pin or the metro data. */
  get publicPlace(): PublicPlaceDto | null {
    const nearest = this.nearest;
    if (!nearest || !this.metro) return null;
    return {
      hint: this.metro.placeHint(nearest.station, nearest.line),
      stationId: nearest.station.id,
      lineName: nearest.line.name,
      lineColor: nearest.line.color,
      point: { lat: nearest.station.lat, lng: nearest.station.lng },
      farFromMetro: classifyMetroDistance(nearest.distanceM) === 'far',
    };
  }

  /** The feed card the lobby will get, for the step 3 preview. */
  previewCard(host: PersonDto, title: string): LobbyCardDto | null {
    const place = this.publicPlace;
    if (!place || !this.startsAt || !this.endsAt) return null;
    return {
      id: this.requestId,
      category: this.category ?? 'other',
      title,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      status: 'open',
      slots: this.slots,
      approvedCount: 0,
      pendingCount: 0,
      minKarma: this.minKarmaOn ? this.minKarma : null,
      paymentFormat: this.paymentFormat,
      place,
      distanceM: null,
      host,
      viewer: { isHost: true, membershipStatus: null, applyBlock: null },
    };
  }

  #setStart(now: Instant): void {
    const start = defaultStart(now);
    this.day = start.day;
    this.hour = start.hour;
    this.minute = start.minute;
  }
}

/** The stored draft, if there is one to offer («Продолжить черновик?»). */
export function loadSavedDraft(): PersistedDraft | null {
  return decodeDraft(storage.get(DRAFT_STORAGE_KEY));
}

export function clearSavedDraft(): void {
  storage.remove(DRAFT_STORAGE_KEY);
}

/**
 * Saves the draft 500 ms after the last change and once more when the wizard unmounts.
 * `cancel()` stops it for good (after publishing), so a pending save can't bring the draft back.
 */
export function useDraftAutosave(draft: LobbyDraft, enabled: () => boolean): { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | undefined;
  let cancelled = false;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const write = pending;
    pending = undefined;
    if (!cancelled) write?.();
  };

  $effect(() => {
    if (!enabled()) return;
    const serialized = draft.serialized;
    clearTimeout(timer);
    pending = () => {
      if (serialized === null) storage.remove(DRAFT_STORAGE_KEY);
      else storage.set(DRAFT_STORAGE_KEY, serialized);
    };
    timer = setTimeout(flush, AUTOSAVE_MS);
  });

  // Runs once; its teardown saves what is still pending when the wizard closes.
  $effect(() => flush);

  return {
    cancel() {
      cancelled = true;
      clearTimeout(timer);
      pending = undefined;
    },
  };
}
