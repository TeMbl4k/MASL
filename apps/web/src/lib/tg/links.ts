import { copyTextToClipboard, openLink } from '@telegram-apps/sdk';
import { session } from '../session.svelte.js';

/** Yandex Maps URL with a pin; the point is the exact one, so only call this from a member's tap. */
export function yandexMapsUrl(point: { lat: number; lng: number }): string {
  return `https://yandex.ru/maps/?pt=${point.lng},${point.lat}&z=17&l=map`;
}

/** Opens the point in Yandex Maps, outside the Mini App. Call only from a tap. */
export function openInMaps(point: { lat: number; lng: number }): void {
  const url = yandexMapsUrl(point);
  // Under the dev mock openLink reports success but posts to nobody.
  const [opened] = session.inTelegram ? openLink.ifAvailable(url) : [false];
  if (!opened) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** Copies text to the clipboard; false when the webview refused. Call only from a tap. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await copyTextToClipboard(text);
    return true;
  } catch {
    return false;
  }
}
