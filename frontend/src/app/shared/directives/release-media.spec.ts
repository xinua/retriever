import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReleaseMedia } from './release-media';

@Component({
  imports: [ReleaseMedia],
  template: `
    @if (shown()) {
      <video rtReleaseMedia src="/media/1.mp4"></video>
    }
  `,
})
class HostComponent {
  shown = signal(true);
}

describe('ReleaseMedia', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('should pause, drop the source and reload on destroy', () => {
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const load = vi.spyOn(video, 'load').mockImplementation(() => {});

    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();

    expect(pause).toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalled();
  });
});
