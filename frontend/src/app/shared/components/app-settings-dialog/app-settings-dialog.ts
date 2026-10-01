import { Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { AppSettings } from '../app-settings/app-settings';

@Component({
  selector: 'rt-app-settings-dialog',
  imports: [AppSettings],
  template: `<rt-app-settings (closeDialog)="dialogRef.close()" />`,
  styleUrl: './app-settings-dialog.css',
})
export class AppSettingsDialog {
  readonly dialogRef = inject(MatDialogRef<AppSettings>);
}
