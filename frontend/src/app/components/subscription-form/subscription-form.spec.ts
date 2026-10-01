import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { DefaultSettings, DefaultSubscription, MockSubscription } from '@shared/constants';
import { AudioFormats, Codecs, PollType, SubscriptionModel, Types, VideoFormats } from '@shared/models';
import { HttpService, StorageService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { firstValueFrom, NEVER, of, throwError } from 'rxjs';

import { SubscriptionForm } from './subscription-form';

const subscription = (overrides: Partial<SubscriptionModel> = {}): SubscriptionModel => ({
  ...MockSubscription,
  ...overrides,
});

describe('SubscriptionForm', () => {
  let fixture: ComponentFixture<SubscriptionForm>;
  let component: SubscriptionForm;
  let storage: StorageService;
  let http: Record<string, ReturnType<typeof vi.fn>>;
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    http = {
      getFolders: vi.fn(() => of({ root: '/downloads', folders: [] })),
      addSubscription: vi.fn((sub: SubscriptionModel) => of({ ...sub, id: 99 })),
      updateSubscription: vi.fn((sub: SubscriptionModel) => of(sub)),
      sendWebhook: vi.fn(() => of({ ok: true })),
    };
    notify = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SubscriptionForm],
      providers: [
        { provide: HttpService, useValue: http },
        { provide: NotifierService, useValue: { notify } },
      ],
    }).compileComponents();

    // The option templates use registered SVG icons; register blanks so they resolve.
    const sanitizer = TestBed.inject(DomSanitizer);
    ['telegram', 'avc'].forEach((name) =>
      TestBed.inject(MatIconRegistry).addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml('<svg></svg>')),
    );

    storage = TestBed.inject(StorageService);
    storage.showForm.set(true);
  });

  async function render() {
    fixture = TestBed.createComponent(SubscriptionForm);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function renderEditing(sub = subscription()) {
    storage.subscriptions.set([sub]);
    storage.editingSubscription.set(sub);
    await render();
  }

  async function refresh() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const text = (): string => el().textContent.replace(/\s+/g, ' ');
  const buttonByText = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent.trim() === label);
  const submitButton = (): HTMLButtonElement => el().querySelector('button[type="submit"]')!;
  const icon = (name: string): HTMLElement | null => el().querySelector(`mat-icon[fonticon="${name}"]`);

  describe('adding a subscription', () => {
    it('renders the add form with defaults and loads folders', async () => {
      await render();

      expect(component.isEditing()).toBe(false);
      expect(text()).toContain('Add subscription');
      expect(buttonByText('Subscribe')).toBeDefined();
      expect(buttonByText('Reset')).toBeDefined();
      expect(http['getFolders']).toHaveBeenCalledTimes(1);
      expect(component.form.getRawValue()).toMatchObject({
        rssUrl: '',
        type: Types.VIDEO,
        format: VideoFormats.AUTO,
        codec: Codecs.AUTO,
        pollType: PollType.INTERVAL,
        startFromLast: false,
      });
    });

    it('disables submit until the form is valid', async () => {
      await render();
      expect(submitButton().disabled).toBe(true);

      component.form.patchValue({ rssUrl: 'https://youtube.com/@channel', pollInterval: 60 });
      await refresh();

      expect(component.form.valid).toBe(true);
      expect(submitButton().disabled).toBe(false);
    });

    it.each([
      ['', 'URL is required'],
      ['youtube.com/@channel', 'Invalid URL'],
    ])('shows an error for the url %j once touched', async (value, message) => {
      await render();

      component.form.controls.rssUrl.setValue(value);
      component.form.controls.rssUrl.markAsTouched();
      await refresh();

      expect(text()).toContain(message);
    });

    it('shows the hints only while adding', async () => {
      await render();

      expect(text()).toContain('Just paste channel URL');
      expect(text()).toContain('Leave empty to use real channel name');
      expect(icon('link')).toBeNull();
    });

    it('offers every flag, including "Start with"', async () => {
      await render();

      expect(component.flags().map((f) => f.value)).toContain('startFromLast');
    });
  });

  describe('editing a subscription', () => {
    it('fills the form from the edited subscription', async () => {
      await renderEditing();

      expect(component.isEditing()).toBe(true);
      expect(text()).toContain('Edit subscription');
      expect(buttonByText('Update')).toBeDefined();
      expect(buttonByText('Cancel')).toBeDefined();
      expect(component.form.getRawValue()).toMatchObject({
        id: 1,
        name: 'Favorite Channel',
        rssUrl: 'https://youtube.com/rss/url/test',
        pollInterval: 30,
        pollTime: [],
        tag: 'youtube',
      });
    });

    it('hides the add hints and offers to copy the url', async () => {
      await renderEditing();

      expect(text()).not.toContain('Just paste channel URL');
      expect(icon('link')).not.toBeNull();
    });

    it('keeps submit disabled until something changes', async () => {
      await renderEditing();
      expect(component.form.errors).toEqual({ unchanged: true });
      expect(submitButton().disabled).toBe(true);

      component.form.controls.name.setValue('Renamed');
      await refresh();

      expect(submitButton().disabled).toBe(false);
    });

    it('does not offer "Start with"', async () => {
      await renderEditing();

      expect(component.flags().map((f) => f.value)).not.toContain('startFromLast');
    });

    it('closes when the edited subscription is not in the list', async () => {
      storage.subscriptions.set([]);
      storage.editingSubscription.set(subscription());
      await render();

      expect(storage.showForm()).toBe(false);
    });

    it('resets to defaults when editing ends', async () => {
      await renderEditing();

      storage.editingSubscription.set(null);
      await refresh();

      expect(component.isEditing()).toBe(false);
      expect(component.form.errors).toBeNull();
      expect(component.form.getRawValue()).toMatchObject({ id: null, name: null, rssUrl: '', tag: '' });
    });
  });

  describe('type and format', () => {
    it('switches to audio formats and disables the codec', async () => {
      await render();

      component.form.controls.type.setValue(Types.AUDIO);
      await refresh();

      expect(component.form.controls.format.value).toBe(AudioFormats.MP3);
      expect(component.form.controls.codec.value).toBeNull();
      expect(component.form.controls.codec.disabled).toBe(true);
      expect(await firstValueFrom(component.formatOptions$)).toEqual(Object.values(AudioFormats));
      expect(text()).not.toContain('Codec');
    });

    it('restores video defaults when switching back to video', async () => {
      await render();
      component.form.controls.type.setValue(Types.AUDIO);

      component.form.controls.type.setValue(Types.VIDEO);
      await refresh();

      expect(component.form.controls.format.value).toBe(VideoFormats.AUTO);
      expect(component.form.controls.codec.value).toBe(Codecs.AUTO);
      expect(component.form.controls.codec.enabled).toBe(true);
      expect(await firstValueFrom(component.formatOptions$)).toEqual(Object.values(VideoFormats));
      expect(text()).toContain('Codec');
    });
  });

  describe('polling', () => {
    it('requires an interval between 1 and 1440 minutes', async () => {
      await render();
      const interval = component.form.controls.pollInterval;

      expect(interval.hasError('required')).toBe(true);

      interval.setValue(0);
      expect(interval.hasError('min')).toBe(true);

      interval.setValue(1441);
      interval.markAsTouched();
      expect(interval.hasError('max')).toBe(true);
      await refresh();
      expect(text()).toContain('Interval must be between 1 and 1440 minutes');

      interval.setValue(60);
      expect(interval.valid).toBe(true);
    });

    it('requires poll times instead of an interval for the time poll type', async () => {
      await render();

      component.form.controls.pollType.setValue(PollType.TIME);
      await refresh();

      expect(component.form.controls.pollInterval.valid).toBe(true);
      expect(component.form.controls.pollTime.hasError('required')).toBe(true);
      expect(text()).toContain('Poll time');
      expect(text()).not.toContain('Check interval');

      component.form.controls.pollTime.setValue(['08:00']);
      expect(component.form.controls.pollTime.valid).toBe(true);
    });

    it('goes back to requiring an interval', async () => {
      await render();
      component.form.controls.pollType.setValue(PollType.TIME);

      component.form.controls.pollType.setValue(PollType.INTERVAL);

      expect(component.form.controls.pollInterval.hasError('required')).toBe(true);
      expect(component.form.controls.pollTime.valid).toBe(true);
    });

    it('labels poll times with the saved time zone', async () => {
      storage.settings.set({ ...DefaultSettings, timeZone: 'Europe/Berlin' });
      await render();

      component.form.controls.pollType.setValue(PollType.TIME);
      await refresh();

      expect(text()).toContain('Times in Europe/Berlin');
    });

    it('falls back to server time without a saved time zone', async () => {
      await render();

      expect(component.timeZoneLabel()).toBe('server time');
    });
  });

  describe('flags', () => {
    it('reflects the boolean controls as selected options', async () => {
      await render();

      component.form.patchValue({ downloadShorts: true, removeSponsors: true });
      await refresh();

      expect(component.selectedOptions()).toEqual(['downloadShorts', 'removeSponsors']);
    });

    it('writes the selection back to the controls', async () => {
      await render();
      component.form.patchValue({ downloadShorts: true });

      component.onOptionChange({ value: ['splitChapters', 'notifyTelegram'] } as never);

      expect(component.form.getRawValue()).toMatchObject({
        downloadShorts: false,
        splitChapters: true,
        removeSponsors: false,
        notifyHA: false,
        notifyTelegram: true,
        pollOnce: false,
        startFromLast: false,
      });
      expect(component.selectedOptions()).toEqual(['splitChapters', 'notifyTelegram']);
    });

    it('leaves "Start with" alone while editing', async () => {
      await renderEditing(subscription({ startFromLast: true }));

      component.onOptionChange({ value: ['downloadShorts'] } as never);

      expect(component.form.controls.startFromLast.value).toBe(true);
    });
  });

  describe('webhook override', () => {
    const webhook = () => component.form.controls.webhookOverride;

    it('is disabled until webhooks are turned on', async () => {
      await render();
      expect(webhook().disabled).toBe(true);

      component.form.controls.notifyHA.setValue(true);
      expect(webhook().enabled).toBe(true);

      component.form.controls.notifyHA.setValue(false);
      expect(webhook().disabled).toBe(true);
    });

    it('is required and validated without a global webhook', async () => {
      await render();

      component.form.controls.notifyHA.setValue(true);
      expect(webhook().hasError('required')).toBe(true);

      webhook().setValue('homeassistant/webhook');
      expect(webhook().hasError('invalidUrl')).toBe(true);

      webhook().setValue('http://homeassistant/webhook');
      expect(webhook().valid).toBe(true);
    });

    it('is optional when a global webhook is set', async () => {
      storage.settings.set({ ...DefaultSettings, webhookUrl: 'http://global/webhook' });
      await render();

      component.form.controls.notifyHA.setValue(true);
      await refresh();

      expect(webhook().enabled).toBe(true);
      expect(webhook().valid).toBe(true);
    });

    it('becomes required when the global webhook is removed', async () => {
      storage.settings.set({ ...DefaultSettings, webhookUrl: 'http://global/webhook' });
      await render();
      component.form.controls.notifyHA.setValue(true);
      await refresh();

      storage.settings.set({ ...DefaultSettings, webhookUrl: null });
      await refresh();

      expect(webhook().hasError('required')).toBe(true);
    });
  });

  describe('sending a test webhook', () => {
    async function withWebhook(url = 'http://homeassistant/webhook') {
      await render();
      component.form.controls.notifyHA.setValue(true);
      component.form.controls.webhookOverride.setValue(url);
    }

    it('does nothing without a url', async () => {
      await render();

      component.sendWebhook();

      expect(http['sendWebhook']).not.toHaveBeenCalled();
    });

    it('reports success', async () => {
      await withWebhook();

      component.sendWebhook();

      expect(http['sendWebhook']).toHaveBeenCalledWith('http://homeassistant/webhook');
      expect(notify).toHaveBeenCalledWith('success', 'Webhook sent successfully.');
    });

    it('reports a webhook the server could not deliver', async () => {
      await withWebhook();
      http['sendWebhook'].mockReturnValue(of({ ok: false }));

      component.sendWebhook();

      expect(notify).toHaveBeenCalledWith('error', 'Failed to send webhook.');
    });

    it('reports a failed request', async () => {
      await withWebhook();
      http['sendWebhook'].mockReturnValue(throwError(() => new Error('500')));

      component.sendWebhook();

      expect(notify).toHaveBeenCalledWith('error', 'Failed to send webhook.');
    });

    it('sends when the webhook icon is clicked with a valid url', async () => {
      await withWebhook();
      await refresh();

      icon('webhook')!.click();

      expect(http['sendWebhook']).toHaveBeenCalledTimes(1);
    });
  });

  describe('saving', () => {
    async function fillValidForm() {
      await render();
      component.form.patchValue({ rssUrl: 'https://youtube.com/@channel', pollInterval: 60 });
      await refresh();
    }

    it('adds a new subscription and closes the form', async () => {
      await fillValidForm();
      const existing = subscription({ id: 5 });
      storage.subscriptions.set([existing]);

      submitButton().click();
      await refresh();

      expect(http['addSubscription']).toHaveBeenCalledWith(
        expect.objectContaining({ rssUrl: 'https://youtube.com/@channel', pollInterval: 60 }),
      );
      expect(http['updateSubscription']).not.toHaveBeenCalled();
      expect(storage.subscriptions().map((s) => s.id)).toEqual([5, 99]);
      expect(storage.showForm()).toBe(false);
      expect(notify).toHaveBeenCalledWith('success', 'Subscription saved successfully');
    });

    it('skips the success message when the latest video is downloaded right away', async () => {
      await fillValidForm();
      component.form.patchValue({ startFromLast: true });

      component.save(component.form.value);

      expect(http['addSubscription']).toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('resets the form after adding', async () => {
      await fillValidForm();

      component.save(component.form.value);
      await refresh();

      expect(component.form.controls.rssUrl.value).toBe('');
      expect(component.form.controls.pollInterval.value).toBeNull();
    });

    it('updates an edited subscription in place', async () => {
      const other = subscription({ id: 2, name: 'Other' });
      const edited = subscription();
      storage.subscriptions.set([edited, other]);
      storage.editingSubscription.set(edited);
      await render();

      component.form.controls.name.setValue('Renamed');
      component.save(component.form.value);

      expect(http['updateSubscription']).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: 'Renamed' }));
      expect(http['addSubscription']).not.toHaveBeenCalled();
      expect(storage.subscriptions().map((s) => s.name)).toEqual(['Renamed', 'Other']);
      expect(storage.subscriptions()[1]).toBe(other);
      expect(storage.showForm()).toBe(false);
    });

    it('disables the buttons while saving', async () => {
      await fillValidForm();
      http['addSubscription'].mockReturnValue(NEVER);

      component.save(component.form.value);
      await refresh();

      expect(component.isSaving()).toBe(true);
      expect(submitButton().disabled).toBe(true);
      expect(buttonByText('Reset')!.disabled).toBe(true);
    });

    it('reports a failure and keeps the form', async () => {
      await fillValidForm();
      http['addSubscription'].mockReturnValue(throwError(() => new Error('500')));

      component.save(component.form.value);

      expect(component.isSaving()).toBe(false);
      expect(notify).toHaveBeenCalledWith('error', 'Something went wrong');
      expect(storage.showForm()).toBe(true);
      expect(component.form.controls.rssUrl.value).toBe('https://youtube.com/@channel');
    });
  });

  describe('reset and close', () => {
    it('resets the add form to defaults', async () => {
      await render();
      component.form.patchValue({ rssUrl: 'https://youtube.com/@channel', name: 'Name', downloadShorts: true });

      buttonByText('Reset')!.click();
      await refresh();

      expect(component.form.getRawValue()).toMatchObject({
        rssUrl: DefaultSubscription.rssUrl,
        name: null,
        downloadShorts: false,
      });
      expect(storage.showForm()).toBe(true);
    });

    it('closes the form instead of resetting while editing', async () => {
      await renderEditing();

      buttonByText('Cancel')!.click();

      expect(storage.showForm()).toBe(false);
      expect(storage.editingSubscription()).not.toBeNull();
    });

    it('closes from the header icon', async () => {
      await render();

      icon('close')!.click();

      expect(storage.showForm()).toBe(false);
    });
  });

  it('copies the url to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderEditing();

    icon('link')!.click();

    expect(writeText).toHaveBeenCalledWith('https://youtube.com/rss/url/test');
    expect(notify).toHaveBeenCalledWith('success', 'Copied to clipboard');
  });
});
