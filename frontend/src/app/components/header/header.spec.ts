import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { AppVersion } from '@shared/components';
import { HttpService, StorageService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { of, Subject, throwError } from 'rxjs';

import { AppSettingsDialog } from '../../shared/components/app-settings-dialog/app-settings-dialog';
import { ThemeDialog } from '../../shared/components/theme-dialog/theme-dialog';
import { Header } from './header';

@Component({ selector: 'rt-app-version', template: '' })
class AppVersionStub {}

describe('Header', () => {
  let fixture: ComponentFixture<Header>;
  let component: Header;
  let storage: StorageService;
  let http: Record<string, ReturnType<typeof vi.fn>>;
  let notify: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    http = {
      getYtdlpVersion: vi.fn(() => of({ version: '2025.10.22', available: true })),
      toggleEnabled: vi.fn(() => of({ enabled: false })),
    };
    notify = vi.fn();
    dialogOpen = vi.fn();

    await TestBed.configureTestingModule({
      imports: [Header],
      providers: [
        { provide: HttpService, useValue: http },
        { provide: NotifierService, useValue: { notify } },
        { provide: MatDialog, useValue: { open: dialogOpen } },
      ],
    })
      // AppVersion has its own HTTP/dialog dependencies and its own spec.
      .overrideComponent(Header, {
        remove: { imports: [AppVersion] },
        add: { imports: [AppVersionStub] },
      })
      .compileComponents();

    const sanitizer = TestBed.inject(DomSanitizer);
    TestBed.inject(MatIconRegistry).addSvgIconLiteral('retriever', sanitizer.bypassSecurityTrustHtml('<svg></svg>'));

    storage = TestBed.inject(StorageService);
  });

  async function render() {
    fixture = TestBed.createComponent(Header);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function refresh() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const text = (): string => el().textContent.replace(/\s+/g, ' ');
  const buttonByText = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent.includes(label));

  describe('rendering', () => {
    it('renders the title, app version and action buttons', async () => {
      await render();

      expect(text()).toContain('Retriever');
      expect(el().querySelector('rt-app-version')).not.toBeNull();
      expect(buttonByText('Theme config')).toBeDefined();
      expect(buttonByText('App settings')).toBeDefined();
    });
  });

  describe('yt-dlp version', () => {
    it('loads and displays the yt-dlp version on init', async () => {
      await render();

      expect(http['getYtdlpVersion']).toHaveBeenCalledTimes(1);
      expect(component.ytdlpVersion()).toBe('2025.10.22');
      expect(text()).toContain('2025.10.22');
    });

    it('falls back to null when the request fails', async () => {
      http['getYtdlpVersion'].mockReturnValue(throwError(() => new Error('boom')));
      await render();

      expect(component.ytdlpVersion()).toBeNull();
      expect(text()).not.toContain('2025.10.22');
    });

    it('stays null until the version arrives', async () => {
      const version$ = new Subject<{ version: string | null; available: boolean }>();
      http['getYtdlpVersion'].mockReturnValue(version$);
      await render();

      expect(component.ytdlpVersion()).toBeNull();

      version$.next({ version: '2024.01.01', available: true });
      await refresh();

      expect(component.ytdlpVersion()).toBe('2024.01.01');
      expect(text()).toContain('2024.01.01');
    });
  });

  describe('isEnabled', () => {
    it('reflects the enabled flag from settings', async () => {
      await render();

      storage.settings.set({ ...storage.settings(), enabled: true });
      expect(component.isEnabled()).toBe(true);

      storage.settings.set({ ...storage.settings(), enabled: false });
      expect(component.isEnabled()).toBe(false);
    });

    it('defaults to false when the flag is missing', async () => {
      await render();

      storage.settings.set({ ...storage.settings(), enabled: undefined as unknown as boolean });
      expect(component.isEnabled()).toBe(false);
    });
  });

  describe('togglePause', () => {
    it('pauses the app and notifies with info', async () => {
      storage.settings.set({ ...storage.settings(), enabled: true });
      await render();

      component.togglePause();

      expect(http['toggleEnabled']).toHaveBeenCalledTimes(1);
      expect(storage.settings().enabled).toBe(false);
      expect(component.isEnabled()).toBe(false);
      expect(notify).toHaveBeenCalledWith('info', 'App is now paused');
    });

    it('resumes the app and notifies with success', async () => {
      storage.settings.set({ ...storage.settings(), enabled: false });
      http['toggleEnabled'].mockReturnValue(of({ enabled: true }));
      await render();

      component.togglePause();

      expect(storage.settings().enabled).toBe(true);
      expect(notify).toHaveBeenCalledWith('success', 'App is now running');
    });

    it('preserves other settings when updating the enabled flag', async () => {
      await render();
      const before = storage.settings();

      component.togglePause();

      expect(storage.settings()).toEqual({ ...before, enabled: false });
    });

    it('treats an empty response as paused', async () => {
      storage.settings.set({ ...storage.settings(), enabled: true });
      http['toggleEnabled'].mockReturnValue(of(null));
      await render();

      component.togglePause();

      expect(storage.settings().enabled).toBe(false);
      expect(notify).toHaveBeenCalledWith('info', 'App is now paused');
    });

    it('notifies an error and leaves settings untouched on failure', async () => {
      storage.settings.set({ ...storage.settings(), enabled: true });
      http['toggleEnabled'].mockReturnValue(throwError(() => new Error('boom')));
      await render();
      const before = storage.settings();

      component.togglePause();

      expect(storage.settings()).toBe(before);
      expect(notify).toHaveBeenCalledWith('error', 'Failed to toggle pause. Please try again.');
    });
  });

  describe('dialogs', () => {
    it('opens the theme dialog from the "Theme config" button', async () => {
      await render();
      const spy = vi.spyOn(component, 'openThemeDialog');

      buttonByText('Theme config')!.click();

      expect(spy).toHaveBeenCalled();
      await spy.mock.results[0].value;
      expect(dialogOpen).toHaveBeenCalledWith(ThemeDialog, { maxWidth: '500px' });
    });

    it('opens the app settings dialog from the "App settings" button', async () => {
      await render();
      const spy = vi.spyOn(component, 'openNewSettingsDialog');

      buttonByText('App settings')!.click();

      expect(spy).toHaveBeenCalled();
      await spy.mock.results[0].value;
      expect(dialogOpen).toHaveBeenCalledWith(AppSettingsDialog, { maxWidth: '800px', minWidth: '500px' });
    });
  });
});
