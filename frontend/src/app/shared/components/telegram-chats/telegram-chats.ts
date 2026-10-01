import { TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { WsService } from '../../services/ws.service';

/**
 * The live half of the Telegram settings: the bot's status, the chats it
 * knows about, and the actions that take effect at once rather than on Save -
 * approving a chat, toggling its notifications, sending a test.
 */
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
  ],
  templateUrl: './telegram-chats.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelegramChats implements OnInit {
  private readonly _http = inject(HttpService);
  private readonly _ws = inject(WsService);
  private readonly _notifier = inject(NotifierService);
  private readonly _destroyRef = inject(DestroyRef);

  saved = output<void>();

  status = signal<TelegramStatusModel | null>(null);
  chats = signal<TelegramChatModel[]>([]);
  isTesting = signal(false);
  isAdding = signal(false);

  newChatId = '';
  newChatName = '';

  ngOnInit() {
    this._http
      .getTelegramStatus()
      .pipe(catchError(() => of(null)))
      .subscribe((status) => this.status.set(status));

    this._http
      .getTelegramChats()
      .pipe(catchError(() => of([])))
      .subscribe((chats) => this.chats.set(chats));

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
      next: () => this.chats.update((chats) => chats.filter((c) => c.chatId !== chat.chatId)),
      error: () => this._notifier.notify('error', 'Could not remove the chat.'),
    });
  }

  addChat() {
    const chatId = this.newChatId.trim();

    if (!chatId) return;

    this._http.addTelegramChat(chatId, this.newChatName.trim() || null).subscribe({
      next: (chat) => {
        this.chats.update((chats) => [...chats.filter((c) => c.chatId !== chat.chatId), chat]);
        this.newChatId = '';
        this.newChatName = '';
        this.isAdding.set(false);
      },
      error: (e) => this._notifier.notify('error', e?.error?.error ?? 'Could not add the chat.'),
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
        next: (updated) => this.chats.update((chats) => chats.map((c) => (c.chatId === updated.chatId ? updated : c))),
        error: () => this._notifier.notify('error', 'Could not update the chat.'),
      });
  }
}
