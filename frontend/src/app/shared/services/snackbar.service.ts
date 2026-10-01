import { Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';
import { WebhookSnackbar } from '../components/webhook-snackbar/webhook-snackbar';
import { NotificationData, NotificationSnackbar } from '../components/notification-snackbar/notification-snackbar';
import { SnackbarType } from '../models/snackbar.model';

@Injectable({
  providedIn: 'root',
})
export class SnackbarService {
  constructor(private readonly _snackBar: MatSnackBar) {}

  open(message: string, action: string, type: SnackbarType, duration: number = 3000): MatSnackBarRef<unknown> {
    return this._snackBar.open(message, action, {
      horizontalPosition: 'right',
      panelClass: ['rt-snackbar', type],
      duration,
    });
  }

  notify(data: NotificationData, action: string, type: SnackbarType, duration: number = 3000): MatSnackBarRef<unknown> {
    return this._snackBar.openFromComponent(NotificationSnackbar, {
      data,
      horizontalPosition: 'right',
      panelClass: ['rt-snackbar', type],
      duration,
    });
  }

  showWebhookDemo(type: SnackbarType, duration: number = 3000): MatSnackBarRef<WebhookSnackbar> {
    return this._snackBar.openFromComponent(WebhookSnackbar, {
      data: { type, duration },
      horizontalPosition: 'right',
      panelClass: ['rt-snackbar', type],
      duration,
    });
  }
}
