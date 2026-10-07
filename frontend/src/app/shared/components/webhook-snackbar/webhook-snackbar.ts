import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBarRef } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { HighlightModule } from 'ngx-highlightjs';
import { notifyWebhook } from '../../constants/code.const';

@Component({
  selector: 'rt-snackbar-dialog',
  imports: [MatButton, MatIcon, MatTooltip, HighlightModule],
  template: `
    <h2 mat-dialog-title>Webhook payload example:</h2>
    <div class="text-left font-mono bg-blue-100/10 p-4 rounded-md my-4 relative">
      <mat-icon
        fontIcon="content_copy"
        class="cursor-pointer absolute top-2 right-2 text-sm! w-4! h-4!"
        (click)="copyToClipboard()"
        matTooltip="Copy to clipboard"
      />

      <pre [highlight]="payload" language="js" class="text-xs overflow-x-auto p-4">
        <code></code>
      </pre>

      <!-- <code>
        <pre>{{ '{' }}</pre>
        @for (item of payload; track $index) {
          <pre><span class="text-orange-500">  "{{ item[0] }}"</span>: {{ item[1] }}@if (!$last) {,}</pre>
        }
        <pre>{{ '}' }}</pre>
      </code> -->
    </div>
    <div class="flex justify-end">
      <button mat-flat-button (click)="snackBar.dismiss()">OK</button>
    </div>
  `,
  styleUrl: './webhook-snackbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebhookSnackbar {
  payload = JSON.stringify({ ...notifyWebhook, date: new Date().toISOString() }, null, 2);

  constructor(protected readonly snackBar: MatSnackBarRef<WebhookSnackbar>) {}

  copyToClipboard() {
    navigator.clipboard.writeText(this.payload);
  }
}
