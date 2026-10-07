import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ChangelogHistoryModel, ChangelogModel, VersionModel } from '../../models/version.model';
import { ListItemPipe } from '../../pipes/list-item.pipe';
import { HttpService } from '../../services/http.service';
import { NotifierService } from 'angular-notifier';
import { finalize } from 'rxjs';

@Component({
  selector: 'rt-release-notes-dialog',
  templateUrl: './release-notes-dialog.html',
  styleUrl: './release-notes-dialog.css',
  imports: [MatCardModule, TitleCasePipe, ListItemPipe, MatIcon, MatIconButton, DatePipe, MatTooltip],
})
export class ReleaseNotesDialog {
  private readonly _httpService = inject(HttpService);
  private readonly _notifier = inject(NotifierService);
  readonly dialogRef = inject(MatDialogRef<VersionModel>);

  /** Starts as the opener's copy; a manual check replaces it. */
  readonly info = signal<VersionModel>(inject(MAT_DIALOG_DATA));
  readonly isOutdated = computed(() => this.info()?.updateAvailable);

  /** Lets the opener refresh its own copy (badge, notification) as well. */
  readonly versionChecked = output<VersionModel>();

  changeTypes = computed(() => this._getChangeTypes());
  latestChangelog = computed(() => this._getLatestChangelog());
  currentVersionInfo = computed(() => this._getCurrentVersionInfo());

  checkedForUpdates = signal<boolean>(false);
  checking = signal<boolean>(false);

  checkForUpdates() {
    this.checking.set(true);

    this._httpService
      .checkForUpdates()
      .pipe(finalize(() => this.checking.set(false)))
      .subscribe((info) => {
        if (info.error) {
          this._notifier.notify('error', `Could not check for updates: ${info.error}`);
          return;
        }

        this.info.set(info);
        this.versionChecked.emit(info);
        this.checkedForUpdates.set(true);
      });
  }

  private _getChangeTypes(): (keyof ChangelogModel)[] {
    const latestChangelog = this.info().changelog.find((v) => v.version === this.info().latest)?.changelog;
    return Object.keys(latestChangelog ?? {}).filter(
      (key) => key !== 'images' && key !== 'developerMessage' && latestChangelog?.[key]?.length > 0,
    ) as (keyof ChangelogModel)[];
  }

  private _getLatestChangelog(): ChangelogModel | undefined {
    return this.info().changelog.find((v) => v.version === this.info().latest)?.changelog;
  }

  private _getCurrentVersionInfo(): ChangelogHistoryModel | undefined {
    return this.info().changelog.find((v) => v.version === this.info().current);
  }
}
