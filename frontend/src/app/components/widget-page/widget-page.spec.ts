import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { DownloadRecordMock, MockSubscription } from '@shared/constants';
import { DownloadModel, DownloadStatus, SubscriptionModel, Types } from '@shared/models';
import { HttpService, StorageService, WsService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { DeviceDetectorService } from 'ngx-device-detector';
import { of, Subject, throwError } from 'rxjs';

import { WidgetPage } from './widget-page';

const subscription = (overrides: Partial<SubscriptionModel> = {}): SubscriptionModel => ({
  ...MockSubscription,
  lastVideoTitle: 'Latest Video',
  lastVideoThumbnailPath: '/thumbs/latest.jpg',
  ...overrides,
});

const download = (overrides: Partial<DownloadModel> = {}): DownloadModel => ({
  ...DownloadRecordMock,
  id: 42,
  watcherId: MockSubscription.id,
  status: DownloadStatus.DONE,
  ...overrides,
});

describe('WidgetPage', () => {
  let fixture: ComponentFixture<WidgetPage>;
  let component: WidgetPage;
  let storage: StorageService;
  let http: Record<string, ReturnType<typeof vi.fn>>;
  let notify: ReturnType<typeof vi.fn>;
  let isMobile: ReturnType<typeof vi.fn>;
  let nextCheck$: Subject<unknown>;

  beforeEach(async () => {
    nextCheck$ = new Subject();
    notify = vi.fn();
    isMobile = vi.fn(() => false);
    http = {
      getSubscription: vi.fn(() => of(null)),
      getDownloadByWatcher: vi.fn(() => of(download())),
      streamFileUrl: vi.fn((id: number) => `/api/downloads/${id}/file?inline=1`),
    };

    await TestBed.configureTestingModule({
      imports: [WidgetPage],
      providers: [
        { provide: HttpService, useValue: http },
        { provide: NotifierService, useValue: { notify } },
        { provide: DeviceDetectorService, useValue: { isMobile } },
        { provide: WsService, useValue: { nextCheck$: () => nextCheck$ } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: String(MockSubscription.id) }) } },
        },
      ],
    }).compileComponents();

    storage = TestBed.inject(StorageService);
    storage.subscriptions.set([subscription(), subscription({ id: 2, name: 'Other' })]);
  });

  afterEach(() => vi.useRealTimers());

  async function render() {
    fixture = TestBed.createComponent(WidgetPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function refresh() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const query = <T extends Element = HTMLElement>(selector: string): T | null => el().querySelector<T>(selector);
  const overlay = (): HTMLDivElement => component.playOverlay()!.nativeElement;
  const playButton = (): HTMLElement => query('.bg-red-500.rounded-full.cursor-pointer')!;

  describe('loading', () => {
    it('fetches the subscription from the route id and refetches on every next check', async () => {
      await render();

      expect(http['getSubscription']).toHaveBeenCalledTimes(1);
      expect(http['getSubscription']).toHaveBeenCalledWith(MockSubscription.id);

      nextCheck$.next({});

      expect(http['getSubscription']).toHaveBeenCalledTimes(2);
    });

    it('loads the latest finished download of the watcher', async () => {
      await render();

      expect(http['getDownloadByWatcher']).toHaveBeenCalledWith(MockSubscription.id, {
        statuses: [DownloadStatus.DONE],
        types: [],
      });
      expect(component.download()).toEqual(download());
    });

    it('falls back to no download when the request fails', async () => {
      http['getDownloadByWatcher'].mockReturnValue(throwError(() => new Error('404')));
      await render();

      expect(component.download()).toBeNull();
      expect(component.canPlay()).toBe(false);
    });
  });

  describe('channel', () => {
    it('picks the subscription matching the route id', async () => {
      await render();

      expect(component.channel()?.id).toBe(MockSubscription.id);
    });

    it('shows a placeholder when the subscription is unknown', async () => {
      storage.subscriptions.set([subscription({ id: 2 })]);
      await render();

      expect(component.channel()).toBeUndefined();
      expect(el().textContent).toContain('No subscription found...');
      expect(query('img')).toBeNull();
    });

    it('renders the channel name, last video title and thumbnail', async () => {
      await render();

      expect(el().textContent).toContain(MockSubscription.name);
      expect(el().textContent).toContain('Latest Video');
      const img = query<HTMLImageElement>('img')!;
      expect(img.getAttribute('src')).toBe('/thumbs/latest.jpg');
      expect(img.alt).toBe('Latest Video');
    });

    it('marks a disabled channel with a red dot', async () => {
      storage.subscriptions.set([subscription({ enabled: false })]);
      await render();

      expect(query('.rounded-full.w-4.h-4')!.classList).toContain('bg-red-500');
    });
  });

  describe('canPlay', () => {
    it('is true for a download with a file', async () => {
      await render();

      expect(component.canPlay()).toBe(true);
      expect(component.videoUrl()).toBe('/api/downloads/42/file?inline=1');
      expect(query('mat-icon')?.textContent).toContain('play_arrow');
    });

    it('is false for thumbnails', async () => {
      http['getDownloadByWatcher'].mockReturnValue(of(download({ type: Types.THUMBNAIL })));
      await render();

      expect(component.canPlay()).toBe(false);
      expect(component.playOverlay()).toBeUndefined();
    });

    it('is false when the file is gone from disk', async () => {
      http['getDownloadByWatcher'].mockReturnValue(of(download({ fileExists: false })));
      await render();

      expect(component.canPlay()).toBe(false);
    });
  });

  describe('togglePlay', () => {
    it('does nothing when the download cannot be played', async () => {
      http['getDownloadByWatcher'].mockReturnValue(of(null));
      await render();
      const event = new MouseEvent('click');
      const preventDefault = vi.spyOn(event, 'preventDefault');

      component.togglePlay(event);

      expect(component.isPlaying()).toBe(false);
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('swaps the thumbnail for a video player when the play button is clicked', async () => {
      await render();

      playButton().click();
      await refresh();

      expect(component.isPlaying()).toBe(true);
      expect(query('img')).toBeNull();
      const video = query<HTMLVideoElement>('video')!;
      expect(video.getAttribute('src')).toBe('/api/downloads/42/file?inline=1');
      expect(overlay().classList).toContain('opacity-0!');
    });

    it('starts playing when the thumbnail is clicked', async () => {
      await render();

      query<HTMLImageElement>('img')!.click();

      expect(component.isPlaying()).toBe(true);
    });

    it('stops the click from reaching the overlay', async () => {
      isMobile.mockReturnValue(true);
      await render();

      playButton().click();

      expect(component.isOverlayVisible()).toBe(false);
    });

    it('moves the overlay behind the player after the fade, and back when stopped', async () => {
      vi.useFakeTimers();
      await render();

      component.togglePlay();
      vi.advanceTimersByTime(499);
      expect(overlay().classList).toContain('z-2');

      vi.advanceTimersByTime(1);
      expect(overlay().classList).not.toContain('z-2');

      component.togglePlay();
      expect(component.isPlaying()).toBe(false);
      expect(overlay().classList).not.toContain('opacity-0!');

      vi.advanceTimersByTime(500);
      expect(overlay().classList).toContain('z-2');
    });

    it('stops playing once the video ends', async () => {
      await render();

      component.togglePlay();
      query<HTMLVideoElement>('video')!.dispatchEvent(new Event('ended'));

      expect(component.isPlaying()).toBe(false);
    });
  });

  describe('audio downloads', () => {
    beforeEach(() => {
      http['getDownloadByWatcher'].mockReturnValue(of(download({ type: Types.AUDIO, duration: 180 })));
    });

    it('opens the audio player over the thumbnail', async () => {
      vi.useFakeTimers();
      await render();

      component.togglePlay();
      fixture.detectChanges();

      expect(query('rt-audio-player')).not.toBeNull();
      expect(query('video')).toBeNull();
      expect(query('img')).not.toBeNull();
      expect(component.audioPlayer()!.audioUrl()).toBe('/api/downloads/42/file?inline=1');
      expect(component.audioPlayer()!.duration()).toBe(180);

      vi.advanceTimersByTime(500);
      expect(component.audioContainer()!.nativeElement.classList).toContain('animate');
    });

    it('stops playing once the audio ends', async () => {
      await render();

      component.togglePlay();
      component.audioPlayer()!.nativePlayer().nativeElement.dispatchEvent(new Event('ended'));

      expect(component.isPlaying()).toBe(false);
    });

    it('closes the player when the backdrop is clicked, but not the player itself', async () => {
      await render();
      component.togglePlay();
      await refresh();

      query('rt-audio-player')!.click();
      expect(component.isPlaying()).toBe(true);

      query<HTMLElement>('.z-10')!.click();
      expect(component.isPlaying()).toBe(false);
    });

    it('handles playback errors from the audio player', async () => {
      await render();
      component.togglePlay();
      await refresh();

      component.audioPlayer()!.nativePlayer().nativeElement.dispatchEvent(new Event('error'));

      expect(component.isPlaying()).toBe(false);
      expect(notify).toHaveBeenCalledWith('error', 'File is no longer on disk');
    });
  });

  describe('handleError', () => {
    it('stops playback, notifies and shows the overlay again', async () => {
      await render();
      component.togglePlay();
      await refresh();

      query<HTMLVideoElement>('video')!.dispatchEvent(new Event('error'));

      expect(component.isPlaying()).toBe(false);
      expect(notify).toHaveBeenCalledWith('error', 'File is no longer on disk');
      expect(overlay().classList).not.toContain('opacity-0!');
    });
  });

  describe('showOverlay', () => {
    it('is ignored on desktop, where hover reveals the overlay', async () => {
      await render();

      overlay().click();

      expect(component.isOverlayVisible()).toBe(false);
    });

    it('toggles the overlay on mobile', async () => {
      isMobile.mockReturnValue(true);
      await render();

      overlay().click();
      expect(component.isOverlayVisible()).toBe(true);

      await refresh();
      expect(overlay().classList).not.toContain('opacity-0');

      overlay().click();
      expect(component.isOverlayVisible()).toBe(false);
    });

    it('hides the overlay on a click outside of it', async () => {
      isMobile.mockReturnValue(true);
      await render();
      overlay().click();

      document.body.click();

      expect(component.isOverlayVisible()).toBe(false);
    });
  });
});
