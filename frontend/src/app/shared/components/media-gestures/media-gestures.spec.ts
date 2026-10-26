import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AudioPlayer } from '../audio-player/audio-player';
import { MediaGestures } from './media-gestures';

describe('MediaGestures', () => {
  let fixture: ComponentFixture<MediaGestures>;
  let component: MediaGestures;
  let player: { togglePlayPause: ReturnType<typeof vi.fn>; seekBy: ReturnType<typeof vi.fn> };
  let closed: ReturnType<typeof vi.fn<() => void>>;
  let layer: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MediaGestures] }).compileComponents();

    player = { togglePlayPause: vi.fn(() => true), seekBy: vi.fn() };
    closed = vi.fn<() => void>();

    fixture = TestBed.createComponent(MediaGestures);
    component = fixture.componentInstance;
    component.closed.subscribe(closed);
    fixture.componentRef.setInput('player', player as unknown as AudioPlayer);
    await fixture.whenStable();

    layer = fixture.nativeElement.querySelector('div');
    // jsdom lays nothing out, so the half a tap lands in has to be told.
    layer.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
  });

  afterEach(() => vi.useRealTimers());

  async function refresh() {
    vi.useRealTimers();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** A single tap only counts once the double-tap window has passed. Fake timers have to be running. */
  function tapNow(clientX = 100) {
    layer.dispatchEvent(new MouseEvent('click', { clientX }));
    vi.advanceTimersByTime(250);
  }

  /** Two taps inside the window, so the directive reads them as one double tap. */
  function doubleTapNow(clientX: number) {
    layer.dispatchEvent(new MouseEvent('click', { clientX }));
    layer.dispatchEvent(new MouseEvent('click', { clientX }));
  }

  async function tap(clientX = 100) {
    vi.useFakeTimers();
    tapNow(clientX);
    await refresh();
  }

  async function doubleTap(clientX: number) {
    vi.useFakeTimers();
    doubleTapNow(clientX);
    await refresh();
  }

  const flashedIcon = (): string | null =>
    fixture.nativeElement.querySelector('.animate-pop-fade mat-icon')?.getAttribute('data-mat-icon-name') ?? null;
  const seekLabel = (): string | null =>
    fixture.nativeElement.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim() ?? null;

  it('flashes the state a tap switched playback to', async () => {
    await tap();

    expect(player.togglePlayPause).toHaveBeenCalledTimes(1);
    expect(flashedIcon()).toBe('play_arrow');

    player.togglePlayPause.mockReturnValue(false);
    await tap();

    expect(flashedIcon()).toBe('pause');
    // A fresh key on every tap, so the animation replays.
    expect(component.playPauseFlash().key).toBe(2);
  });

  it('stops flashing once the icon has faded out', async () => {
    // One fake-timer run: switching back to real timers would drop the timeout the tap scheduled.
    vi.useFakeTimers();
    tapNow();
    expect(component.playPauseFlash()).not.toBeNull();

    vi.advanceTimersByTime(1300);
    await refresh();

    expect(component.playPauseFlash()).toBeNull();
    expect(flashedIcon()).toBeNull();
  });

  it('seeks in the half of the poster that was double tapped', async () => {
    await doubleTap(20);

    expect(player.seekBy).toHaveBeenCalledWith(-10);
    expect(seekLabel()).toBe('- 10s');

    await doubleTap(180);

    // The other side starts over instead of adding to the jump that was running.
    expect(player.seekBy).toHaveBeenLastCalledWith(10);
    expect(seekLabel()).toBe('+ 10s');
  });

  it('adds up double taps on the same side', async () => {
    await doubleTap(180);
    await doubleTap(180);

    expect(player.seekBy).toHaveBeenCalledTimes(2);
    expect(player.seekBy).toHaveBeenLastCalledWith(10);
    expect(component.seekTotalTime()).toBe(20);
    expect(seekLabel()).toBe('+ 20s');
  });

  it('stops showing the jump once the seeking stops', async () => {
    vi.useFakeTimers();
    doubleTapNow(180);
    expect(component.seekDirection()).toBe('right');

    vi.advanceTimersByTime(1000);
    await refresh();

    expect(component.seekDirection()).toBeNull();
    expect(component.seekTotalTime()).toBe(0);
    expect(seekLabel()).toBeNull();
  });

  it('keeps a tap between two jumps from pausing the track', async () => {
    await doubleTap(180);
    await tap();

    expect(player.togglePlayPause).not.toHaveBeenCalled();
    expect(flashedIcon()).toBeNull();
  });

  it('asks the host to close when the poster is held', async () => {
    vi.useFakeTimers();
    // jsdom has no PointerEvent; the long press only reads `button`.
    layer.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0 }));
    vi.advanceTimersByTime(500);
    await refresh();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(player.togglePlayPause).not.toHaveBeenCalled();
  });

  it('does nothing while it has no player to drive', async () => {
    fixture.componentRef.setInput('player', null);
    await fixture.whenStable();

    await tap();
    await doubleTap(20);

    expect(component.playPauseFlash()).toBeNull();
    expect(component.seekDirection()).toBeNull();
  });

  it('scales the feedback to the player it belongs to', async () => {
    expect(component.size().flashIcon).toBe(56);

    fixture.componentRef.setInput('playerSize', 'lg');
    await fixture.whenStable();

    expect(component.size().flashIcon).toBe(72);
  });
});
