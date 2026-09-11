import { Component, effect, input, signal } from '@angular/core';
import { Nullable } from '../../models/common.model';

@Component({
  selector: 'rt-avatar',
  imports: [],
  templateUrl: './avatar.html',
  styleUrl: './avatar.css',
})
export class RtAvatar {
  url = input<Nullable<string>>(null);
  imgSize = input<string>('');
  sourceImg = input<Nullable<string>>();
  customClass = input<string>('');

  /**
   * Whether a missing picture is one still on its way. The server resolves
   * avatarPath from what is on disk and fetches the uploader's avatar
   * alongside the download, so a row queued a moment ago has no path yet and
   * gains one over the socket — the preloader holds that gap, where the
   * "not found" stand-in would claim the row simply has no avatar.
   */
  pending = input<boolean>(false);

  imgPath = signal<string>('');
  isLoaded = signal<boolean>(false);

  private _maxRetries = 3;
  private _retryCount = 0;
  private readonly _notFoundMessage = 'Avatar%20not%20found';

  constructor() {
    effect(() => {
      const source = this.sourceImg();

      // Start over on a new source rather than keeping a spent retry budget,
      // or the placeholder the previous one settled on.
      this._retryCount = 0;

      if (source?.length) {
        this.imgPath.set(source);
        return;
      }

      // No <img> at all while pending: an empty src re-requests the page
      // itself, and the preloader is the whole point of showing nothing.
      this.isLoaded.set(false);
      this.imgPath.set(this.pending() ? '' : this._mock());
    });
  }

  openUrl() {
    if (this.url()) {
      window.open(this.url(), '_blank');
    }
  }

  handleImageError() {
    // Nothing to ask for twice when there was no source to begin with.
    if (this.sourceImg()?.length && this._retryCount < this._maxRetries) {
      this._retryCount++;
      setTimeout(() => this.imgPath.set(`${this.sourceImg()}?r=${this._retryCount}`), 2000);
      return;
    }

    this.imgPath.set(this._mock());
  }

  handleImageLoad() {
    this.isLoaded.set(true);
  }

  private _mock(): string {
    return `https://mockimage.tw/photo/${this.imgSize()}/1f1f1f/ff8800/${this._notFoundMessage}`;
  }
}
