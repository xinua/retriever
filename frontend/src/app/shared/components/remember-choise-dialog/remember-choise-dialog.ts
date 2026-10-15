import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatCheckbox } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';

export interface ChoiseData {
  title: string;
  message: string;
  rememberChoise: boolean;
  rememberChoiseText: string;
  details: string | string[];
  cancelText: string;
  actionText: string;
}

export interface ChoiseResult {
  value: boolean;
  rememberChoise: boolean;
}

@Component({
  selector: 'rt-remember-choise-dialog',
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButton, MatCheckbox, FormsModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>

    <mat-dialog-content>
      <div class="flex flex-col gap-2 overflow-hidden">
        <p class="text-white">{{ data.message }}</p>

        @if (data.details && data.details.length > 0) {
          <div>
            @if (isDetailsArray) {
              @for (detail of data.details; track $index) {
                <p class="text-white">{{ detail }}</p>
              }
            } @else {
              <p class="text-white">{{ data.details }}</p>
            }
          </div>
        }

        @if (data.rememberChoise) {
          <mat-checkbox labelPosition="before" [(ngModel)]="rememberChoise">{{
            data.rememberChoiseText || 'Remember my choice'
          }}</mat-checkbox>
        }
      </div>
    </mat-dialog-content>

    <mat-dialog-actions>
      <div class="flex justify-between w-full">
        <button
          matButton
          [mat-dialog-close]="{ value: false, rememberChoise: rememberChoise }"
          class="text-gray-300!"
          disableRipple
        >
          {{ data?.cancelText || 'Cancel' }}
        </button>

        <button
          matButton="tonal"
          [mat-dialog-close]="{ value: true, rememberChoise: rememberChoise }"
          disableRipple
          cdkFocusInitial
        >
          {{ data?.actionText || 'Action' }}
        </button>
      </div>
    </mat-dialog-actions>
  `,
  styleUrl: './remember-choise-dialog.css',
  host: {
    '(keydown.enter)': 'onEnter()',
    '(keydown.escape)': 'onEscape()',
  },
})
export class RememberChoiseDialog {
  readonly data = inject(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<RememberChoiseDialog>);
  readonly isDetailsArray = Array.isArray(this.data.details);
  rememberChoise = false;

  onEnter() {
    this.dialogRef.close({
      value: true,
      rememberChoise: this.rememberChoise,
    });
  }

  onEscape() {
    this.dialogRef.close({
      value: false,
      rememberChoise: this.rememberChoise,
    });
  }
}
