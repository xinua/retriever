import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'rt-badge',
  imports: [],
  template: `
    <span [class]="finalClass()">
      <ng-content></ng-content>
    </span>
  `,
  styleUrl: './badge.css',
})
export class Badge {
  readonly defaultClass = 'text-xs leading-6 select-none rounded-md px-4 py-2 mr-2 inline-block transition-transform';
  badgeClass = input<string>('');
  isClickable = input<boolean>(false);

  finalClass = computed(() =>
    [
      this.defaultClass,
      this.badgeClass(),
      this.isClickable() ? 'cursor-pointer hover:scale-110 active:scale-100' : '',
    ].join(' '),
  );
}
