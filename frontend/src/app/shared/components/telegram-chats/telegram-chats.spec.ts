import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { TelegramChatModel, TelegramStatusModel } from '@shared/models';
import { DRAG_TOKEN } from '@shared/constants';
import { HttpService, StorageService, WsService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { NEVER, Observable, of, Subject, tap, throwError } from 'rxjs';

import { TelegramChats } from './telegram-chats';

const chat = (overrides: Partial<TelegramChatModel> = {}): TelegramChatModel => ({
  chatId: '100',
  avatar: null,
  type: 'private',
  name: 'Alice',
  username: 'alice',
  status: 'approved',
  notify: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const botStatus = (overrides: Partial<TelegramStatusModel> = {}): TelegramStatusModel => ({
  enabled: true,
  configured: true,
  warning: null,
  running: true,
  username: 'retriever_bot',
  error: null,
  local: false,
  apiRoot: 'https://api.telegram.org',
  limitMb: 50,
  ...overrides,
});

describe('TelegramChats', () => {
  let fixture: ComponentFixture<TelegramChats>;
  let component: TelegramChats;
  let http: Record<string, ReturnType<typeof vi.fn>>;
  let notify: ReturnType<typeof vi.fn>;
  let wsStatus: Subject<TelegramStatusModel>;
  let wsChats: Subject<TelegramChatModel[]>;

  // The real HttpService writes every chat response to StorageService, which the component renders from.
  const store = <T>(source: Observable<T>, write: (chats: TelegramChatModel[], value: T) => TelegramChatModel[]) =>
    source.pipe(tap((value) => TestBed.inject(StorageService).telegramChats.update((chats) => write(chats, value))));

  beforeEach(async () => {
    http = {
      getTelegramStatus: vi.fn(() => of(botStatus())),
      getTelegramChats: vi.fn(() => of([])),
      updateTelegramChat: vi.fn((chatId: string, patch: Partial<TelegramChatModel>) =>
        store(of(chat({ chatId, ...patch })), (chats, updated) =>
          chats.map((c) => (c.chatId === updated.chatId ? updated : c)),
        ),
      ),
      deleteTelegramChat: vi.fn((chatId: string) =>
        store(of({ ok: true }), (chats) => chats.filter((c) => c.chatId !== chatId)),
      ),
      addTelegramChat: vi.fn((chatId: string, name: string | null) =>
        store(of(chat({ chatId, name })), (chats, added) => [...chats.filter((c) => c.chatId !== added.chatId), added]),
      ),
      testTelegram: vi.fn(),
    };
    notify = vi.fn();
    wsStatus = new Subject();
    wsChats = new Subject();

    await TestBed.configureTestingModule({
      imports: [TelegramChats],
      providers: [
        { provide: HttpService, useValue: http },
        { provide: NotifierService, useValue: { notify } },
        { provide: DRAG_TOKEN, useValue: NEVER },
        {
          provide: WsService,
          useValue: { telegramStatus$: () => wsStatus.asObservable(), telegramChats$: () => wsChats.asObservable() },
        },
      ],
    }).compileComponents();
  });

  async function render(chats: TelegramChatModel[] = []) {
    http['getTelegramChats'].mockReturnValue(store(of(chats), (_, loaded) => loaded));
    fixture = TestBed.createComponent(TelegramChats);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const text = (): string => el().textContent.replace(/\s+/g, ' ');
  const button = (tooltip: string, root: ParentNode = el()): HTMLButtonElement | null =>
    root.querySelector(`button[mattooltip="${tooltip}"]`);
  const rows = (): HTMLElement[] =>
    Array.from(el().querySelectorAll<HTMLElement>('.border-gray-800')).filter((row) => row.querySelector('input[id]'));
  const nameInput = (chatId: string): HTMLInputElement => el().querySelector(`#chat-name-${chatId}`)!;

  async function refresh() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  describe('bot status', () => {
    it('shows a running bot with its username, server and upload limit', async () => {
      await render();

      expect(text()).toContain('connected as @retriever_bot');
      expect(text()).toContain('— cloud');
      expect(text()).toContain('50 MB limit');
      expect(text()).toContain('verified_user');
    });

    it('says when the bot uses a local Bot API server', async () => {
      http['getTelegramStatus'].mockReturnValue(of(botStatus({ local: true, limitMb: 2000 })));
      await render();

      expect(text()).toContain('— local server');
      expect(text()).toContain('2000 MB limit');
    });

    it('shows the error of a bot that is not running', async () => {
      http['getTelegramStatus'].mockReturnValue(of(botStatus({ running: false, error: '401 Unauthorized' })));
      await render();

      expect(text()).toContain('401 Unauthorized');
      expect(text()).toContain('gpp_bad');
      expect(text()).not.toContain('connected as');
    });

    it('says "not running" when a token is saved but there is no error', async () => {
      http['getTelegramStatus'].mockReturnValue(of(botStatus({ running: false, error: null })));
      await render();

      expect(text()).toContain('not running');
    });

    it('says "no token saved" when the bot is not configured', async () => {
      http['getTelegramStatus'].mockReturnValue(of(botStatus({ running: false, configured: false, error: null })));
      await render();

      expect(text()).toContain('no token saved');
    });

    it('hides the status when the bot is disabled', async () => {
      http['getTelegramStatus'].mockReturnValue(of(botStatus({ enabled: false })));
      await render();

      expect(text()).not.toContain('Bot:');
    });

    it('hides the status when the request fails', async () => {
      http['getTelegramStatus'].mockReturnValue(throwError(() => new Error('down')));
      await render();

      expect(component.status()).toBeNull();
      expect(text()).not.toContain('Bot:');
    });

    it('shows the server warning', async () => {
      http['getTelegramStatus'].mockReturnValue(of(botStatus({ warning: 'Token is used by another instance' })));
      await render();

      expect(text()).toContain('Token is used by another instance');
    });

    it('follows status pushed over the websocket', async () => {
      await render();

      wsStatus.next(botStatus({ username: 'renamed_bot' }));
      await refresh();

      expect(text()).toContain('connected as @renamed_bot');
    });
  });

  describe('chat list', () => {
    it('shows a placeholder and how to add chats when there are none', async () => {
      await render();

      expect(rows()).toHaveLength(0);
      expect(text()).toContain('No chats yet.');
      expect(el().querySelectorAll('.animate-pulse')).toHaveLength(5);
    });

    it('falls back to an empty list when the request fails', async () => {
      http['getTelegramChats'].mockReturnValue(throwError(() => new Error('down')));
      fixture = TestBed.createComponent(TelegramChats);
      component = fixture.componentInstance;
      await fixture.whenStable();

      expect(component.chats()).toEqual([]);
      expect(text()).toContain('No chats yet.');
    });

    it('lists chats with their status and name', async () => {
      await render([chat(), chat({ chatId: '200', name: null, status: 'pending' })]);

      expect(rows()).toHaveLength(2);
      expect(rows()[0].querySelector('label')!.textContent.trim()).toBe('Approved');
      expect(rows()[1].querySelector('label')!.textContent.trim()).toBe('Pending');
      expect(nameInput('100').value).toBe('Alice');
      expect(nameInput('200').value).toBe('');
      expect(nameInput('200').placeholder).toBe('200');
      expect(text()).not.toContain('No chats yet.');
    });

    it('puts the chat ID and username in the name tooltip', async () => {
      await render([chat(), chat({ chatId: '200', username: null })]);

      // The tooltip text is bound, so read it from the directive instead of the DOM.
      const tooltips = fixture.debugElement
        .queryAll(By.css('input[id]'))
        .map((input) => input.injector.get(MatTooltip).message);

      expect(tooltips).toEqual(['ID 100 · @alice', 'ID 200']);
    });

    it('replaces the list with chats pushed over the websocket', async () => {
      await render([chat()]);

      wsChats.next([chat({ chatId: '300', name: 'Bob', status: 'pending' })]);
      await refresh();

      expect(rows()).toHaveLength(1);
      expect(nameInput('300').value).toBe('Bob');
    });

    it.each([
      ['approved', ['Allow notifications', 'Block', 'Remove'], ['Approve']],
      ['pending', ['Approve', 'Block', 'Remove'], ['Allow notifications']],
      ['blocked', ['Approve', 'Remove'], ['Allow notifications', 'Block']],
    ] as const)('offers the right actions for a %s chat', async (status, shown, hidden) => {
      await render([chat({ status })]);
      const row = rows()[0];

      shown.forEach((tooltip) => expect(button(tooltip, row)).not.toBeNull());
      hidden.forEach((tooltip) => expect(button(tooltip, row)).toBeNull());
    });

    it('shows whether notifications are on for an approved chat', async () => {
      await render([chat({ notify: true }), chat({ chatId: '200', notify: false })]);

      expect(button('Allow notifications', rows()[0])!.querySelector('mat-icon')!.getAttribute('fonticon')).toBe(
        'notifications',
      );
      expect(button('Allow notifications', rows()[1])!.querySelector('mat-icon')!.getAttribute('fonticon')).toBe(
        'notifications_off',
      );
    });
  });

  describe('updating a chat', () => {
    it('approves a pending chat and emits saved', async () => {
      await render([chat({ status: 'pending' })]);
      const saved = vi.fn();
      component.saved.subscribe(saved);

      button('Approve')!.click();
      await refresh();

      expect(http['updateTelegramChat']).toHaveBeenCalledWith('100', { status: 'approved' });
      expect(component.chats()[0].status).toBe('approved');
      expect(saved).toHaveBeenCalledTimes(1);
      expect(rows()[0].querySelector('label')!.textContent.trim()).toBe('Approved');
    });

    it('blocks a chat', async () => {
      await render([chat()]);

      button('Block')!.click();

      expect(http['updateTelegramChat']).toHaveBeenCalledWith('100', { status: 'blocked' });
      expect(component.chats()[0].status).toBe('blocked');
    });

    it('toggles notifications', async () => {
      await render([chat({ notify: true })]);

      button('Allow notifications')!.click();

      expect(http['updateTelegramChat']).toHaveBeenCalledWith('100', { notify: false });
      expect(component.chats()[0].notify).toBe(false);
    });

    it('only replaces the updated chat', async () => {
      const other = chat({ chatId: '200', name: 'Bob' });
      await render([chat({ status: 'pending' }), other]);

      component.setChatStatus(component.chats()[0], 'approved');

      expect(component.chats()[1]).toBe(other);
    });

    it('reports a failed update without emitting saved', async () => {
      await render([chat()]);
      http['updateTelegramChat'].mockReturnValue(throwError(() => new Error('500')));
      const saved = vi.fn();
      component.saved.subscribe(saved);

      component.setNotify(component.chats()[0], false);

      expect(notify).toHaveBeenCalledWith('error', 'Could not update the chat.');
      expect(saved).not.toHaveBeenCalled();
      expect(component.chats()[0].notify).toBe(true);
    });
  });

  describe('renaming a chat', () => {
    beforeEach(() => render([chat({ name: 'Alice' }), chat({ chatId: '200', name: null })]));

    it('saves a trimmed name when the field loses focus', () => {
      const input = nameInput('100');
      input.value = '  Alice Smith ';
      input.dispatchEvent(new Event('blur'));

      expect(http['updateTelegramChat']).toHaveBeenCalledWith('100', { name: 'Alice Smith' });
    });

    it('blurs, and so saves, on Enter', () => {
      const input = nameInput('100');
      input.focus();
      input.value = 'Alice S';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(document.activeElement).not.toBe(input);
      expect(http['updateTelegramChat']).toHaveBeenCalledWith('100', { name: 'Alice S' });
    });

    it('skips the request when the name did not change', () => {
      component.rename(component.chats()[0], ' Alice ');
      component.rename(component.chats()[1], '   ');

      expect(http['updateTelegramChat']).not.toHaveBeenCalled();
    });

    it('clears the name to null when emptied', () => {
      component.rename(component.chats()[0], '  ');

      expect(http['updateTelegramChat']).toHaveBeenCalledWith('100', { name: null });
    });
  });

  describe('removing a chat', () => {
    it('drops the chat from the list', async () => {
      await render([chat(), chat({ chatId: '200' })]);

      button('Remove')!.click();
      await refresh();

      expect(http['deleteTelegramChat']).toHaveBeenCalledWith('100');
      expect(component.chats().map((c) => c.chatId)).toEqual(['200']);
      expect(rows()).toHaveLength(1);
    });

    it('keeps the chat and reports a failure', async () => {
      await render([chat()]);
      http['deleteTelegramChat'].mockReturnValue(throwError(() => new Error('500')));

      component.remove(component.chats()[0]);

      expect(component.chats()).toHaveLength(1);
      expect(notify).toHaveBeenCalledWith('error', 'Could not remove the chat.');
    });
  });

  describe('adding a chat', () => {
    const addButton = (): HTMLButtonElement | undefined =>
      Array.from(el().querySelectorAll('button')).find((b) => b.textContent.trim() === 'Add');

    async function openForm() {
      button('Add group/channel')!.click();
      await refresh();
    }

    async function type(input: HTMLInputElement, value: string) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await refresh();
    }

    const formInputs = (): HTMLInputElement[] => Array.from(el().querySelectorAll('input[matinput]'));

    it('toggles the form from the header button', async () => {
      await render();
      expect(addButton()).toBeUndefined();

      await openForm();
      expect(addButton()).toBeDefined();
      expect(button('Add group/channel')!.querySelector('mat-icon')!.getAttribute('fonticon')).toBe('close');

      button('Add group/channel')!.click();
      await refresh();
      expect(addButton()).toBeUndefined();
    });

    it('disables Add until a chat ID is typed', async () => {
      await render();
      await openForm();
      expect(addButton()!.disabled).toBe(true);

      await type(formInputs()[0], '   ');
      expect(addButton()!.disabled).toBe(true);

      await type(formInputs()[0], '-1001');
      expect(addButton()!.disabled).toBe(false);
    });

    it('adds a trimmed chat, then resets and closes the form', async () => {
      await render();
      await openForm();
      await type(formInputs()[0], ' -1001234 ');
      await type(formInputs()[1], ' Family ');

      addButton()!.click();
      await refresh();

      expect(http['addTelegramChat']).toHaveBeenCalledWith('-1001234', 'Family');
      expect(component.chats().map((c) => c.chatId)).toEqual(['-1001234']);
      expect(component.newChatId).toBe('');
      expect(component.newChatName).toBe('');
      expect(component.isAdding()).toBe(false);
      expect(addButton()).toBeUndefined();
    });

    it('submits on Enter in either field', async () => {
      await render();
      await openForm();
      await type(formInputs()[0], '-1001');

      formInputs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(http['addTelegramChat']).toHaveBeenCalledWith('-1001', null);
    });

    it('does nothing without a chat ID', async () => {
      await render();
      component.newChatId = '   ';

      component.addChat();

      expect(http['addTelegramChat']).not.toHaveBeenCalled();
    });

    it('replaces a chat that is already listed instead of duplicating it', async () => {
      await render([chat({ chatId: '100', name: 'Old' }), chat({ chatId: '200' })]);
      component.newChatId = '100';
      component.newChatName = 'New';

      component.addChat();

      expect(component.chats().map((c) => [c.chatId, c.name])).toEqual([
        ['200', 'Alice'],
        ['100', 'New'],
      ]);
    });

    it('shows the server error and keeps the form', async () => {
      await render();
      http['addTelegramChat'].mockReturnValue(throwError(() => ({ error: { error: 'Chat not found' } })));
      component.isAdding.set(true);
      component.newChatId = '-1001';

      component.addChat();

      expect(notify).toHaveBeenCalledWith('error', 'Chat not found');
      expect(component.newChatId).toBe('-1001');
      expect(component.isAdding()).toBe(true);
    });

    it('falls back to a generic error message', async () => {
      await render();
      http['addTelegramChat'].mockReturnValue(throwError(() => new Error('network')));
      component.newChatId = '-1001';

      component.addChat();

      expect(notify).toHaveBeenCalledWith('error', 'Could not add the chat.');
    });
  });

  describe('test message', () => {
    it('is offered only when some chat has notifications on', async () => {
      await render([chat({ notify: false })]);
      expect(button('Send a test message to every chat with Notify on')).toBeNull();

      component.chats.set([chat({ notify: true })]);
      await refresh();
      expect(button('Send a test message to every chat with Notify on')).not.toBeNull();
    });

    it('reports how many chats got the message', async () => {
      await render([chat()]);
      http['testTelegram'].mockReturnValue(of({ ok: true, sent: 2, errors: [] }));

      button('Send a test message to every chat with Notify on')!.click();

      expect(component.isTesting()).toBe(false);
      expect(notify).toHaveBeenCalledWith('success', 'Test sent to 2 chat(s).');
    });

    it('warns when no chat has notifications on', async () => {
      await render([chat()]);
      http['testTelegram'].mockReturnValue(of({ ok: true, sent: 0, errors: [] }));

      component.test();

      expect(notify).toHaveBeenCalledWith('warning', 'No chat has notifications turned on.');
    });

    it('lists the chats that failed, by name or ID', async () => {
      await render([chat()]);
      http['testTelegram'].mockReturnValue(
        of({
          ok: false,
          sent: 1,
          errors: [
            { chatId: '200', name: 'Bob', error: 'Forbidden' },
            { chatId: '300', name: null, error: 'Chat not found' },
          ],
        }),
      );

      component.test();

      expect(notify).toHaveBeenCalledWith('error', 'Sent to 1, failed: Bob: Forbidden; 300: Chat not found');
    });

    it('shows the server error when the request fails', async () => {
      await render([chat()]);
      http['testTelegram'].mockReturnValue(throwError(() => ({ error: { error: 'Bot is not running' } })));

      component.test();

      expect(component.isTesting()).toBe(false);
      expect(notify).toHaveBeenCalledWith('error', 'Bot is not running');
    });

    it('falls back to a generic error message', async () => {
      await render([chat()]);
      http['testTelegram'].mockReturnValue(throwError(() => new Error('network')));

      component.test();

      expect(notify).toHaveBeenCalledWith('error', 'Test failed.');
    });

    it('disables the button while sending', async () => {
      await render([chat()]);
      http['testTelegram'].mockReturnValue(NEVER);

      component.test();
      await refresh();

      expect(component.isTesting()).toBe(true);
      expect(button('Send a test message to every chat with Notify on')!.disabled).toBe(true);
    });
  });
});

@Component({
  imports: [TelegramChats],
  template: `
    <rt-telegram-chats>
      <div class="bot-settings">bot settings</div>
      <div class="keep-files">keep files</div>
      <div class="notify-failed">notify failed</div>
    </rt-telegram-chats>
  `,
})
class Host {}

describe('TelegramChats content projection', () => {
  let chats: Subject<TelegramChatModel[]>;

  beforeEach(async () => {
    chats = new Subject();

    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        {
          provide: HttpService,
          useValue: { getTelegramStatus: () => of(botStatus()), getTelegramChats: () => of([]) },
        },
        { provide: NotifierService, useValue: { notify: vi.fn() } },
        { provide: DRAG_TOKEN, useValue: NEVER },
        { provide: WsService, useValue: { telegramStatus$: () => NEVER, telegramChats$: () => chats } },
      ],
    }).compileComponents();
  });

  it('projects the bot settings and keep-files slots, and the failure toggle only with notifying chats', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const text = () => fixture.nativeElement.textContent;

    expect(text()).toContain('bot settings');
    expect(text()).toContain('keep files');
    expect(text()).not.toContain('notify failed');

    chats.next([chat({ notify: true })]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text()).toContain('notify failed');
  });
});
