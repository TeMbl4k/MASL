import {
  isLocationManagerAccessGranted,
  isLocationManagerAvailable,
  isLocationManagerMounted,
  mountLocationManager,
  openLocationManagerSettings,
  requestLocation,
  unmountLocationManager,
} from '@telegram-apps/sdk';
import { session } from '../session.svelte.js';

export type LocationResult =
  | { kind: 'ok'; lat: number; lng: number }
  /** The user refused; `settings` says whether Telegram's location settings can be opened. */
  | { kind: 'denied'; settings: boolean }
  | { kind: 'unavailable' };

const TG_MOUNT_TIMEOUT_MS = 4000;
const TG_REQUEST_TIMEOUT_MS = 15_000;
const BROWSER_TIMEOUT_MS = 8000;
const BROWSER_MAX_AGE_MS = 300_000;

function readCoords(data: unknown): { lat: number; lng: number } | null {
  // The SDK returns the raw snake_case payload: { latitude, longitude, ... }.
  if (typeof data !== 'object' || data === null) return null;
  const { latitude, longitude } = data as { latitude?: unknown; longitude?: unknown };
  return typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude + longitude)
    ? { lat: latitude, lng: longitude }
    : null;
}

/**
 * Mounts Telegram's LocationManager (Bot API 8.0); false when it can't be used on this client.
 * The dev mock has no host to answer, so outside Telegram the browser is used instead.
 */
async function mountTelegramManager(): Promise<boolean> {
  if (!session.inTelegram || !mountLocationManager.isAvailable()) return false;
  try {
    if (!isLocationManagerMounted()) {
      await mountLocationManager({ timeout: TG_MOUNT_TIMEOUT_MS });
    }
  } catch {
    return false;
  }
  if (!isLocationManagerAvailable()) {
    // Unsupported on this device: don't keep the state, so the next attempt checks again.
    unmountLocationManager();
    return false;
  }
  return true;
}

/** Telegram's LocationManager; null when it can't be used on this client. */
async function fromTelegram(): Promise<LocationResult | null> {
  if (!(await mountTelegramManager())) return null;
  try {
    const coords = readCoords(await requestLocation({ timeout: TG_REQUEST_TIMEOUT_MS }));
    if (coords) return { kind: 'ok', ...coords };
  } catch {
    // A denial either throws or resolves with no coordinates, depending on the client.
  }
  const result: LocationResult = isLocationManagerAccessGranted()
    ? { kind: 'unavailable' }
    : { kind: 'denied', settings: openLocationManagerSettings.isAvailable() };
  // A denial marks the manager unavailable; unmounting makes the next attempt re-check access,
  // so a permission granted in the settings meanwhile is picked up.
  unmountLocationManager();
  return result;
}

function fromBrowser(): Promise<LocationResult> {
  if (!('geolocation' in navigator)) {
    return Promise.resolve({ kind: 'unavailable' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ kind: 'ok', lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) =>
        resolve(
          error.code === error.PERMISSION_DENIED
            ? { kind: 'denied', settings: false }
            : { kind: 'unavailable' },
        ),
      { timeout: BROWSER_TIMEOUT_MS, maximumAge: BROWSER_MAX_AGE_MS, enableHighAccuracy: false },
    );
  });
}

/**
 * The viewer's location: Telegram's LocationManager first, then the browser's geolocation.
 * The caller rounds the result and keeps it in memory only.
 */
export async function requestUserLocation(): Promise<LocationResult> {
  return (await fromTelegram()) ?? fromBrowser();
}

/** Whether the location can be read without asking: the viewer already allowed it. */
export async function hasLocationAccess(): Promise<boolean> {
  if (await mountTelegramManager()) return isLocationManagerAccessGranted();
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

/** Opens Telegram's location settings for the bot. Call only from a tap. */
export function openLocationSettings(): void {
  openLocationManagerSettings.ifAvailable();
}
