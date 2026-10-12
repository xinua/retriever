import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialogTitle } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';

export interface NotificationData {
  title?: string;
  subtitle?: string;
  message: string;
}

@Component({
  selector: 'rt-notification-snackbar',
  imports: [MatDialogTitle, MatButton, MatIcon],
  template: ` <div class="flex flex-col gap-2 relative">
      <div class="absolute -top-2 -right-2.5 cursor-pointer" (click)="snackBar.dismiss()">
        <mat-icon>close</mat-icon>
      </div>
      @if (data.title) {
        <h2 mat-dialog-title class="text-2xl! font-medium">{{ data.title }}</h2>
      }
      @if (data.subtitle) {
        <p class="text-lg! text-left">{{ data.subtitle }}</p>
      }
      <p class="text-sm text-left">{{ data.message }}</p>
    </div>

    <div class="flex justify-end">
      <button mat-stroked-button class="border-transparent! bg-[#0f0f0f]! mt-4" (click)="snackBar.dismiss()">OK</button>
    </div>`,
  styleUrl: './notification-snackbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationSnackbar {
  constructor(
    @Inject(MAT_SNACK_BAR_DATA) protected readonly data: NotificationData,
    protected readonly snackBar: MatSnackBarRef<NotificationSnackbar>,
  ) {}
}
