import { DestroyRef, Directive, inject, input, numberAttribute, output } from '@angular/core';

export enum ClickAction {
  SINGLE = 'single',
  DOUBLE = 'double',
}

export interface ClickEvent {
  event: MouseEvent;
  action: ClickAction;
}

@Directive({
  selector: '[rtClick]',
  host: {
    '(click)': 'onClick($event)',
  },
})
export class DoubleClick {
  readonly rtClick = output<ClickEvent>();
  readonly rtClickDelay = input(250, { transform: numberAttribute });

  private _timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this._timer));
  }

  onClick(event: MouseEvent) {
    if (this._timer !== undefined) {
      this._reset();
      this.rtClick.emit({ event, action: ClickAction.DOUBLE });
      return;
    }

    this._timer = setTimeout(() => {
      this._reset();
      this.rtClick.emit({ event, action: ClickAction.SINGLE });
    }, this.rtClickDelay());
  }

  private _reset() {
    clearTimeout(this._timer);
    this._timer = undefined;
  }
}
