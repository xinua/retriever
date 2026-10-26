import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AutoHide } from '../../directives/auto-hide';
import { DownloadPoster } from './download-poster';
import { DownloadRecordMock, DRAG_TOKEN, HEIGHT_CHANGE_TOKEN, SCROLL_TOKEN } from '@shared/constants';
import { fromEvent, of } from 'rxjs';
import { DownloadModel, DownloadStatus, Types } from '@shared/models';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { NotifierService } from 'angular-notifier';
import { provideNotifier } from '../../providers';

describe('Poster', () => {
  let component: DownloadPoster;
  let fixture: ComponentFixture<DownloadPoster>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadPoster],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNotifier(),
        { provide: DRAG_TOKEN, useValue: of(false) },
        { provide: SCROLL_TOKEN, useValue: fromEvent(document, 'scroll') },
        { provide: HEIGHT_CHANGE_TOKEN, useValue: fromEvent(window, 'resize') },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DownloadPoster);
    component = fixture.componentInstance;
  });

  async function render(overrides: Partial<DownloadModel> = {}) {
    fixture.componentRef.setInput('download', {
      ...DownloadRecordMock,
      id: 3,
      status: DownloadStatus.DONE,
      fileExists: true,
      ...overrides,
    });
    await fixture.whenStable();
  }

  afterEach(() => vi.unstubAllGlobals());

  const card = (): HTMLElement | null => fixture.nativeElement.querySelector('rt-steam-card');
  const video = (): HTMLVideoElement | null => fixture.nativeElement.querySelector('video');
  const audio = (): HTMLElement | null => fixture.nativeElement.querySelector('rt-audio-player');

  async function clickCard() {
    card().querySelector<HTMLElement>('.rt-card-content').click();
    await fixture.whenStable();
  }

  /** The element the pointer has to leave for the audio bar to go away. */
  const hoverable = (): HTMLElement => fixture.debugElement.query(By.directive(AutoHide)).nativeElement;
  /** The layer the audio gestures land on. */
  const gestures = (): HTMLElement | null => fixture.nativeElement.querySelector('rt-media-gestures div');
  const flashedIcon = (): string | null =>
    fixture.nativeElement.querySelector('.animate-pop-fade mat-icon')?.getAttribute('data-mat-icon-name') ?? null;

  /** A single click only counts once the double-click window has passed. */
  async function singleClick(element: HTMLElement) {
    vi.useFakeTimers();
    try {
      element.click();
      vi.advanceTimersByTime(250);
    } finally {
      vi.useRealTimers();
    }
    await fixture.whenStable();
  }

  it('shows the poster until it is clicked', async () => {
    await render({ thumbnailPath: '/thumbs/3.jpg' });

    expect(card()).not.toBeNull();
    expect(card().querySelector('img').getAttribute('src')).toBe('/thumbs/3.jpg');
    expect(video()).toBeNull();
  });

  it('plays a video from the stream url when clicked', async () => {
    await render({ type: Types.VIDEO });
    await clickCard();

    expect(card()).toBeNull();
    expect(video().getAttribute('src')).toBe('/api/downloads/3/file?inline=1');
  });

  it('plays audio in the audio player when clicked', async () => {
    await render({ type: Types.AUDIO });
    await clickCard();

    expect(video()).toBeNull();
    expect(audio()).not.toBeNull();
  });

  it('keeps the video open when it is clicked, leaving the click to its controls', async () => {
    await render({ type: Types.VIDEO });
    await clickCard();

    video().click();
    await fixture.whenStable();

    expect(video()).not.toBeNull();
    expect(card()).toBeNull();
  });

  it('goes back to the poster when the video is held', async () => {
    await render({ type: Types.VIDEO });
    await clickCard();

    vi.useFakeTimers();
    try {
      // jsdom has no PointerEvent; the long press only reads `button`.
      video().dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0 }));
      vi.advanceTimersByTime(500);
    } finally {
      vi.useRealTimers();
    }
    await fixture.whenStable();

    expect(video()).toBeNull();
    expect(card()).not.toBeNull();
  });

  it('goes back to the poster when the video ends', async () => {
    await render({ type: Types.VIDEO });
    await clickCard();

    video().dispatchEvent(new Event('ended'));
    await fixture.whenStable();

    expect(component.activeMedia()).toBeNull();
    expect(card()).not.toBeNull();
  });

  it('does not open a file that is missing from disk', async () => {
    await render({ type: Types.VIDEO, fileExists: false });
    await clickCard();

    expect(video()).toBeNull();
  });

  it('does not open a thumbnail download', async () => {
    await render({ type: Types.THUMBNAIL });
    await clickCard();

    expect(video()).toBeNull();
    expect(audio()).toBeNull();
  });

  it('reports a file that fails to play and shows the poster again', async () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
    await render({ type: Types.VIDEO });
    await clickCard();

    video().dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(notify).toHaveBeenCalledWith('error', 'File is no longer on disk');
    expect(card()).not.toBeNull();
  });

  it('leaves the audio gestures to the shared layer, over the poster and under the player bar', async () => {
    await render({ type: Types.AUDIO });
    await clickCard();

    expect(gestures()).not.toBeNull();
    expect(flashedIcon()).toBeNull();

    const toggle = vi.spyOn(component.audioPlayer(), 'togglePlayPause').mockReturnValue(false);
    await singleClick(gestures());

    expect(toggle).toHaveBeenCalled();
    expect(flashedIcon()).toBe('pause');
    expect(component.activeMedia()).toBe(3);
  });

  it('gets the audio bar out of the way once the pointer leaves the poster', async () => {
    // The test environment answers no media query, and without a hovering pointer the bar stays put.
    vi.stubGlobal('matchMedia', () => ({ matches: true }) as MediaQueryList);

    await render({ type: Types.AUDIO });
    await clickCard();

    const bar = (): HTMLElement => fixture.nativeElement.querySelector('rt-audio-player').parentElement;
    expect(bar().classList).not.toContain('opacity-0');

    vi.useFakeTimers();
    try {
      hoverable().dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
    }
    fixture.detectChanges();
    await fixture.whenStable();

    expect(bar().classList).toContain('opacity-0');
    // A bar that is only invisible would still swallow the taps meant for the gesture layer.
    expect(bar().classList).toContain('pointer-events-none');
  });

  it('goes back to the poster when the audio poster is held', async () => {
    await render({ type: Types.AUDIO });
    await clickCard();

    vi.useFakeTimers();
    try {
      // jsdom has no PointerEvent; the long press only reads `button`.
      gestures().dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0 }));
      vi.advanceTimersByTime(500);
    } finally {
      vi.useRealTimers();
    }
    await fixture.whenStable();

    expect(component.activeMedia()).toBeNull();
    expect(audio()).toBeNull();
    expect(card()).not.toBeNull();
  });

  it('offers to replace the poster only once the download is finished and not a thumbnail', async () => {
    const dropArea = () => fixture.nativeElement.querySelector('rt-drop-area');

    await render({ type: Types.VIDEO });
    expect(dropArea()).not.toBeNull();

    await render({ type: Types.VIDEO, status: DownloadStatus.RUNNING });
    expect(dropArea()).toBeNull();

    await render({ type: Types.THUMBNAIL });
    expect(dropArea()).toBeNull();
  });
});
