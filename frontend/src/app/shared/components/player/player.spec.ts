import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NotifierService } from 'angular-notifier';
import { DownloadRecordMock } from '@shared/constants';
import { DownloadModel } from '../../models/download.model';
import { Types } from '../../models/subscription.model';
import { provideNotifier } from '../../providers/notifier.provider';
import { RtPlayer } from './player';

describe('RtPlayer', () => {
  let component: RtPlayer;
  let fixture: ComponentFixture<RtPlayer>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RtPlayer],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNotifier()],
    }).compileComponents();

    fixture = TestBed.createComponent(RtPlayer);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /**
   * Renders the component and answers the existence probe it fires on init.
   * Every render makes that one request, so answering it here keeps each test
   * about the behaviour it is actually naming.
   */
  async function render(
    inputs: {
      subscriptionId?: number;
      containerSize?: string;
      posterClass?: string;
      /** What the probe answers — false stands in for a file deleted on disk. */
      fileExists?: boolean;
    } = {},
  ) {
    const id = inputs.subscriptionId ?? 1;

    fixture.componentRef.setInput('subscriptionId', id);
    if (inputs.containerSize !== undefined) fixture.componentRef.setInput('containerSize', inputs.containerSize);
    if (inputs.posterClass !== undefined) fixture.componentRef.setInput('posterClass', inputs.posterClass);
    await fixture.whenStable();

    const probe = httpMock.expectOne(`/api/downloads/subscription/${id}/exists?statuses=done`);
    expect(probe.request.method).toBe('HEAD');

    if (inputs.fileExists === false) {
      probe.flush(null, { status: 410, statusText: 'Gone' });
    } else {
      probe.flush(null);
    }

    await fixture.whenStable();
  }

  /** The outermost element the component renders: the projected placeholder, or the media wrapper. */
  const surface = (): HTMLElement => fixture.nativeElement.querySelector('div');
  /** What closes the player again — the video itself, or the poster the audio sits on. */
  const media = (): HTMLElement =>
    fixture.nativeElement.querySelector('video') ?? fixture.nativeElement.querySelector('div > div');

  const open = async () => {
    surface().dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();
  };
  const close = async () => {
    media().dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();
  };

  /** Answers the one request the first click makes. */
  async function flush(overrides: Partial<DownloadModel> = {}) {
    httpMock
      .expectOne('/api/downloads/by-watcher/1?statuses=done')
      .flush({ ...DownloadRecordMock, ...overrides } as DownloadModel);
    await fixture.whenStable();
  }

  it('should create', async () => {
    await render();
    expect(component).toBeTruthy();
  });

  it('projects its content and holds off loading media until it is clicked', async () => {
    await render();

    expect(fixture.nativeElement.querySelector('video')).toBeNull();
    expect(fixture.nativeElement.querySelector('audio')).toBeNull();
    expect(surface().classList).toContain('cursor-pointer');
    // The probe is already answered; nothing else goes out until a click.
    httpMock.expectNone(() => true);
  });

  it('does not offer to play anything when the probe says the file is gone', async () => {
    await render({ fileExists: false });

    expect(component.fileNotFound()).toBe(true);
    expect(surface().classList).not.toContain('cursor-pointer');

    await open();

    // No lookup at all: the probe already answered the question the click asks.
    httpMock.expectNone(() => true);
    expect(component.isPlaying()).toBe(false);
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
  });

  it("asks for the watcher's newest finished download and streams it", async () => {
    await render();
    surface().dispatchEvent(new MouseEvent('click'));

    const request = httpMock.expectOne('/api/downloads/by-watcher/1?statuses=done');
    expect(request.request.method).toBe('GET');

    request.flush({ ...DownloadRecordMock, id: 7 } as DownloadModel);
    await fixture.whenStable();

    expect(component.isPlaying()).toBe(true);
    expect(component.mediaUrl()).toBe('/api/downloads/7/file?inline=1');
    expect(fixture.nativeElement.querySelector('video').getAttribute('src')).toBe('/api/downloads/7/file?inline=1');
  });

  it('renders an audio element behind the poster for a non-video download', async () => {
    await render({ posterClass: 'rounded-t-lg' });
    await open();
    await flush({ type: Types.AUDIO, thumbnailPath: '/thumbs/7.jpg' });

    const poster = fixture.nativeElement.querySelector('img');
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
    expect(fixture.nativeElement.querySelector('audio').getAttribute('src')).toBe(component.mediaUrl());
    expect(poster.getAttribute('src')).toBe('/thumbs/7.jpg');
    expect(poster.classList).toContain('rounded-t-lg');
  });

  it('sizes the media wrapper from containerSize', async () => {
    await render({ containerSize: '640x360' });
    await open();
    await flush();

    expect(surface().style.width).toBe('640px');
    expect(surface().style.height).toBe('360px');
  });

  it('closes the player when the video itself is clicked', async () => {
    await render();
    await open();
    await flush();

    fixture.nativeElement.querySelector('video').dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();

    expect(component.isPlaying()).toBe(false);
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
  });

  it('reopens from the download it already has, without asking again', async () => {
    await render();
    await open();
    await flush();

    await close();
    await open();

    expect(component.isPlaying()).toBe(true);
    expect(fixture.nativeElement.querySelector('video')).toBeTruthy();
  });

  it('refuses to reopen a download whose file is gone', async () => {
    await render();
    await open();
    await flush({ filePath: null });

    await close();
    await open(); // nothing left to play

    expect(component.isPlaying()).toBe(false);
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
  });

  it('marks the file missing when the lookup 404s and stops offering to play it', async () => {
    await render();
    await open();

    httpMock
      .expectOne('/api/downloads/by-watcher/1?statuses=done')
      .flush('Not found', { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();

    expect(component.fileNotFound()).toBe(true);
    expect(component.isPlaying()).toBe(false);
    expect(surface().classList).not.toContain('cursor-pointer');

    await open();
    expect(component.isPlaying()).toBe(false);
  });

  it('marks the file missing and notifies when the media element fails to load', async () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');

    await render();
    await open();
    await flush();

    fixture.nativeElement.querySelector('video').dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(component.fileNotFound()).toBe(true);
    expect(notify).toHaveBeenCalledWith('error', 'File not found (status: 404)');
  });
});
