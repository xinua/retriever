import { Component, HostListener, inject } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';

export enum Decision {
  CONFIRM = 'confirm',
  ALTERNATIVE = 'alternative',
}

@Component({
  selector: 'rt-decision-dialog',
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButton, MatIcon, MatIconButton],
  template: `
    <div class="absolute top-2! right-2! z-10">
      <button matIconButton (click)="dialogRef.close(null)">
        <mat-icon fontIcon="close" class="text-white!" />
      </button>
    </div>

    <h2 mat-dialog-title>{{ data.title }}</h2>

    <mat-dialog-content>
      <p class="text-white">{{ data.message }}</p>
    </mat-dialog-content>

    <mat-dialog-actions>
      <div class="flex justify-between gap-2 w-full border-t border-dashed border-white/10 pt-2">
        <button matButton="text" [mat-dialog-close]="decision.ALTERNATIVE" class="text-gray-300! px-0!" disableRipple>
          {{ data?.cancelText || 'Cancel' }}
        </button>

        <button matButton="tonal" [mat-dialog-close]="decision.CONFIRM" disableRipple cdkFocusInitial>
          {{ data?.actionText || 'Action' }}
        </button>
      </div>
    </mat-dialog-actions>
  `,
  styles: [
    `
      ::ng-deep .mdc-button__ripple {
        opacity: 0;
      }
    `,
  ],
})
export class DecisionDialog {
  readonly data = inject(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<DecisionDialog>);
  readonly decision = Decision;

  @HostListener('keydown.enter', ['$event'])
  onEnter(event: Event) {
    if ((event.target as HTMLElement)?.closest('button')) return;
    this.dialogRef.close(Decision.CONFIRM);
  }
}
