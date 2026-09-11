import { Component, inject, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { NotifierService } from 'angular-notifier';
import { DownloadStatusLabels } from '../../constants/labels.const';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { StorageService } from '../../services/storage.service';

@Component({
  selector: 'rt-status-indicator',
  imports: [MatTooltip],
  templateUrl: './status-indicator.html',
  styleUrl: './status-indicator.css',
})
export class StatusIndicator {
  private readonly _notifier = inject(NotifierService);
  private readonly _storage = inject(StorageService);

  download = input.required<DownloadModel>();

  readonly downloadStatus = DownloadStatus;
  readonly statusLabels = DownloadStatusLabels;

  copyToClipboard(filePath: string) {
    navigator.clipboard.writeText(filePath);
    this._notifier.notify('success', 'File path copied to clipboard.');
  }

  setFilePath(filePath: string) {
    this._storage.downloads.update((downloads) => {
      return downloads.map((download) => {
        const isTarget = download.id === this.download().id;
        return isTarget ? { ...download, filePath } : download;
      });
    });
  }
}
