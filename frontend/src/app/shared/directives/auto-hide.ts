import { DestroyRef, Directive, inject, input, numberAttribute, signal } from '@angular/core';

/**
 * Reports when the pointer has been away from the host long enough for its controls to get out of the way, so a
 * template can fade them out and have them back on the next move over it.
 *
 * ```html
 * <div rtAutoHide #autoHide="rtAutoHide">
 *   <div [class]="autoHide.hidden() ? 'opacity-0 pointer-events-none' : ''">...</div>
 * </div>
 * ```
 */
@Directive({
  selector: '[rtAutoHide]',
  exportAs: 'rtAutoHide',
  host: {
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
  },
})
export class AutoHide {
  /** Milliseconds the pointer has to stay away before the controls are hidden. */
  readonly rtAutoHideDelay = input(1000, { transform: numberAttribute });

  private readonly _hidden = signal(false);
  private _timeout?: ReturnType<typeof setTimeout>;

  readonly hidden = this._hidden.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this._timeout));
  }

  show() {
    // A pointer that comes back within the delay keeps what it was about to lose.
    clearTimeout(this._timeout);
    this._hidden.set(false);
  }

  hide() {
    clearTimeout(this._timeout);
    if (!this._canHover()) return;

    this._timeout = setTimeout(() => this._hidden.set(true), this.rtAutoHideDelay());
  }

  /**
   * A touch browser fakes a `mouseleave` around a tap, and a tap over the poster plays or pauses instead of asking
   * for the controls back — so without a hovering pointer they stay.
   */
  private _canHover(): boolean {
    return !!window.matchMedia?.('(hover: hover)').matches;
  }
}
