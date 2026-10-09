import { TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatInput, MatLabel } from '@angular/material/input';
import { MatTooltip } from '@angular/material/tooltip';
import { NotifierService } from 'angular-notifier';
import { catchError, of, tap } from 'rxjs';
import { TelegramChatModel, TelegramChatStatus, TelegramStatusModel } from '../../models/settings.model';
import { ArrayPipe } from '../../pipes/array.pipe';
import { HttpService } from '../../services/http.service';
import { StorageService } from '../../services/storage.service';
import { WsService } from '../../services/ws.service';
import { DropArea } from '../drop-area/drop-area';
import { DRAG_TOKEN } from '../../constants/drag-token';
import { MatDialogConfig } from '@angular/material/dialog';
import { SizePipe } from '../../pipes/size.pipe';

const DIALOG_DATA: MatDialogConfig = {
  data: {
    title: 'Update avatar',
    message: 'Upprove chat first. Custom avatar will be reset after approval.',
    cancelText: ' ',
    actionText: 'Okay',
    role: 'dialog',
  },
};

@Component({
  selector: 'rt-telegram-chats',
  imports: [
    FormsModule,
    MatButton,
    MatIconButton,
    MatIcon,
    MatFormField,
    MatInput,
    MatLabel,
    MatTooltip,
    TitleCasePipe,
    ArrayPipe,
    DropArea,
    SizePipe,
  ],
  templateUrl: './telegram-chats.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelegramChats implements OnInit {
  private readonly _http = inject(HttpService);
  private readonly _storage = inject(StorageService);
  private readonly _ws = inject(WsService);
  private readonly _notifier = inject(NotifierService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _drag = inject(DRAG_TOKEN);

  saved = output<void>();

  status = signal<TelegramStatusModel | null>(null);
  /** Shared with the download menus; HttpService keeps it in step with every request. */
  chats = this._storage.telegramChats;
  isTesting = signal(false);
  isAdding = signal(false);

  newChatId = '';
  newChatName = '';
  dialogData = DIALOG_DATA;
  isDragOver = toSignal(this._drag, { initialValue: false });

  ngOnInit() {
    this._http
      .getTelegramStatus()
      .pipe(catchError(() => of(null)))
      .subscribe((status) => this.status.set(status));

    this._http
      .getTelegramChats()
      .pipe(catchError(() => of([])))
      .subscribe();

    this._ws
      .telegramStatus$()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((status) => this.status.set(status));

    this._ws
      .telegramChats$()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((chats) => this.chats.set(chats));
  }

  setChatStatus(chat: TelegramChatModel, status: TelegramChatStatus) {
    this._update(chat, { status });
  }

  setNotify(chat: TelegramChatModel, notify: boolean) {
    this._update(chat, { notify });
  }

  rename(chat: TelegramChatModel, name: string) {
    const trimmed = name.trim();

    if (trimmed === (chat.name ?? '')) return;

    this._update(chat, { name: trimmed || null });
  }

  remove(chat: TelegramChatModel) {
    this._http.deleteTelegramChat(chat.chatId).subscribe({
      error: () => this._notifier.notify('error', 'Could not remove the chat.'),
    });
  }

  addChat() {
    const chatId = this.newChatId.trim();

    if (!chatId) return;

    this._http.addTelegramChat(chatId, this.newChatName.trim() || null).subscribe({
      next: () => {
        this.newChatId = '';
        this.newChatName = '';
        this.isAdding.set(false);
      },
      error: (e) => this._notifier.notify('error', e?.error?.error ?? 'Could not add the chat.'),
    });
  }

  uploadAvatar(chat: TelegramChatModel, file: File) {
    if (chat.status !== 'approved') return;

    this._http.updateChatAvatar(chat.chatId, file).subscribe({
      error: () => this._notifier.notify('error', 'Could not upload the avatar.'),
    });
  }

  test() {
    this.isTesting.set(true);

    this._http.testTelegram().subscribe({
      next: (result) => {
        this.isTesting.set(false);

        if (!result.sent && !result.errors.length) {
          this._notifier.notify('warning', 'No chat has notifications turned on.');
        } else if (result.errors.length) {
          const failed = result.errors.map((e) => `${e.name ?? e.chatId}: ${e.error}`).join('; ');
          this._notifier.notify('error', `Sent to ${result.sent}, failed: ${failed}`);
        } else {
          this._notifier.notify('success', `Test sent to ${result.sent} chat(s).`);
        }
      },
      error: (e) => {
        this.isTesting.set(false);
        this._notifier.notify('error', e?.error?.error ?? 'Test failed.');
      },
    });
  }

  private _update(chat: TelegramChatModel, patch: Parameters<HttpService['updateTelegramChat']>[1]) {
    this._http
      .updateTelegramChat(chat.chatId, patch)
      .pipe(tap(() => this.saved.emit()))
      .subscribe({
        error: () => this._notifier.notify('error', 'Could not update the chat.'),
      });
  }
}
