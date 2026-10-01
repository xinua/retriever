import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { AppVersion } from '@shared/components';
import { HttpService, StorageService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { catchError, of } from 'rxjs';

@Component({
  selector: 'rt-header',
  imports: [MatIcon, MatButton, AppVersion],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header implements OnInit {
  private readonly _storage = inject(StorageService);
  private readonly _httpService = inject(HttpService);
  private readonly _dialog = inject(MatDialog);
  private readonly _notifier = inject(NotifierService);

  isEnabled = computed(() => this._storage.settings().enabled ?? false);
  ytdlpVersion = signal<string | null>(null);
  ui = this._storage.uiConfig;

  ngOnInit() {
    this._loadVersion();
  }

  async openNewSettingsDialog(): Promise<void> {
    const { AppSettingsDialog } = await import('../../shared/components/app-settings-dialog/app-settings-dialog');
    this._dialog.open(AppSettingsDialog, { maxWidth: '800px', minWidth: '500px' });
  }

  async openThemeDialog(): Promise<void> {
    const { ThemeDialog } = await import('../../shared/components/theme-dialog/theme-dialog');
    this._dialog.open(ThemeDialog, { maxWidth: '500px' });
  }

  togglePause() {
    this._httpService.toggleEnabled().subscribe({
      next: (result) => {
        this._storage.settings.set({
          ...this._storage.settings(),
          enabled: result?.enabled ?? false,
        });
        this._notifier.notify(
          result?.enabled ? 'success' : 'info',
          result?.enabled ? 'App is now running' : 'App is now paused',
        );
      },
      error: () => this._notifier.notify('error', 'Failed to toggle pause. Please try again.'),
    });
  }

  private _loadVersion() {
    this._httpService
      .getYtdlpVersion()
      .pipe(catchError(() => of({ version: null, available: false })))
      .subscribe((result) => this.ytdlpVersion.set(result.version));
  }
}
