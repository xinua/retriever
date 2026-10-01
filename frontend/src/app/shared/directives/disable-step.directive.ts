import { afterRenderEffect, Directive, ElementRef, inject, input } from '@angular/core';

export interface StepInfo {
  index: number;
  enabled: boolean | null | undefined;
}

@Directive({
  selector: 'mat-stepper[rtDisableStep]',
  standalone: true,
})
export class DisableStepDirective {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  rtDisableStep = input.required<StepInfo[]>();

  constructor() {
    afterRenderEffect(() => {
      const steps = this.rtDisableStep();
      const headers = this._getHeaders();
      steps.forEach(({ index, enabled }) => {
        const header = headers[index];
        if (!header) return;
        if (enabled) this._enableStep(header);
        else this._disableStep(header);
      });
    });
  }

  private _getHeaders(): HTMLElement[] {
    return Array.from(this._host.nativeElement.querySelectorAll<HTMLElement>('mat-step-header')).filter(
      (header) => header.closest('mat-stepper') === this._host.nativeElement,
    );
  }

  private _disableStep(header: HTMLElement) {
    header.style.pointerEvents = 'none';
    header.style.cursor = 'not-allowed';
    header.style.opacity = '0.6';
    header.setAttribute('aria-disabled', 'true');
    header.tabIndex = -1;
  }

  private _enableStep(header: HTMLElement) {
    header.style.pointerEvents = '';
    header.style.cursor = '';
    header.style.opacity = '';
    header.removeAttribute('aria-disabled');
    header.tabIndex = 0;
  }
}
