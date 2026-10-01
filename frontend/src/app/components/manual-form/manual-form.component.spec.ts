import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Params } from '@angular/router';
import { DefaultManualForm, DefaultUiConfig } from '@shared/constants';
import {
  AudioFormats,
  AudioQuality,
  Codecs,
  DownloadModel,
  HomeSection,
  ManualDownloadResult,
  Types,
  VideoFormats,
  VideoQuality,
} from '@shared/models';
import { HttpService, LayoutService, ScrollToService, StorageService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { NEVER, of, throwError } from 'rxjs';

import { ManualFormComponent } from './manual-form.component';
import { CODEC_ICONS, FORMAT_ICONS, QUALITY_ICONS, TYPE_ICONS } from './manual-form.constants';

const URL = 'https://youtube.com/watch?v=abc';

const result = (overrides: Partial<ManualDownloadResult> = {}): ManualDownloadResult => ({
  ok: true,
  kind: 'video',
  playlistId: null,
  playlistTitle: null,
  queued: 1,
  truncated: false,
  limit: 0,
  downloads: [{ id: 1 } as DownloadModel],
  ...overrides,
});

describe('ManualFormComponent', () => {
  let fixture: ComponentFixture<ManualFormComponent>;
  let component: ManualFormComponent;
  let storage: StorageService;
  let layout: LayoutService;
  let http: Record<string, ReturnType<typeof vi.fn>>;
  let notify: ReturnType<typeof vi.fn>;
  let scrollTo: ReturnType<typeof vi.fn>;
  let readText: ReturnType<typeof vi.fn>;
  let queryParams: Params;

  beforeEach(async () => {
    localStorage.removeItem('manualDownloadForm');

    http = {
      getFolders: vi.fn(() => of({ root: '/downloads', folders: [] })),
      createDownload: vi.fn(() => of(result())),
    };
    notify = vi.fn();
    scrollTo = vi.fn();
    readText = vi.fn(() => Promise.resolve(''));
    queryParams = {};

    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });

    await TestBed.configureTestingModule({
      imports: [ManualFormComponent],
      providers: [
        { provide: HttpService, useValue: http },
        { provide: NotifierService, useValue: { notify } },
        { provide: ScrollToService, useValue: { scrollTo } },
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams) } },
      ],
    }).compileComponents();

    // The select triggers use registered SVG icons; register blanks so they resolve.
    const sanitizer = TestBed.inject(DomSanitizer);
    const registry = TestBed.inject(MatIconRegistry);
    const svgIcons = new Set([
      ...Object.values(CODEC_ICONS),
      ...Object.values(FORMAT_ICONS),
      ...Object.values(QUALITY_ICONS),
      ...Object.values(TYPE_ICONS).map(({ svgIcon }) => svgIcon),
    ]);
    svgIcons.forEach(
      (name) => name && registry.addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml('<svg></svg>')),
    );

    storage = TestBed.inject(StorageService);
    layout = TestBed.inject(LayoutService);
    layout.sectionOrder.set([HomeSection.SUBSCRIPTIONS, HomeSection.DOWNLOADS]);
  });

  afterEach(() => localStorage.removeItem('manualDownloadForm'));

  async function render(params: Params = {}) {
    Object.assign(queryParams, params);
    fixture = TestBed.createComponent(ManualFormComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function refresh() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const text = (): string => el().textContent.replace(/\s+/g, ' ');
  const urlInput = (): HTMLInputElement => el().querySelector('input[formControlName="url"]')!;
  const icon = (name: string): HTMLElement | null => el().querySelector(`mat-icon[fonticon="${name}"]`);
  const autoPaste = (enabled = true) => storage.uiConfig.set({ ...DefaultUiConfig, autoPaste: enabled });

  describe('initial state', () => {
    it('starts with the default form and loads folders', async () => {
      await render();

      expect(component.form.getRawValue()).toEqual(DefaultManualForm);
      expect(component.formats()).toEqual(Object.values(VideoFormats));
      expect(component.qualities()).toEqual(Object.values(VideoQuality));
      expect(http['getFolders']).toHaveBeenCalledTimes(1);
    });

    it('restores the saved form', async () => {
      storage.manualDownloadForm.set({
        ...DefaultManualForm,
        type: Types.AUDIO,
        format: AudioFormats.FLAC,
        quality: AudioQuality.HQ,
      });
      await render();

      expect(component.form.getRawValue()).toMatchObject({
        type: Types.AUDIO,
        format: AudioFormats.FLAC,
        quality: AudioQuality.HQ,
      });
      expect(component.formats()).toEqual(Object.values(AudioFormats));
      expect(component.qualities()).toEqual(Object.values(AudioQuality));
    });

    it('shows the codec select for video only', async () => {
      await render();
      expect(text()).toContain('Codec');

      component.form.controls.type.setValue(Types.AUDIO);
      await refresh();

      expect(text()).not.toContain('Codec');
      expect(text()).toContain('Format');
    });
  });

  describe('url validation', () => {
    it('requires a url', async () => {
      await render();

      expect(component.form.controls.url.hasError('required')).toBe(true);
    });

    it('rejects a url without a scheme once edited', async () => {
      await render();

      component.form.controls.url.setValue('youtube.com/watch?v=abc');
      component.form.controls.url.markAsDirty();
      component.form.controls.url.markAsTouched();
      await refresh();

      expect(component.form.controls.url.hasError('invalidUrl')).toBe(true);
      expect(text()).toContain('URL must start with http:// or https://');
    });

    it('does not show the error before the url is edited or submitted', async () => {
      await render();

      component.form.controls.url.setValue('youtube.com');
      await refresh();

      expect(text()).not.toContain('URL must start with');
    });
  });

  describe('type switching', () => {
    it('switches to audio formats and qualities', async () => {
      await render();

      component.form.controls.type.setValue(Types.AUDIO);

      expect(component.formats()).toEqual(Object.values(AudioFormats));
      expect(component.qualities()).toEqual(Object.values(AudioQuality));
    });

    it('keeps values that exist in both lists', async () => {
      await render();

      component.form.controls.type.setValue(Types.AUDIO);

      expect(component.form.controls.format.value).toBe(VideoFormats.AUTO);
      expect(component.form.controls.quality.value).toBe(VideoQuality.BEST);
    });

    it('resets values the new type cannot express', async () => {
      await render();
      component.form.patchValue({ format: VideoFormats.MKV, quality: VideoQuality.FHD });

      component.form.controls.type.setValue(Types.AUDIO);

      expect(component.form.controls.format.value).toBe(AudioFormats.AUTO);
      expect(component.form.controls.quality.value).toBe(AudioQuality.BEST);
    });

    it('disables clip and post-processing options for thumbnails', async () => {
      await render();
      const { clipStart, clipEnd, removeSponsor, splitChapters } = component.form.controls;

      component.form.controls.type.setValue(Types.THUMBNAIL);

      [clipStart, clipEnd, removeSponsor, splitChapters].forEach((c) => expect(c.disabled).toBe(true));

      component.form.controls.type.setValue(Types.VIDEO);

      [clipStart, clipEnd, removeSponsor, splitChapters].forEach((c) => expect(c.enabled).toBe(true));
    });

    it('leaves format and quality lists alone for thumbnails', async () => {
      await render();
      component.form.controls.type.setValue(Types.AUDIO);

      component.form.controls.type.setValue(Types.THUMBNAIL);
      await refresh();

      expect(component.formats()).toEqual(Object.values(AudioFormats));
      expect(text()).toContain('Thumbnail');
      expect(text()).not.toContain('Quality');
    });
  });

  describe('remembering choices', () => {
    it('saves type, format, quality and codec', async () => {
      await render();

      component.form.patchValue({ format: VideoFormats.MP4, codec: Codecs.AV1, quality: VideoQuality.FHD });

      expect(storage.manualDownloadForm()).toEqual({
        ...DefaultManualForm,
        format: VideoFormats.MP4,
        codec: Codecs.AV1,
        quality: VideoQuality.FHD,
      });
    });

    it('does not save the url or advanced options', async () => {
      await render();

      component.form.patchValue({ url: URL, prefix: 'pre', destinationFolder: 'music', removeSponsor: true });

      expect(storage.manualDownloadForm()).toEqual(DefaultManualForm);
    });
  });

  describe('downloading', () => {
    async function renderWithUrl(url = URL) {
      await render();
      component.form.controls.url.setValue(url);
    }

    it('sends the request built from the form', async () => {
      await renderWithUrl();
      component.form.patchValue({
        type: Types.AUDIO,
        format: AudioFormats.MP3,
        quality: AudioQuality.HQ,
        prefix: 'Channel - ',
        destinationFolder: ' podcasts ',
        ytdlpArgs: '  ',
        clipStart: '00:01:00',
        clipEnd: '',
        removeSponsor: true,
      });

      component.download();

      expect(http['createDownload']).toHaveBeenCalledWith({
        url: URL,
        type: Types.AUDIO,
        format: AudioFormats.MP3,
        codec: Codecs.AUTO,
        quality: AudioQuality.HQ,
        folder: 'podcasts',
        prefix: 'Channel - ',
        ytdlpArgs: null,
        clipStart: '00:01:00',
        clipEnd: null,
        removeSponsor: true,
        splitChapters: false,
      });
    });

    it('sends null for an empty prefix', async () => {
      await renderWithUrl();

      component.download();

      expect(http['createDownload']).toHaveBeenCalledWith(expect.objectContaining({ prefix: null, folder: null }));
    });

    it('stores the queued downloads and resets the url', async () => {
      const downloads = [{ id: 7 } as DownloadModel];
      http['createDownload'].mockReturnValue(of(result({ downloads })));
      await renderWithUrl();

      component.download();

      expect(storage.downloads()).toEqual(downloads);
      expect(component.form.controls.url.value).toBe('');
      expect(component.form.controls.url.enabled).toBe(true);
      expect(component.isPending()).toBe(false);
      expect(component.isSubmitted()).toBe(false);
    });

    it('keeps the other options after a download', async () => {
      await renderWithUrl();
      component.form.patchValue({ prefix: 'pre', format: VideoFormats.MKV });

      component.download();

      expect(component.form.controls.prefix.value).toBe('pre');
      expect(component.form.controls.format.value).toBe(VideoFormats.MKV);
    });

    it('scrolls to downloads when they are not the first section', async () => {
      await renderWithUrl();

      component.download();

      expect(scrollTo).toHaveBeenCalledWith('downloads');
    });

    it('does not scroll when downloads are already first', async () => {
      layout.sectionOrder.set([HomeSection.DOWNLOADS, HomeSection.SUBSCRIPTIONS]);
      await renderWithUrl();

      component.download();

      expect(scrollTo).not.toHaveBeenCalled();
    });

    it.each([
      [result(), 'Download queued'],
      [result({ kind: 'playlist', queued: 1 }), 'Queued 1 video from this playlist'],
      [result({ kind: 'channel', queued: 12 }), 'Queued 12 videos from this channel'],
      [
        result({ kind: 'playlist', queued: 50, truncated: true, limit: 50 }),
        'Queued 50 videos from this playlist (capped at 50)',
      ],
    ])('reports %#', async (response, message) => {
      http['createDownload'].mockReturnValue(of(response));
      await renderWithUrl();

      component.download();

      expect(notify).toHaveBeenCalledWith('success', message);
    });

    it('reports the server error and keeps the url', async () => {
      http['createDownload'].mockReturnValue(throwError(() => ({ error: { error: 'Unsupported URL' } })));
      await renderWithUrl();

      component.download();

      expect(notify).toHaveBeenCalledWith('error', 'Unsupported URL');
      expect(component.form.controls.url.value).toBe(URL);
      expect(component.form.controls.url.enabled).toBe(true);
      expect(component.isPending()).toBe(false);
    });

    it('falls back to a generic error message', async () => {
      http['createDownload'].mockReturnValue(throwError(() => new Error('500')));
      await renderWithUrl();

      component.download();

      expect(notify).toHaveBeenCalledWith('error', 'The server rejected the request');
    });

    it('locks the url and ignores repeat submits while pending', async () => {
      http['createDownload'].mockReturnValue(NEVER);
      await renderWithUrl();

      component.download();
      component.download();
      await refresh();

      expect(http['createDownload']).toHaveBeenCalledTimes(1);
      expect(component.isPending()).toBe(true);
      expect(component.form.controls.url.disabled).toBe(true);
      expect(icon('radar')).not.toBeNull();
    });

    it('does not send an invalid url', async () => {
      await renderWithUrl('youtube.com');

      component.download();
      await refresh();

      expect(http['createDownload']).not.toHaveBeenCalled();
      expect(component.isSubmitted()).toBe(true);
      expect(component.form.touched).toBe(true);
      expect(component.form.controls.url.enabled).toBe(true);
      expect(text()).toContain('URL must start with http:// or https://');
    });

    it('does not send an empty url', async () => {
      await render();

      component.download();
      await refresh();

      expect(http['createDownload']).not.toHaveBeenCalled();
      expect(component.form.controls.url.enabled).toBe(true);
      expect(text()).toContain('A video, playlist or channel URL is required');
    });

    it('starts from the download icon', async () => {
      await renderWithUrl();
      await refresh();

      icon('download')!.click();

      expect(http['createDownload']).toHaveBeenCalledTimes(1);
    });

    it('starts on enter in the url input', async () => {
      await renderWithUrl();
      await refresh();

      urlInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(http['createDownload']).toHaveBeenCalledTimes(1);
    });
  });

  describe('auto paste', () => {
    it('downloads the clipboard url when submitted empty', async () => {
      autoPaste();
      await render();
      readText.mockResolvedValue(URL);

      component.download();
      await fixture.whenStable();

      expect(readText).toHaveBeenCalled();
      expect(http['createDownload']).toHaveBeenCalledTimes(1);
      expect(http['createDownload']).toHaveBeenCalledWith(expect.objectContaining({ url: URL }));
    });

    it('reads the clipboard only once when it holds nothing', async () => {
      autoPaste();
      await render();
      readText.mockClear();
      readText.mockResolvedValue('');

      component.download();
      await fixture.whenStable();

      expect(readText).toHaveBeenCalledTimes(1);
      expect(http['createDownload']).not.toHaveBeenCalled();
      expect(component.form.controls.url.enabled).toBe(true);
    });

    it('unlocks the url when the clipboard is denied on submit', async () => {
      autoPaste();
      await render();
      readText.mockRejectedValue(new Error('denied'));

      component.download();
      await fixture.whenStable();

      expect(http['createDownload']).not.toHaveBeenCalled();
      expect(component.form.controls.url.enabled).toBe(true);
    });

    it('does not read the clipboard when disabled', async () => {
      await render();

      component.download();
      component.pasteUrl();

      expect(readText).not.toHaveBeenCalled();
    });

    it('pastes a valid clipboard url into an empty input', async () => {
      await render();
      autoPaste();
      readText.mockResolvedValue(URL);

      component.pasteUrl();
      await fixture.whenStable();

      expect(component.form.controls.url.value).toBe(URL);
    });

    it('ignores clipboard text that is not a url', async () => {
      await render();
      autoPaste();
      readText.mockResolvedValue('just some text');

      component.pasteUrl();
      await fixture.whenStable();

      expect(component.form.controls.url.value).toBe('');
    });

    it('does not overwrite a typed url', async () => {
      await render();
      autoPaste();
      urlInput().value = 'https://other.com';

      component.pasteUrl();

      expect(readText).not.toHaveBeenCalled();
    });

    it('survives a denied clipboard', async () => {
      await render();
      autoPaste();
      readText.mockRejectedValue(new Error('denied'));

      component.pasteUrl();
      await fixture.whenStable();

      expect(component.form.controls.url.value).toBe('');
    });

    it('focuses the url input', async () => {
      autoPaste();
      await render();

      expect(document.activeElement).toBe(urlInput());
    });
  });

  describe('clearing the url', () => {
    it('clears the url and its validation state', async () => {
      await render();
      component.isSubmitted.set(true);
      component.form.controls.url.setValue('youtube.com');
      component.form.markAllAsTouched();
      component.form.markAsDirty();
      component.form.controls.url.disable();

      component.clearUrl();

      expect(component.form.controls.url.value).toBe('');
      expect(component.form.controls.url.enabled).toBe(true);
      expect(component.form.pristine).toBe(true);
      expect(component.form.untouched).toBe(true);
      expect(component.isSubmitted()).toBe(false);
    });

    it('shows the clear button only with a url', async () => {
      await render();
      expect(icon('close')).toBeNull();

      component.form.controls.url.setValue(URL);
      await refresh();
      icon('close')!.click();
      await refresh();

      expect(component.form.controls.url.value).toBe('');
      expect(icon('close')).toBeNull();
    });
  });

  describe('query params', () => {
    it('fills the form from a link with a valid url', async () => {
      await render({
        url: URL,
        type: Types.AUDIO,
        format: AudioFormats.MP3,
        quality: AudioQuality.LQ,
        prefix: 'pre',
        destinationFolder: 'music',
      });

      expect(component.form.getRawValue()).toMatchObject({
        url: URL,
        type: Types.AUDIO,
        format: AudioFormats.MP3,
        quality: AudioQuality.LQ,
        prefix: 'pre',
        destinationFolder: 'music',
      });
      expect(http['createDownload']).not.toHaveBeenCalled();
    });

    it('keeps the current values for params the link leaves out', async () => {
      storage.manualDownloadForm.set({ ...DefaultManualForm, format: VideoFormats.MKV, codec: Codecs.AV1 });
      await render({ url: URL });

      expect(component.form.getRawValue()).toEqual({
        ...DefaultManualForm,
        url: URL,
        format: VideoFormats.MKV,
        codec: Codecs.AV1,
      });
    });

    it.each([
      ['true', true],
      ['false', false],
    ])('reads removeSponsor=%s as a boolean', async (param, expected) => {
      await render({ url: URL, removeSponsor: param });

      expect(component.form.controls.removeSponsor.value).toBe(expected);
    });

    it('ignores a link with an invalid url', async () => {
      await render({ url: 'youtube.com', type: Types.AUDIO });

      expect(component.form.getRawValue()).toEqual(DefaultManualForm);
    });

    it('downloads right away when asked to', async () => {
      await render({ url: URL, download: 'true' });

      expect(http['createDownload']).toHaveBeenCalledWith(expect.objectContaining({ url: URL }));
    });
  });
});
