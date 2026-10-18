import {
  classifyMetroDistance,
  createLobbyInput,
  isInMoscowBounds,
  lobbyEssenceInput,
  lobbyTermsInput,
  lobbyWhenWhereInput,
  moscowWallTimeToInstant,
  PLACE_TOO_FAR_MESSAGE,
  START_ISSUE_MESSAGES,
  validateLobbyStart,
  type CreateLobbyInput,
  type GeoPointDto,
  type Instant,
  type LobbyCategory,
  type PaymentFormat,
} from '@masl/shared';

/**
 * Wizard validation: each step is checked with its part of the shared createLobbyInput schema,
 * so the messages are the API's own (issue.message), plus the start window and the metro distance
 * the server checks with its own clock.
 */

export type WizardStep = 1 | 2 | 3;
export const WIZARD_STEPS: readonly WizardStep[] = [1, 2, 3];

/** The wizard's fields, as the shared schemas name them where they match. */
export interface DraftValues {
  /** One per draft: a repeated publish returns the first lobby. */
  requestId: string;
  category: LobbyCategory | null;
  title: string;
  description: string;
  /** Moscow day 'YYYY-MM-DD'. */
  day: string;
  hour: number;
  minute: number;
  durationMinutes: number;
  /** The exact pin; never persisted. */
  point: GeoPointDto | null;
  /** The exact address; never persisted. */
  address: string;
  slots: number;
  minKarmaOn: boolean;
  minKarma: number;
  paymentFormat: PaymentFormat;
}

export type DraftField =
  | 'category'
  | 'title'
  | 'description'
  | 'startsAt'
  | 'durationMinutes'
  | 'location'
  | 'address'
  | 'slots'
  | 'minKarma'
  | 'paymentFormat';

/** First message per field. */
export type StepIssues = Partial<Record<DraftField, string>>;

/** Nearest metro/MCC station of a point (`nearestStation` of @masl/shared/metro, loaded lazily). */
export type NearestStation = (point: GeoPointDto) => { distanceM: number };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'HH:MM' of an hour and a minute. */
export function wallClock(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** The start as an ISO instant; null when the day or the time is malformed. */
export function startsAtOf(values: Pick<DraftValues, 'day' | 'hour' | 'minute'>): string | null {
  try {
    return moscowWallTimeToInstant(values.day, wallClock(values.hour, values.minute)).toISOString();
  } catch {
    return null;
  }
}

interface Issue {
  path: readonly PropertyKey[];
  message: string;
}

function collect(issues: readonly Issue[], into: StepIssues): void {
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '') as DraftField;
    if (field && into[field] === undefined) into[field] = issue.message;
  }
}

const essenceOf = (v: DraftValues) => ({
  category: v.category ?? undefined,
  title: v.title,
  description: v.description,
});

const whenWhereOf = (v: DraftValues) => ({
  startsAt: startsAtOf(v) ?? '',
  durationMinutes: v.durationMinutes,
  location: v.point ?? undefined,
  address: v.address,
});

const termsOf = (v: DraftValues) => ({
  slots: v.slots,
  minKarma: v.minKarmaOn ? v.minKarma : null,
  paymentFormat: v.paymentFormat,
});

/**
 * Problems of one step at `now`. Step 2 adds the start window and, when `nearest` is given, the
 * «не дальше 5 км от метро» rule; without it the server still rejects such a point.
 */
export function stepIssues(
  step: WizardStep,
  values: DraftValues,
  now: Instant,
  nearest?: NearestStation,
): StepIssues {
  const issues: StepIssues = {};
  if (step === 1) {
    const result = lobbyEssenceInput.safeParse(essenceOf(values));
    if (!result.success) collect(result.error.issues, issues);
    return issues;
  }
  if (step === 3) {
    const result = lobbyTermsInput.safeParse(termsOf(values));
    if (!result.success) collect(result.error.issues, issues);
    return issues;
  }
  const result = lobbyWhenWhereInput.safeParse(whenWhereOf(values));
  if (!result.success) collect(result.error.issues, issues);
  const startsAt = startsAtOf(values);
  if (startsAt && !issues.startsAt) {
    const startIssue = validateLobbyStart(startsAt, now);
    if (startIssue) issues.startsAt = START_ISSUE_MESSAGES[startIssue];
  }
  const point = values.point;
  if (point && !issues.location && nearest && isInMoscowBounds(point)) {
    if (classifyMetroDistance(nearest(point).distanceM) === 'too_far') {
      issues.location = PLACE_TOO_FAR_MESSAGE;
    }
  }
  return issues;
}

export function hasIssues(issues: StepIssues): boolean {
  return Object.keys(issues).length > 0;
}

/** The first step with a problem at `now`, or null when the draft can be published. */
export function firstInvalidStep(
  values: DraftValues,
  now: Instant,
  nearest?: NearestStation,
): WizardStep | null {
  return WIZARD_STEPS.find((step) => hasIssues(stepIssues(step, values, now, nearest))) ?? null;
}

/** The API input, normalised by the shared schema; null while any field is invalid. */
export function toCreateInput(values: DraftValues): CreateLobbyInput | null {
  const result = createLobbyInput.safeParse({
    ...essenceOf(values),
    ...whenWhereOf(values),
    ...termsOf(values),
    requestId: values.requestId,
  });
  return result.success ? result.data : null;
}
