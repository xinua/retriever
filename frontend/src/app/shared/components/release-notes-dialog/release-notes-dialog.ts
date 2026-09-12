import { TitleCasePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ChangelogModel, VersionModel } from '@shared/models';
import { ListItemPipe } from '@shared/pipes';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'rt-release-notes-dialog',
  templateUrl: './release-notes-dialog.html',
  styleUrl: './release-notes-dialog.css',
  imports: [MatCardModule, TitleCasePipe, ListItemPipe, MatIcon, MatIconButton, DatePipe],
})
export class ReleaseNotesDialog {
  readonly data = inject(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<VersionModel>);

  changeTypes = computed(() => this._getChangeTypes());
  latestChangelog = computed(() => this._getLatestChangelog());
  currentVersionInfo = computed(() => this._getCurrentVersionInfo());

  private _getChangeTypes(): (keyof ChangelogModel)[] {
    const latestChangelog = this.data.changelog.find((v: VersionModel) => v.version === this.data.latest)?.changelog;
    return Object.keys(latestChangelog ?? {}).filter((key) => key !== 'images') as (keyof ChangelogModel)[];
  }

  private _getLatestChangelog(): ChangelogModel {
    return this.data.changelog.find((v: VersionModel) => v.version === this.data.latest)?.changelog;
  }

  private _getCurrentVersionInfo(): VersionModel {
    return this.data.changelog.find((v: VersionModel) => v.version === this.data.current);
  }
}
