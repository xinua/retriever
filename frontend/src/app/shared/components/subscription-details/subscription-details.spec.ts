import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { inject, provideAppInitializer } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { NotifierService } from 'angular-notifier';

import { SubscriptionDetails } from './subscription-details';
import { DefaultSettings, DefaultSubscription, DRAG_TOKEN } from '@shared/constants';
import { of } from 'rxjs';
import { AudioFormats, PollType, SubscriptionModel, Types, VideoFormats } from '@shared/models';
import { HttpService, StorageService } from '@shared/services';
import { provideNotifier, useIconFactory } from '../../providers';
import { HA_AUTOMATION_CODE, WIDGET_CODE } from '../../../components/widget-page/widget.constants';

describe('SubscriptionDetails', () => {
  let component: SubscriptionDetails;
  let fixture: ComponentFixture<SubscriptionDetails>;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubscriptionDetails],
      // The embedded player looks up the last download; these tests leave that request unanswered.
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNotifier(),
        { provide: DRAG_TOKEN, useValue: of(false) },
        // Registers the app's SVG icons (audio_note, avc) the template uses.
        provideAppInitializer(() => {
          const initializerFn = useIconFactory(inject(DomSanitizer), inject(MatIconRegistry));
          return initializerFn();
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SubscriptionDetails);
    component = fixture.componentInstance;

    writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(overrides: Partial<SubscriptionModel> = {}) {
    fixture.componentRef.setInput('sub', { ...DefaultSubscription, id: 1, name: 'Channel', ...overrides });
    await fixture.whenStable();
  }

  /** The value next to a "Label:" in the details column. */
  function field(label: string): string {
    const rows: HTMLElement[] = [...fixture.nativeElement.querySelectorAll('.grid-cols-2')];
    const row = rows.find((el) => el.firstElementChild?.textContent.trim() === label);
    return row?.lastElementChild.textContent.replace(/\s+/g, ' ').trim();
  }

  const chip = (tooltip: string): string =>
    fixture.nativeElement.querySelector(`[mattooltip="${tooltip}"]`)?.textContent.trim();

  it('shows the channel name and description', async () => {
    await render({ name: 'Favorite Channel', channelDescription: 'All about cats', channelId: 'UC123' });

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a.text-4xl');
    expect(link.textContent.trim()).toBe('Favorite Channel');
    expect(link.href).toBe('https://www.youtube.com/channel/UC123');
    expect(fixture.nativeElement.textContent).toContain('All about cats');
  });

  it('shows whether the subscription is enabled', async () => {
    await render({ enabled: true });
    expect(field('Status:')).toBe('Enabled');

    await render({ enabled: false });
    expect(field('Status:')).toBe('Disabled');
  });

  it('marks a custom webhook', async () => {
    await render({ notifyHA: false });
    expect(field('Webhook:')).toBe('Disabled');

    await render({ notifyHA: true, webhookOverride: 'https://ha.local/api/webhook/abc' });
    expect(field('Webhook:')).toBe('Enabled (Custom)');
  });

  it('labels the type and format of a video subscription', async () => {
    await render({ type: Types.VIDEO, format: VideoFormats.MKV });

    expect(chip('Type')).toBe('Video');
    expect(chip('Format')).toBe('MKV');
  });

  it('labels the format of an audio subscription', async () => {
    await render({ type: Types.AUDIO, format: AudioFormats.FLAC });
    expect(chip('Format')).toBe('FLAC');
  });

  it('shows the poll interval or the poll times', async () => {
    await render({ pollType: PollType.INTERVAL, pollInterval: 90 });
    expect(field('Poll interval:')).toBe('1h 30m');

    await render({ pollType: PollType.TIME, pollTime: ['08:00', '20:00'] });
    expect(field('Poll interval:')).toBeUndefined();
    expect(field('Poll time:')).toBe('08:00, 20:00');
  });

  it('shows a dash for dates that have not happened yet', async () => {
    await render({ lastCaptureAt: undefined, lastCheckedAt: undefined, nextCheckAt: undefined });

    expect(field('Last capture:')).toBe('—');
    expect(field('Last check:')).toBe('—');
    expect(field('Next check:')).toBe('—');
  });

  it('hides the next check of a disabled subscription', async () => {
    await render({ enabled: false, nextCheckAt: new Date() });
    expect(field('Next check:')).toBe('—');
  });

  it('opens the widget in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await render();

    component.openWidgetInNewTab(1);
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/widget/1`, '_blank');
  });

  it('copies the Home Assistant card code', async () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
    await render();

    component.copyHaCardCode(1);

    expect(writeText).toHaveBeenCalledWith(WIDGET_CODE(window.location.origin, 1));
    expect(notify).toHaveBeenCalledWith('success', 'Home Assistant card code copied to clipboard');
  });

  describe('automation code webhook id', () => {
    const storage = () => TestBed.inject(StorageService);

    it("prefers the subscription's own webhook", async () => {
      storage().settings.set({ ...DefaultSettings, webhookUrl: 'https://ha.local/api/webhook/global' });
      await render({ webhookOverride: 'https://ha.local/api/webhook/own' });

      component.copyHaCardAutomationCode(1);
      expect(writeText).toHaveBeenCalledWith(HA_AUTOMATION_CODE('own', 1));
    });

    it('falls back to the global webhook', async () => {
      storage().settings.set({ ...DefaultSettings, webhookUrl: 'https://ha.local/api/webhook/global' });
      await render({ webhookOverride: '' });

      component.copyHaCardAutomationCode(1);
      expect(writeText).toHaveBeenCalledWith(HA_AUTOMATION_CODE('global', 1));
    });

    it('leaves a placeholder when no webhook is set', async () => {
      storage().settings.set({ ...DefaultSettings, webhookUrl: '' });
      await render({ webhookOverride: '' });

      component.copyHaCardAutomationCode(1);
      expect(writeText).toHaveBeenCalledWith(HA_AUTOMATION_CODE('<webhook_id>', 1));
    });
  });

  it('downloads the last video again as a manual download linked to the subscription', async () => {
    const createDownload = vi.spyOn(TestBed.inject(HttpService), 'createDownload').mockReturnValue(of(null));
    await render({ id: 4, lastVideoId: 'abc123' });

    component.downloadAgain();

    expect(createDownload).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://www.youtube.com/watch?v=abc123', watcherId: 4 }),
    );
  });
});
