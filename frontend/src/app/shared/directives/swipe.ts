import { DestroyRef, Directive, ElementRef, inject, input, output } from '@angular/core';

export interface SwipeEvent {
  direction: 'left' | 'right';
}

const MIN_OPACITY = 0.5;
const MIN_SCALE = 1;
// Element follows the finger for this fraction of the touch path.
const FOLLOW_RATIO = 0.65;
// Movement (px) before we decide whether the gesture is horizontal or vertical.
const DIRECTION_LOCK_SLOP = 10;
const RESET_TRANSITION = 'transform 200ms ease-out, opacity 200ms ease-out';

@Directive({
  selector: '[rtSwipe]',
  standalone: true,
  host: {
    '[style.touch-action]': '"pan-y"',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'reset()',
  },
})
export class SwipeDirective {
  rtSwipe = output<SwipeEvent>();
  /** Distance (px) the finger must travel for the swipe to fire. */
  swipeThreshold = input<number>(80);
  swipeDisabled = input<boolean>(false);

  private readonly _el: HTMLElement = inject(ElementRef).nativeElement;
  private _pointerId: number | null = null;
  private _startX = 0;
  private _startY = 0;
  private _dx = 0;
  private _locked: 'horizontal' | 'vertical' | null = null;
  private _suppressClick = false;
  private _resetTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Capture phase so a finished swipe doesn't also trigger buttons inside the element.
    this._el.addEventListener('click', this._clickGuard, true);
    inject(DestroyRef).onDestroy(() => {
      this._el.removeEventListener('click', this._clickGuard, true);
      clearTimeout(this._resetTimer);
    });
  }

  onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' || this._pointerId !== null || this.swipeDisabled()) return;
    clearTimeout(this._resetTimer);
    this._suppressClick = false;
    this._pointerId = event.pointerId;
    this._startX = event.clientX;
    this._startY = event.clientY;
    this._dx = 0;
    this._locked = null;
    this._el.style.transition = 'none';
  }

  onPointerMove(event: PointerEvent) {
    if (event.pointerId !== this._pointerId) return;
    const dx = event.clientX - this._startX;
    const dy = event.clientY - this._startY;

    if (!this._locked) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_LOCK_SLOP) return;
      this._locked = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      if (this._locked === 'vertical') return this.reset();
      this._el.setPointerCapture(event.pointerId);
    }

    this._dx = dx;
    this._applyProgress(dx);
  }

  onPointerUp(event: PointerEvent) {
    if (event.pointerId !== this._pointerId) return;
    if (this._locked === 'horizontal') {
      this._suppressClick = true;
      if (Math.abs(this._dx) >= this.swipeThreshold()) {
        this.rtSwipe.emit({ direction: this._dx < 0 ? 'left' : 'right' });
      }
    }
    this.reset();
  }

  reset() {
    if (this._pointerId !== null && this._el.hasPointerCapture(this._pointerId)) {
      this._el.releasePointerCapture(this._pointerId);
    }
    this._pointerId = null;
    this._locked = null;
    this._dx = 0;

    if (!this._el.style.transform) return;
    this._el.style.transition = RESET_TRANSITION;
    this._el.style.transform = '';
    this._el.style.opacity = '';
    // Drop inline transition afterwards so class-based animations (e.g. rtAppear) keep working.
    this._resetTimer = setTimeout(() => (this._el.style.transition = ''), 200);
  }

  private _applyProgress(dx: number) {
    const progress = Math.min(Math.abs(dx) / this.swipeThreshold(), 1);
    const scale = 1 - (1 - MIN_SCALE) * progress;
    const opacity = 1 - (1 - MIN_OPACITY) * progress;
    this._el.style.transform = `translateX(${dx * FOLLOW_RATIO}px) scale(${scale})`;
    this._el.style.opacity = `${opacity}`;
  }

  private readonly _clickGuard = (event: MouseEvent) => {
    if (!this._suppressClick) return;
    this._suppressClick = false;
    event.stopPropagation();
    event.preventDefault();
  };
}
