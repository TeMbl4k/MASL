// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    /** Shallow-routing state: an open sheet is a history entry, so Back closes it. */
    interface PageState {
      sheet?:
        | 'origin'
        | 'station'
        | 'map-place'
        | 'cancel-lobby'
        | 'interests'
        | 'report'
        | 'appeal'
        | 'moderation-action'
        | 'share'
        | 'new-achievement'
        | 'tag-qr';
      /** Station id of the open `map-place` sheet. */
      placeKey?: string;
      /** Link tag id of the open `tag-qr` sheet. */
      tagId?: number;
    }
    // interface Platform {}
  }
}

export {};
