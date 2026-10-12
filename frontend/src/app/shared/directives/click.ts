import { DestroyRef, Directive, inject, input, numberAttribute, output } from '@angular/core';

export type ClickAction = 'single' | 'double';

@Directive({
  selector: '[rtClick]',
  host: {
    '(click)': 'onClick()',
  },
})
export class Click {
  readonly rtClick = output<ClickAction>();
  readonly rtClickDelay = input(250, { transform: numberAttribute });

  private _timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this._timer));
  }

  onClick() {
    if (this._timer !== undefined) {
      this._reset();
      this.rtClick.emit('double');
      return;
    }

    this._timer = setTimeout(() => {
      this._reset();
      this.rtClick.emit('single');
    }, this.rtClickDelay());
  }

  private _reset() {
    clearTimeout(this._timer);
    this._timer = undefined;
  }
}
