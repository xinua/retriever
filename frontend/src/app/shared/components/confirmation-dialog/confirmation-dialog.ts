import { Component, HostListener, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';

@Component({
  selector: 'rt-confirmation-dialog',
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButton],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>

    <mat-dialog-content>
      <p class="text-white">{{ data.message }}</p>
    </mat-dialog-content>

    <mat-dialog-actions>
      <button matButton mat-dialog-close class="text-gray-300!" disableRipple>
        {{ data?.cancelText || 'Cancel' }}
      </button>
      <button matButton="tonal" mat-dialog-close="true" disableRipple cdkFocusInitial>
        {{ data?.actionText || 'Action' }}
      </button>
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
export class ConfirmationDialog {
  readonly data = inject(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<ConfirmationDialog>);

  @HostListener('keydown.enter')
  onEnter() {
    this.dialogRef.close(true);
  }
}
