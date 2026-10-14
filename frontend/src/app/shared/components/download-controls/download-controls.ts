import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, viewChild, ViewEncapsulation } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatInput } from '@angular/material/input';
import { MatMenu, MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { NotifierService } from 'angular-notifier';
import { catchError, EMPTY, Observable, switchMap } from 'rxjs';
import { hasFile } from '../../helpers/common.helpers';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { Types } from '../../models/subscription.model';
import { HttpService } from '../../services/http.service';
import { StorageService } from '../../services/storage.service';
import { Decision, DecisionDialog } from '../decision-dialog/decision-dialog';

const DIALOG_DATA: MatDialogConfig = {
  data: {
    title: 'Conflict',
    message:
      'Another download record with this path already exists. This means that two or more records will be directed to the same file. Are you sure you want to proceed?',
    details: [],
    cancelText: 'Cancel',
    actionText: 'Proceed',
  },
};

@Component({
  selector: 'rt-download-controls',
  imports: [
    MatIcon,
    MatButtonModule,
    MatMenuModule,
    MatTooltip,
    FormsModule,
    MatInput,
    MatFormField,
    MatPrefix,
    MatSuffix,
  ],
  templateUrl: './download-controls.html',
  styleUrl: './download-controls.css',
  encapsulation: ViewEncapsulation.None,
})
export class DownloadControls {
  private readonly _http = inject(HttpService);
  private readonly _storage = inject(StorageService);
  private readonly _notifier = inject(NotifierService);
  private readonly _dialog = inject(MatDialog);

  readonly types = Types;
  readonly downloadStatus = DownloadStatus;
  readonly dialogData = DIALOG_DATA;

  webhookUrl = computed(() => this._storage.settings().webhookUrl);
  telegramStatus = this._storage.telegramStatus;
  telegramChats = computed(() => this._storage.telegramChats().filter((chat) => chat.status === 'approved'));
  telegramLimit = computed(() => (this.telegramStatus()?.local ? 2000 : 50) * 1024 * 1024);

  download = input.required<DownloadModel>();
  paginatorLimit = input.required<number>();
  retry = output<void>();
  remove = output<void>();
  saveAs = output<DownloadModel>();
  copyFilePath = output<DownloadModel>();
  isBelowTelegramLimit = computed(() => this.download().totalBytes < this.telegramLimit());

  filePath = '';
  fileName = '';
  hasFile = computed(() => hasFile(this.download()));
  downloadsFolder = computed(() => this._storage.settings().downloadsDir);
  actionsMenu = viewChild<MatMenu>('actionsMenu');

  closeActionsMenu() {
    this.actionsMenu()?.closed.emit();
  }

  setFilePath(filePath: string, download: DownloadModel) {
    const path = filePath.trim();
    if (!path) return;

    // A 409 arrives as an error, not as a value, so the conflict is caught here.
    this._http
      .setDownloadPath(download.id, path)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          if (error.status === 409 && error.error?.conflict) {
            const page = Math.floor(error.error.conflict.index / 5) + 1;
            this.dialogData.data.details = [
              `Title of the conflicting record: "${error.error.conflict.title}".`,
              `You can find this record on page ${page}`,
            ];

            return this._openConfirmationDialog().pipe(
              switchMap((decision) =>
                decision === Decision.CONFIRM ? this._http.setDownloadPathForce(download.id, path) : EMPTY,
              ),
            );
          }

          // The first request is silent so the conflict shows no toast; every other error still needs one.
          const message = error.error?.error || 'Request failed';
          this._notifier.notify('error', `${message} (status: ${error.status || 'unknown'})`);

          return EMPTY;
        }),
      )
      .subscribe({
        next: () => {
          this._notifier.notify('success', 'File path successfully updated.');
          this.filePath = '';
          this.closeActionsMenu();
        },
      });
  }

  setFileName(fileName: string, download: DownloadModel) {
    if (!fileName.trim()) return;

    this._http.setFileName(download.id, fileName.trim()).subscribe({
      next: () => {
        this._notifier.notify('success', 'File name successfully updated.');
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

  private _openConfirmationDialog(): Observable<Decision> {
    const dialogRef = this._dialog.open(DecisionDialog, this.dialogData);
    return dialogRef.afterClosed();
  }
}
