import { DestroyRef, Directive, ElementRef, Renderer2, effect, inject, input, numberAttribute } from '@angular/core';

/**
 * Adds the given class(es) to the host element on `rtTempClassEvent` (click by default)
 * and removes them after `rtTempClassDuration` seconds.
 */
@Directive({
  selector: '[rtTempClass]',
})
export class TempClass {
  private readonly _el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _renderer = inject(Renderer2);
  private _timer?: ReturnType<typeof setTimeout>;
  private _active: string[] = [];

  readonly rtTempClass = input.required<string>();
  readonly rtTempClassDuration = input(1, { transform: numberAttribute });
  readonly rtTempClassEvent = input('click');

  constructor() {
    effect((onCleanup) => {
      const unlisten = this._renderer.listen(this._el.nativeElement, this.rtTempClassEvent(), () => this._apply());
      onCleanup(unlisten);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this._timer));
  }

  private _apply(): void {
    this._clear();
    const classes = this.rtTempClass().split(/\s+/).filter(Boolean);
    if (!classes.length) return;

    // Force reflow so re-adding the same class restarts its CSS animation.
    void this._el.nativeElement.offsetWidth;
    classes.forEach((c) => this._renderer.addClass(this._el.nativeElement, c));
    this._active = classes;
    this._timer = setTimeout(() => this._clear(), this.rtTempClassDuration() * 1000);
  }

  private _clear(): void {
    clearTimeout(this._timer);
    this._active.forEach((c) => this._renderer.removeClass(this._el.nativeElement, c));
    this._active = [];
  }
}
