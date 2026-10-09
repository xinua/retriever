import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { inject, provideAppInitializer } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { DefaultSettings } from '@shared/constants';
import { PotStatusModel, SettingsModel } from '@shared/models';
import { HttpService, SnackbarService, StorageService, WsService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { NEVER, of, throwError } from 'rxjs';

import { provideCodeHighlight, useIconFactory } from '../../providers';
import { AppSettings } from './app-settings';

const savedSettings: SettingsModel = {
  ...DefaultSettings,
  webhookUrl: 'https://ha.local/webhook',
  downloadsDir: '/downloads',
  cookiesPath: null,
  ytdlpArgs: '--no-mtime',
  ytdlpConcurrency: 3,
  timeZone: 'UTC',
};

const potStatus = (overrides: Partial<PotStatusModel> = {}): PotStatusModel => ({
  configured: true,
  baseUrl: 'http://pot:4416',
  ok: true,
  version: '1.2.3',
  error: null,
  ...overrides,
});

describe('AppSettings', () => {
  let component: AppSettings;
  let fixture: ComponentFixture<AppSettings>;
  let http: Record<string, ReturnType<typeof vi.fn>>;
  let notify: ReturnType<typeof vi.fn>;
  let showWebhookDemo: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    http = {
      getSettings: vi.fn(() => of(savedSettings)),
      saveSettings: vi.fn((settings: SettingsModel) => of(settings)),
      uploadCookies: vi.fn(),
      removeCookies: vi.fn(),
      getYtdlpVersion: vi.fn(() => of({ version: '2025.01.01', available: true })),
      getPotStatus: vi.fn(() => of(potStatus({ configured: false }))),
      updateYtdlp: vi.fn(),
      sendWebhook: vi.fn(),
      // Used by the embedded <rt-telegram-chats>.
      getTelegramStatus: vi.fn(() => NEVER),
      getTelegramChats: vi.fn(() => of([])),
    };
    notify = vi.fn();
    showWebhookDemo = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AppSettings],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideCodeHighlight(),
        { provide: HttpService, useValue: http },
        { provide: NotifierService, useValue: { notify } },
        { provide: SnackbarService, useValue: { showWebhookDemo } },
        { provide: WsService, useValue: { telegramStatus$: () => NEVER, telegramChats$: () => NEVER } },
        // Registers the app's SVG icons (telegram, homeassistant) the stepper uses.
        provideAppInitializer(() => {
          const initializerFn = useIconFactory(inject(DomSanitizer), inject(MatIconRegistry));
          return initializerFn();
        }),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function render() {
    fixture = TestBed.createComponent(AppSettings);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  const storage = () => TestBed.inject(StorageService);
  const text = (): string => fixture.nativeElement.textContent.replace(/\s+/g, ' ');
  const saveButtons = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).filter((b) =>
      (b as HTMLButtonElement).textContent.includes('Save'),
    ) as HTMLButtonElement[];
  const fileInput = (file?: File) =>
    ({ files: file ? [file] : [], value: 'C:\\fakepath\\cookies.txt' }) as unknown as HTMLInputElement;

  describe('loading', () => {
    it('fills the form with the saved settings', async () => {
      await render();

      expect(component.form.value).toMatchObject({
        webhookUrl: 'https://ha.local/webhook',
        downloadsDir: '/downloads',
        ytdlpArgs: '--no-mtime',
        ytdlpConcurrency: 3,
        timeZone: 'UTC',
      });
    });

    it('keeps the cookies path outside the form and shows only its file name', async () => {
      http['getSettings'].mockReturnValue(of({ ...savedSettings, cookiesPath: '/config/cookies/my-cookies.txt' }));
      await render();

      expect(component.cookiesPath()).toBe('/config/cookies/my-cookies.txt');
      expect(component.cookiesFileName()).toBe('my-cookies.txt');
    });

    it('splits Windows-style cookie paths too', async () => {
      await render();
      component.cookiesPath.set('C:\\data\\cookies.txt');

      expect(component.cookiesFileName()).toBe('cookies.txt');
    });

    it('shows the yt-dlp version', async () => {
      await render();

      expect(component.ytdlpVersion()).toBe('2025.01.01');
      expect(text()).toContain('yt-dlp version: 2025.01.01');
    });

    it('says the version is not detected when the request fails', async () => {
      http['getYtdlpVersion'].mockReturnValue(throwError(() => new Error('down')));
      await render();

      expect(component.ytdlpVersion()).toBeNull();
      expect(text()).toContain('not detected');
    });

    it('leaves the POT status empty when the check fails', async () => {
      http['getPotStatus'].mockReturnValue(throwError(() => new Error('down')));
      await render();

      expect(component.potStatus()).toBeNull();
    });
  });

  describe('save button', () => {
    it('is disabled until something changes', async () => {
      await render();

      expect(component.form.errors).toEqual({ unchanged: true });
      expect(saveButtons().every((b) => b.disabled)).toBe(true);

      component.form.controls.ytdlpArgs.setValue('--no-part');
      fixture.detectChanges();

      expect(component.form.valid).toBe(true);
      expect(saveButtons().every((b) => !b.disabled)).toBe(true);
    });

    it('is disabled again when the change is undone', async () => {
      await render();

      component.form.controls.ytdlpArgs.setValue('--no-part');
      component.form.controls.ytdlpArgs.setValue('--no-mtime');

      expect(component.form.valid).toBe(false);
    });
  });

  describe('validation', () => {
    beforeEach(render);

    it.each([0, 11])('rejects %i parallel downloads', (value) => {
      component.form.controls.ytdlpConcurrency.setValue(value);

      expect(component.form.controls.ytdlpConcurrency.invalid).toBe(true);
    });

    it('rejects a webhook URL without a scheme', () => {
      component.form.controls.webhookUrl.setValue('ha.local/webhook');

      expect(component.form.controls.webhookUrl.errors?.['invalidUrl']).toBe(true);
    });

    it('rejects a Bot API URL without a scheme', () => {
      component.form.controls.telegramApiUrl.setValue('localhost:8081');

      expect(component.form.controls.telegramApiUrl.errors?.['invalidUrl']).toBe(true);
    });

    it('rejects an unknown time zone', () => {
      component.form.controls.timeZone.setValue('Mars/Olympus');

      expect(component.form.controls.timeZone.errors).toEqual({ unknownTimeZone: true });
    });

    it.each([null, '', '   ', 'UTC', ' UTC '])('accepts the time zone %j', (value) => {
      component.form.controls.timeZone.setValue(value);

      expect(component.form.controls.timeZone.errors).toBeNull();
    });
  });

  describe('time zone', () => {
    beforeEach(render);

    it('filters options by what was typed, treating spaces as underscores', () => {
      component.form.controls.timeZone.setValue('new york');

      expect(component.timeZoneOptions()).toContain('America/New_York');
      expect(component.timeZoneOptions().every((zone) => zone.toLowerCase().includes('new_york'))).toBe(true);
    });

    it('caps the options at 50', () => {
      component.form.controls.timeZone.setValue('');

      expect(component.timeZoneOptions().length).toBeLessThanOrEqual(50);
    });

    it("uses the browser's zone and marks the field dirty", () => {
      component.useBrowserTimeZone();

      expect(component.form.controls.timeZone.value).toBe(component.browserTimeZone);
      expect(component.form.controls.timeZone.dirty).toBe(true);
    });
  });

  describe('saveSettings', () => {
    it('sends stored settings merged with the form and stores the response', async () => {
      await render();
      storage().settings.set({ ...DefaultSettings, cookiesPath: '/config/cookies.txt' });
      component.form.controls.ytdlpArgs.setValue('--no-part');

      component.saveSettings();

      expect(http['saveSettings']).toHaveBeenCalledWith(
        expect.objectContaining({ cookiesPath: '/config/cookies.txt', ytdlpArgs: '--no-part', timeZone: 'UTC' }),
      );
      expect(storage().settings().ytdlpArgs).toBe('--no-part');
      expect(notify).toHaveBeenCalledWith('success', 'Settings saved successfully.');
    });

    it('trims the time zone and sends null when it is blank', async () => {
      await render();

      component.form.controls.timeZone.setValue('  UTC  ');
      component.saveSettings();
      expect(http['saveSettings']).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'UTC' }));

      component.form.controls.timeZone.setValue('   ');
      component.saveSettings();
      expect(http['saveSettings']).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: null }));
    });

    it('treats the saved values as the new baseline', async () => {
      await render();
      component.form.controls.ytdlpArgs.setValue('--no-part');
      expect(component.form.valid).toBe(true);

      component.saveSettings();

      expect(component.form.errors).toEqual({ unchanged: true });
    });

    it('reports a failed save and keeps the stored settings', async () => {
      await render();
      http['saveSettings'].mockReturnValue(throwError(() => new Error('500')));
      const before = storage().settings();

      component.saveSettings();

      expect(storage().settings()).toBe(before);
      expect(notify).toHaveBeenCalledWith('error', 'Failed to save settings.');
    });
  });

  describe('cookies', () => {
    beforeEach(render);

    it('uploads the picked file, stores the new path and clears the input', () => {
      const file = new File(['# Netscape HTTP Cookie File'], 'cookies.txt', { type: 'text/plain' });
      http['uploadCookies'].mockReturnValue(of({ ...savedSettings, cookiesPath: '/config/cookies.txt' }));
      const input = fileInput(file);

      component.uploadCookies(input);

      expect(input.value).toBe('');
      expect(http['uploadCookies']).toHaveBeenCalledWith(file);
      expect(component.cookiesPath()).toBe('/config/cookies.txt');
      expect(storage().settings().cookiesPath).toBe('/config/cookies.txt');
      expect(component.isUploadingCookies()).toBe(false);
      expect(notify).toHaveBeenCalledWith('success', 'Cookies file uploaded.');
    });

    it('does nothing when no file was picked', () => {
      const input = fileInput();

      component.uploadCookies(input);

      expect(input.value).toBe('');
      expect(http['uploadCookies']).not.toHaveBeenCalled();
      expect(component.isUploadingCookies()).toBe(false);
    });

    it('shows the server error when the upload fails', () => {
      http['uploadCookies'].mockReturnValue(throwError(() => ({ error: { error: 'Not a cookies file' } })));

      component.uploadCookies(fileInput(new File(['x'], 'bad.txt')));

      expect(notify).toHaveBeenCalledWith('error', 'Not a cookies file');
      expect(component.isUploadingCookies()).toBe(false);
      expect(component.cookiesPath()).toBeNull();
    });

    it('falls back to a generic message when the upload error has none', () => {
      http['uploadCookies'].mockReturnValue(throwError(() => new Error('network')));

      component.uploadCookies(fileInput(new File(['x'], 'bad.txt')));

      expect(notify).toHaveBeenCalledWith('error', 'Failed to upload cookies file.');
    });

    it('removes the cookies file', () => {
      component.cookiesPath.set('/config/cookies.txt');
      storage().settings.update((s) => ({ ...s, cookiesPath: '/config/cookies.txt' }));
      http['removeCookies'].mockReturnValue(of({ ...savedSettings, cookiesPath: null }));

      component.removeCookies();

      expect(component.cookiesPath()).toBeNull();
      expect(storage().settings().cookiesPath).toBeNull();
      expect(notify).toHaveBeenCalledWith('success', 'Cookies file removed.');
    });

    it('keeps the cookies file when removing fails', () => {
      component.cookiesPath.set('/config/cookies.txt');
      http['removeCookies'].mockReturnValue(throwError(() => new Error('500')));

      component.removeCookies();

      expect(component.cookiesPath()).toBe('/config/cookies.txt');
      expect(notify).toHaveBeenCalledWith('error', 'Failed to remove cookies file.');
    });
  });

  describe('updateYtdlp', () => {
    beforeEach(render);

    it('reports a new version', () => {
      http['updateYtdlp'].mockReturnValue(of({ ok: true, from: '2025.01.01', to: '2025.02.02', output: '' }));

      component.updateYtdlp();

      expect(component.ytdlpVersion()).toBe('2025.02.02');
      expect(component.isUpdating()).toBe(false);
      expect(notify).toHaveBeenCalledWith('success', 'yt-dlp updated: 2025.01.01 → 2025.02.02');
    });

    it('reports when already up to date', () => {
      http['updateYtdlp'].mockReturnValue(of({ ok: true, from: '2025.01.01', to: '2025.01.01', output: '' }));

      component.updateYtdlp();

      expect(notify).toHaveBeenCalledWith('success', 'yt-dlp is already up to date (2025.01.01).');
    });

    it('reports a failed update with a trimmed output and keeps the old version', () => {
      const output = 'x'.repeat(300);
      http['updateYtdlp'].mockReturnValue(of({ ok: false, from: '2025.01.01', to: null, output }));

      component.updateYtdlp();

      expect(component.ytdlpVersion()).toBe('2025.01.01');
      expect(notify).toHaveBeenCalledWith('error', `yt-dlp update failed: ${'x'.repeat(160)}`);
    });

    it('reports a failed request', () => {
      http['updateYtdlp'].mockReturnValue(throwError(() => new Error('500')));

      component.updateYtdlp();

      expect(component.isUpdating()).toBe(false);
      expect(component.ytdlpVersion()).toBeNull();
      expect(notify).toHaveBeenCalledWith('error', 'yt-dlp update failed: Update request failed');
    });

    it('marks itself as updating while the request runs', () => {
      http['updateYtdlp'].mockReturnValue(NEVER);

      component.updateYtdlp();

      expect(component.isUpdating()).toBe(true);
    });
  });

  describe('sendWebhook', () => {
    beforeEach(render);

    it('does nothing without a webhook URL', () => {
      component.form.controls.webhookUrl.setValue('');

      component.sendWebhook();

      expect(http['sendWebhook']).not.toHaveBeenCalled();
    });

    it('sends a test on success; the payload examples live in the Webhook step now', () => {
      http['sendWebhook'].mockReturnValue(of({ ok: true }));

      component.sendWebhook();

      expect(http['sendWebhook']).toHaveBeenCalledWith('https://ha.local/webhook');
      expect(notify).toHaveBeenCalledWith('success', 'Notify webhook sent successfully.', 'webhookOk');
      expect(showWebhookDemo).not.toHaveBeenCalled();
    });

    it('reports a rejected webhook', () => {
      http['sendWebhook'].mockReturnValue(of({ ok: false }));

      component.sendWebhook();

      expect(notify).toHaveBeenCalledWith('error', 'Failed to send webhook.');
      expect(showWebhookDemo).not.toHaveBeenCalled();
    });

    it('reports a failed request', () => {
      http['sendWebhook'].mockReturnValue(throwError(() => new Error('500')));

      component.sendWebhook();

      expect(notify).toHaveBeenCalledWith('error', 'Failed to send webhook.');
    });
  });

  describe('steps', () => {
    it('enables the POT step only when a provider is configured', async () => {
      await render();
      expect(component.steps()[1]).toEqual({ index: 5, enabled: false });

      component.potStatus.set(potStatus());
      expect(component.steps()[1]).toEqual({ index: 5, enabled: true });
    });

    it('follows the Telegram toggle for the Telegram step', async () => {
      await render();
      expect(component.steps()[0]).toEqual({ index: 2, enabled: false });

      component.form.controls.telegramEnabled.setValue(true);
      expect(component.steps()[0]).toEqual({ index: 2, enabled: true });
    });

    it('disables the headers of steps that are off', async () => {
      await render();

      const headers: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('mat-step-header'));
      expect(headers[2].getAttribute('aria-disabled')).toBe('true');
      expect(headers[5].getAttribute('aria-disabled')).toBe('true');
      expect(headers[0].getAttribute('aria-disabled')).toBeNull();
    });
  });

  describe('POT status', () => {
    it('shows a connected provider with its version', async () => {
      http['getPotStatus'].mockReturnValue(of(potStatus()));
      await render();

      expect(text()).toContain('connected (1.2.3)');
      expect(text()).toContain('http://pot:4416');
    });

    it('shows the error of an unreachable provider', async () => {
      http['getPotStatus'].mockReturnValue(of(potStatus({ ok: false, error: 'ECONNREFUSED' })));
      await render();

      expect(text()).toContain('ECONNREFUSED');
    });
  });

  it('flags the Telegram step as updated for two seconds', async () => {
    await render();
    vi.useFakeTimers();

    component.showUpdated();
    expect(component.isUpdated()).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(component.isUpdated()).toBe(false);
  });

  it('emits closeDialog from the close button', async () => {
    await render();
    const closed = vi.fn();
    component.closeDialog.subscribe(closed);

    (fixture.nativeElement.querySelector('mat-card-header button') as HTMLButtonElement).click();

    expect(closed).toHaveBeenCalled();
  });
});
