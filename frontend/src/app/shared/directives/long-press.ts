import { DestroyRef, Directive, inject, input, numberAttribute, output } from '@angular/core';

@Directive({
  selector: '[rtLongPress]',
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(pointerup)': 'cancelPress()',
    '(pointerleave)': 'cancelPress()',
    '(pointercancel)': 'cancelPress()',
    '(dragstart)': 'cancelPress()',
    '(click)': 'onClick($event)',
    '(contextmenu)': 'onContextMenu($event)',
    '[style.-webkit-touch-callout]': '"none"',
  },
})
export class LongPress {
  readonly rtThreshold = input(500, { transform: numberAttribute });
  readonly rtLongPress = output<PointerEvent>();

  private _timer?: ReturnType<typeof setTimeout>;
  private _fired = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this._timer));
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;

    this._fired = false;
    this.cancelPress();

    this._timer = setTimeout(() => {
      this._timer = undefined;
      this._fired = true;
      this.rtLongPress.emit(event);
    }, this.rtThreshold());
  }

  cancelPress(): void {
    clearTimeout(this._timer);
    this._timer = undefined;
  }

  // The click that follows a long press must not follow the link.
  onClick(event: MouseEvent): void {
    if (!this._fired) return;

    this._fired = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
  }

  // Touch: holding a link opens the system menu instead.
  onContextMenu(event: Event): void {
    if (this._fired || this._timer !== undefined) event.preventDefault();
  }
}
