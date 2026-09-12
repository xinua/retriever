import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { APP_VERSION } from '@shared/constants';
import { VersionModel } from '@shared/models';
import { HttpService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { filter, tap } from 'rxjs';
import { ReleaseNotesDialog } from '../release-notes-dialog/release-notes-dialog';

@Component({
  selector: 'rt-app-version',
  imports: [MatIcon, MatTooltip],
  templateUrl: './app-version.html',
  styleUrl: './app-version.css',
})
export class AppVersion implements OnInit {
  private readonly _http = inject(HttpService);
  private readonly _dialog = inject(MatDialog);
  private readonly _notifier = inject(NotifierService);

  readonly version = signal<string>(APP_VERSION);
  versionInfo = signal<VersionModel | null>(null);

  readonly isUpdateAvailable = computed(() => this.versionInfo()?.updateAvailable ?? false);
  readonly cacheExpired = computed(() => this.versionInfo()?.current !== APP_VERSION);
  readonly isUserNotified = computed(() => this.getUserNotified());

  ngOnInit() {
    this._http
      .checkVersion()
      .pipe(
        filter((versionInfo) => !versionInfo.error),
        tap((versionInfo) => this.versionInfo.set(versionInfo)),
        filter(() => this.isUpdateAvailable()),
        tap(() => this.notifyUser()),
      )
      .subscribe();
  }

  private notifyUser() {
    if (this.isUserNotified()) return;
    this._notifier.notify('update', `Update available! v${this.versionInfo()?.latest}`);
    this.saveUserNotified();
  }

  private saveUserNotified() {
    if (!this.versionInfo()?.latest) return;
    window.localStorage.setItem(`app-version-${this.versionInfo()?.latest}-notified`, 'true');
  }

  private getUserNotified(): boolean {
    return JSON.parse(window.localStorage.getItem(`app-version-${this.versionInfo()?.latest}-notified`));
  }

  showReleaseNotes() {
    this._dialog.open(ReleaseNotesDialog, {
      maxWidth: '1000px',
      data: this.versionInfo(),
    });
  }
}
