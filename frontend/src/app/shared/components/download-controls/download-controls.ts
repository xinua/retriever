import { Component, computed, inject, input, output, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatInput } from '@angular/material/input';
import { MatMenu, MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { StorageService } from '../../services/storage.service';
import { HttpService } from '../../services/http.service';
import { NotifierService } from 'angular-notifier';

@Component({
  selector: 'rt-download-controls',
  imports: [MatIcon, MatButtonModule, MatMenuModule, MatTooltip, FormsModule, MatInput, MatFormField, MatPrefix],
  templateUrl: './download-controls.html',
  styleUrl: './download-controls.css',
})
export class DownloadControls {
  private readonly _storage = inject(StorageService);
  private readonly _httpService = inject(HttpService);
  private readonly _notifier = inject(NotifierService);

  readonly downloadStatus = DownloadStatus;

  download = input.required<DownloadModel>();

  retry = output<void>();
  remove = output<void>();
  saveAs = output<DownloadModel>();
  copyFilePath = output<DownloadModel>();

  filePath = '';
  downloadsFolder = computed(() => this._storage.settings().downloadsDir);
  actionsMenu = viewChild<MatMenu>('actionsMenu');

  closeActionsMenu() {
    this.actionsMenu()?.closed.emit();
  }

  setFilePath(filePath: string, download: DownloadModel) {
    if (!filePath.trim()) return;

    this._httpService.setDownloadPath(download.id, filePath.trim()).subscribe({
      next: () => {
        this._notifier.notify('success', 'File path successfully updated.');
        this.filePath = '';
        this.closeActionsMenu();
      },
    });
  }
}
