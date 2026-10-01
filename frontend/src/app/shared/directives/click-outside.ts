import { Directive, ElementRef, inject, output } from '@angular/core';

@Directive({
  selector: '[clickOutside]',
  standalone: true,
  host: {
    '(document:click)': 'onClick($event, $event.target)',
  },
})
export class ClickOutside {
  private readonly _elementRef = inject(ElementRef);
  clickOutside = output<MouseEvent>();

  public onClick(event: MouseEvent, targetElement: EventTarget): void {
    if (!targetElement) return;
    const clickedInside = this._elementRef.nativeElement.contains(targetElement);
    if (!clickedInside) this.clickOutside.emit(event);
  }
}
