import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { SnackbarType } from '@shared/services';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { WEBHOOK_SNACKBAR_DATA } from './webhook-snackbar.constants';

@Component({
  selector: 'rt-snackbar-dialog',
  imports: [MatButton, MatIcon, MatTooltip],
  template: `
    <h2 mat-dialog-title>Webhook payload example:</h2>
    <div class="text-left font-mono bg-blue-100/10 p-4 rounded-md my-4 relative">
      <mat-icon
        fontIcon="content_copy"
        class="cursor-pointer absolute top-2 right-2 text-sm! w-4! h-4!"
        (click)="copyToClipboard()"
        matTooltip="Copy to clipboard"
      />

      <code>
        <pre>{{ '{' }}</pre>
        @for (item of payload; track $index) {
          <pre><span class="text-orange-500">  "{{ item[0] }}"</span>: {{ item[1] }}@if (!$last) {,}</pre>
        }
        <pre>{{ '}' }}</pre>
      </code>
    </div>
    <div class="flex justify-end">
      <button mat-flat-button (click)="snackBar.dismiss()">OK</button>
    </div>
  `,
  styleUrl: './webhook-snackbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebhookSnackbar {
  payload = Object.entries(WEBHOOK_SNACKBAR_DATA).map(([key, value]) => [key, JSON.stringify(value)]);

  constructor(
    @Inject(MAT_SNACK_BAR_DATA) protected readonly data: { type: SnackbarType; duration: number },
    protected readonly snackBar: MatSnackBarRef<WebhookSnackbar>,
  ) {}

  copyToClipboard() {
    navigator.clipboard.writeText(JSON.stringify(WEBHOOK_SNACKBAR_DATA, null, 2));
  }
}
