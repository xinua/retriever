import { Component, computed, inject, input, output, viewChild, ViewEncapsulation } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatInput } from '@angular/material/input';
import { MatMenu, MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { NotifierService } from 'angular-notifier';
import { hasFile } from '../../helpers/common.helpers';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { HttpService } from '../../services/http.service';
import { StorageService } from '../../services/storage.service';

@Component({
  selector: 'rt-download-controls',
  imports: [MatIcon, MatButtonModule, MatMenuModule, MatTooltip, FormsModule, MatInput, MatFormField, MatPrefix],
  templateUrl: './download-controls.html',
  styleUrl: './download-controls.css',
  encapsulation: ViewEncapsulation.None,
})
export class DownloadControls {
  private readonly _storage = inject(StorageService);
  private readonly _http = inject(HttpService);
  private readonly _notifier = inject(NotifierService);

  readonly downloadStatus = DownloadStatus;

  webhookUrl = computed(() => this._storage.settings().webhookUrl);
  telegramStatus = this._storage.telegramStatus;
  telegramChats = computed(() => this._storage.telegramChats().filter((chat) => chat.status === 'approved'));
  telegramLimit = computed(() => (this.telegramStatus()?.local ? 2000 : 50) * 1024 * 1024);

  download = input.required<DownloadModel>();
  isBelowTelegramLimit = computed(() => this.download().totalBytes < this.telegramLimit());
  retry = output<void>();
  remove = output<void>();
  saveAs = output<DownloadModel>();
  copyFilePath = output<DownloadModel>();

  filePath = '';
  hasFile = computed(() => hasFile(this.download()));
  downloadsFolder = computed(() => this._storage.settings().downloadsDir);
  actionsMenu = viewChild<MatMenu>('actionsMenu');

  closeActionsMenu() {
    this.actionsMenu()?.closed.emit();
  }

  setFilePath(filePath: string, download: DownloadModel) {
    if (!filePath.trim()) return;

    this._http.setDownloadPath(download.id, filePath.trim()).subscribe({
      next: () => {
        this._notifier.notify('success', 'File path successfully updated.');
        this.filePath = '';
        this.closeActionsMenu();
      },
    });
  }

  sendToHomeAssistant(download: DownloadModel) {
    this._http.sendDownloadToHA(download.id).subscribe({
      next: () => {
        this._notifier.notify('success', 'File sent to Home Assistant.');
      },
    });
  }

  sendToTelegram(download: DownloadModel, chatId = this.telegramChats()[0]?.chatId) {
    if (!chatId) return;

    this._http.sendDownloadToTelegram(download.id, chatId).subscribe({
      next: () => this._notifier.notify('info', 'Sending to Telegram…'),
    });
  }
}
