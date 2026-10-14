import { Component, effect, ElementRef, input, output, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ClickOutside } from '../../directives/click-outside';

@Component({
  selector: 'rt-text-input',
  imports: [MatIconButton, MatIcon, FormsModule, ClickOutside],
  template: `
    @if (!isEditing()) {
      <ng-content></ng-content>
    } @else {
      <div class="flex items-center gap-2 w-full edit-input" (clickOutside)="cancel.emit()">
        <input #input type="text" [(ngModel)]="_value" [class]="inputClass()" class="w-full" />

        <button matIconButton (click)="save.emit(_value)" class="h-7! w-7! p-0! animate-fadeIn">
          <mat-icon fontIcon="done" class="text-sm! w-4! h-4! text-white!" />
        </button>
      </div>
    }
  `,
  styleUrl: './text-input.css',
  host: {
    '(keydown.enter)': 'onEnter()',
    '(keydown.escape)': 'onEscape()',
  },
})
export class TextInput {
  value = input<string>();
  isEditing = input(false);
  inputClass = input<string>('');
  save = output<string>();
  cancel = output<void>();

  protected _value = '';
  private _inputRef = viewChild<ElementRef<HTMLInputElement>>('input');

  constructor() {
    effect(() => {
      if (this.isEditing()) {
        this._value = this.value();

        const input = this._inputRef()?.nativeElement;
        if (!input) return;
        input.value = this._value;
        input.focus();
        input.scrollLeft = input.scrollWidth;
      }
    });
  }

  onEnter(): void {
    if (this.isEditing()) this.save.emit(this._value);
  }

  onEscape(): void {
    if (this.isEditing()) this.cancel.emit();
  }
}
