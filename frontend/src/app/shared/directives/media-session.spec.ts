import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MediaSession } from './media-session';

class FakeMediaMetadata {
  constructor(public init: MediaMetadataInit) {}
}

@Component({
  imports: [MediaSession],
  template: `
    @if (shown()) {
      <video rtMediaSession [rtMediaTitle]="title()" rtMediaArtist="Channel" [rtMediaArtwork]="artwork()"></video>
    }
  `,
})
class HostComponent {
  shown = signal(true);
  title = signal('First');
  artwork = signal<string | null>('/thumbs/1.jpg');
}

describe('MediaSession', () => {
  let fixture: ComponentFixture<HostComponent>;
  const session = { metadata: null as unknown };

  const video = () => fixture.nativeElement.querySelector('video') as HTMLVideoElement;
  const metadata = () => session.metadata as FakeMediaMetadata;

  beforeEach(() => {
    session.metadata = null;
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
    vi.stubGlobal('MediaMetadata', FakeMediaMetadata);

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { mediaSession?: unknown }).mediaSession;
  });

  it('should publish nothing until the element plays', () => {
    expect(session.metadata).toBeNull();
  });

  it('should publish the current inputs on play', () => {
    fixture.componentInstance.title.set('Second');
    fixture.detectChanges();

    video().dispatchEvent(new Event('play'));

    expect(metadata().init).toEqual({ title: 'Second', artist: 'Channel', artwork: [{ src: '/thumbs/1.jpg' }] });
  });

  it('should send no artwork when there is no poster', () => {
    fixture.componentInstance.artwork.set(null);
    fixture.detectChanges();

    video().dispatchEvent(new Event('play'));

    expect(metadata().init.artwork).toEqual([]);
  });

  it('should clear its own metadata on destroy', () => {
    video().dispatchEvent(new Event('play'));

    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();

    expect(session.metadata).toBeNull();
  });

  it("should keep another player's metadata on destroy", () => {
    video().dispatchEvent(new Event('play'));
    const other = new FakeMediaMetadata({ title: 'Other' });
    session.metadata = other;

    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();

    expect(session.metadata).toBe(other);
  });
});
