import { DestroyRef, Directive, inject, input } from '@angular/core';
import { Nullable } from '../models/common.model';

/**
 * Publishes the track info to the OS media controls (lock screen, media keys, notification) when the host element
 * starts playing. The media session is page-global, so the element that plays last owns it.
 */
@Directive({
  selector: 'video[rtMediaSession], audio[rtMediaSession]',
  host: {
    '(play)': 'publish()',
  },
})
export class MediaSession {
  readonly rtMediaTitle = input<Nullable<string>>();
  readonly rtMediaArtist = input<Nullable<string>>();
  readonly rtMediaArtwork = input<Nullable<string>>();

  /** The metadata this element published, so destroy only clears its own and not another player's. */
  private _metadata: MediaMetadata | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());
  }

  publish(): void {
    if (!('mediaSession' in navigator)) return;

    const artwork = this.rtMediaArtwork();
    this._metadata = new MediaMetadata({
      title: this.rtMediaTitle() ?? '',
      artist: this.rtMediaArtist() ?? '',
      artwork: artwork ? [{ src: artwork }] : [],
    });
    navigator.mediaSession.metadata = this._metadata;
  }

  clear(): void {
    if (this._metadata && 'mediaSession' in navigator && navigator.mediaSession.metadata === this._metadata) {
      navigator.mediaSession.metadata = null;
    }
    this._metadata = null;
  }
}
