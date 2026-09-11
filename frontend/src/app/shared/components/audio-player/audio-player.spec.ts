import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AudioPlayer } from './audio-player';

describe('AudioPlayer', () => {
  let component: AudioPlayer;
  let fixture: ComponentFixture<AudioPlayer>;
  let audio: HTMLAudioElement;
  let slider: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AudioPlayer],
    }).compileComponents();

    fixture = TestBed.createComponent(AudioPlayer);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('duration', 200);
    await fixture.whenStable();

    audio = fixture.nativeElement.querySelector('audio');
    slider = fixture.nativeElement.querySelector('input[type="range"]');
  });

  const drag = (seconds: number, commit: boolean) => {
    slider.value = String(seconds);
    slider.dispatchEvent(new Event('input'));
    if (commit) slider.dispatchEvent(new Event('change'));
  };

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('uses the duration input until the media reports its own', () => {
    expect(component.totalDuration()).toBe(200);
    expect(slider.max).toBe('200');
  });

  it('follows playback progress', () => {
    Object.defineProperty(audio, 'currentTime', { value: 50, configurable: true, writable: true });
    audio.dispatchEvent(new Event('timeupdate'));

    expect(component.currentTime()).toBe(50);
    expect(component.progress()).toBe(25);
  });

  it('ignores timeupdate while the slider is being dragged', () => {
    Object.defineProperty(audio, 'currentTime', { value: 50, configurable: true, writable: true });
    drag(120, false);
    audio.dispatchEvent(new Event('timeupdate'));

    expect(component.currentTime()).toBe(120);
  });

  it('seeks the media when the slider is released, even to the same spot twice', () => {
    const currentTime = vi.fn();
    Object.defineProperty(audio, 'currentTime', { set: currentTime, get: () => 0, configurable: true });

    drag(120, true);
    drag(120, true);

    expect(currentTime).toHaveBeenCalledTimes(2);
    expect(currentTime).toHaveBeenLastCalledWith(120);
    expect(component.currentTime()).toBe(120);
  });

  it('mirrors play/pause state from the media element', () => {
    audio.dispatchEvent(new Event('play'));
    expect(component.isPlaying()).toBe(true);

    audio.dispatchEvent(new Event('pause'));
    expect(component.isPlaying()).toBe(false);
  });

  it('resets state when the source is replaced', () => {
    drag(120, true);
    audio.dispatchEvent(new Event('emptied'));

    expect(component.currentTime()).toBe(0);
    expect(component.progress()).toBe(0);
  });
});
