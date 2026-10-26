import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Releases the media resource when the host element is destroyed, so the browser stops buffering it.
 * Removing `src` (not setting `''`) avoids a load of the page URL and a spurious `error`.
 */
@Directive({
  selector: 'video[rtReleaseMedia], audio[rtReleaseMedia]',
})
export class ReleaseMedia {
  constructor() {
    const media = inject<ElementRef<HTMLMediaElement>>(ElementRef).nativeElement;

    inject(DestroyRef).onDestroy(() => {
      media.pause();
      media.removeAttribute('src');
      media.load();
    });
  }
}
