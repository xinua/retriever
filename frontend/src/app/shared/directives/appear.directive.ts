import { AfterViewInit, DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StorageService } from '@shared/services';
import { delay, filter, map, merge, take } from 'rxjs';
import { HEIGHT_CHANGE_TOKEN, SCROLL_TOKEN } from '../constants/scroll-token';

type AnimationNames = 'none' | 'rise' | 'reveal' | 'unblur' | 'move-right' | 'move-left' | 'fly-up' | 'fade';

@Directive({
  selector: '[rtAppear]',
})
export class AppearDirective implements AfterViewInit {
  animationName = input.required<AnimationNames>();
  animationDelay = input<number>(0);
  visiblePart = input<number>(1);

  private _scroll = inject(SCROLL_TOKEN);
  private _heightChange = inject(HEIGHT_CHANGE_TOKEN);
  private readonly _elementRef = inject(ElementRef);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _uiConfig = inject(StorageService).uiConfig;

  ngAfterViewInit() {
    if (!this._elementRef.nativeElement || this.animationName() === 'none') return;
    this._elementRef.nativeElement.classList.add(this.animationName());

    setTimeout(
      () => {
        if (this._isVisible()) this.handleAppear();
      },
      (this.animationDelay() * 1000 || 0) + 300,
    );

    merge(this._scroll, this._heightChange)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        filter(() => this._uiConfig().enableAnimations),
        map(() => this._isVisible()),
        filter(Boolean),
        take(1),
        delay(this.animationDelay() * 1000),
      )
      .subscribe(() => this.handleAppear());
  }

  private _isVisible(): boolean {
    const element = this._elementRef?.nativeElement as HTMLElement;
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    // Height of the intersection between the element and the viewport.
    const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
    if (visibleHeight < 0) return false;

    // visiblePart is a percentage of the element height, capped by the viewport
    // so elements taller than the screen can still appear.
    const requiredHeight = Math.min((rect.height / 100) * this.visiblePart(), viewportHeight);
    return visibleHeight >= requiredHeight;
  }

  private handleAppear(): void {
    this._elementRef.nativeElement.classList.add('animate');
  }
}
