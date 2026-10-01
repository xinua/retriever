import { ComponentFixture, TestBed } from '@angular/core/testing';
import { inject, provideAppInitializer } from '@angular/core';

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NotifierService } from 'angular-notifier';
import { DownloadRecordMock } from '@shared/constants';
import { DownloadModel } from '../../models/download.model';
import { Types } from '../../models/subscription.model';
import { provideNotifier } from '../../providers/notifier.provider';
import { RtPlayer } from './player';
import { useIconFactory } from '../../providers';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';
import { Subject } from 'rxjs';
import { DownloadStatus } from '../../models/download.model';
import { WsService } from '../../services/ws.service';

describe('RtPlayer', () => {
  let component: RtPlayer;
  let fixture: ComponentFixture<RtPlayer>;
  let httpMock: HttpTestingController;
  let downloadUpdated$: Subject<DownloadModel>;

  beforeEach(async () => {
    downloadUpdated$ = new Subject<DownloadModel>();

    await TestBed.configureTestingModule({
      imports: [RtPlayer],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNotifier(),
        { provide: WsService, useValue: { downloadUpdated$: () => downloadUpdated$ } },
        provideAppInitializer(() => {
          const initializerFn = useIconFactory(inject(DomSanitizer), inject(MatIconRegistry));
          return initializerFn();
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RtPlayer);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /**
   * Renders the component and answers the lookup it fires on init. Every
   * render makes that one request, so answering it here keeps each test about
   * the behaviour it is actually naming.
   */
  async function render(
    inputs: {
      subscriptionId?: number;
      containerSize?: string;
      posterClass?: string;
      /** What the lookup answers; null stands in for a watcher with no finished download. */
      download?: Partial<DownloadModel> | null;
    } = {},
  ) {
    const id = inputs.subscriptionId ?? 1;

    fixture.componentRef.setInput('subscriptionId', id);
    if (inputs.containerSize !== undefined) fixture.componentRef.setInput('containerSize', inputs.containerSize);
    if (inputs.posterClass !== undefined) fixture.componentRef.setInput('posterClass', inputs.posterClass);
    await fixture.whenStable();

    const lookup = httpMock.expectOne(`/api/downloads/by-watcher/${id}?statuses=done`);
    expect(lookup.request.method).toBe('GET');

    lookup.flush(
      inputs.download === null
        ? null
        : ({ ...DownloadRecordMock, fileExists: true, ...inputs.download } as DownloadModel),
    );

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

  it('should create', async () => {
    await render();
    expect(component).toBeTruthy();
  });

  it('projects its content and holds off loading media until it is clicked', async () => {
    await render();

    expect(fixture.nativeElement.querySelector('video')).toBeNull();
    expect(fixture.nativeElement.querySelector('audio')).toBeNull();
    expect(surface().classList).toContain('cursor-pointer');
    // The lookup is already answered; nothing else goes out until a click.
    httpMock.expectNone(() => true);
  });

  it('does not offer to play anything when the server says the file is gone', async () => {
    await render({ download: { fileExists: false } });

    expect(component.canPlay()).toBe(false);
    expect(surface().classList).not.toContain('cursor-pointer');

    await open();

    httpMock.expectNone(() => true);
    expect(component.isPlaying()).toBe(false);
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
  });

  it('does not offer to play anything when the watcher has no finished download', async () => {
    await render({ download: null });

    expect(component.canPlay()).toBe(false);
    expect(surface().classList).not.toContain('cursor-pointer');

    await open();
    expect(component.isPlaying()).toBe(false);
  });

  it('does not offer to play anything when the lookup fails', async () => {
    fixture.componentRef.setInput('subscriptionId', 1);
    await fixture.whenStable();

    httpMock
      .expectOne('/api/downloads/by-watcher/1?statuses=done')
      .flush('Server error', { status: 500, statusText: 'Internal Server Error' });
    await fixture.whenStable();

    expect(component.fileNotFound()).toBe(true);
    expect(surface().classList).not.toContain('cursor-pointer');

    await open();
    expect(component.isPlaying()).toBe(false);
  });

  it("streams the watcher's newest finished download without asking again on click", async () => {
    await render({ download: { id: 7 } });
    await open();

    httpMock.expectNone(() => true);
    expect(component.isPlaying()).toBe(true);
    expect(component.mediaUrl()).toBe('/api/downloads/7/file?inline=1');
    expect(fixture.nativeElement.querySelector('video').getAttribute('src')).toBe('/api/downloads/7/file?inline=1');
  });

  it('renders an audio element behind the poster for a non-video download', async () => {
    await render({ posterClass: 'rounded-t-lg', download: { type: Types.AUDIO, thumbnailPath: '/thumbs/7.jpg' } });
    await open();

    const poster = fixture.nativeElement.querySelector('img');
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
    expect(fixture.nativeElement.querySelector('audio').getAttribute('src')).toBe(component.mediaUrl());
    expect(poster.getAttribute('src')).toBe('/thumbs/7.jpg');
    expect(poster.classList).toContain('rounded-t-lg');
  });

  it('sizes the media wrapper from containerSize', async () => {
    await render({ containerSize: '640x360' });
    await open();

    expect(surface().style.width).toBe('640px');
    expect(surface().style.height).toBe('360px');
  });

  it('closes the player when the video itself is clicked', async () => {
    await render();
    await open();

    fixture.nativeElement.querySelector('video').dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();

    expect(component.isPlaying()).toBe(false);
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
  });

  it('reopens from the download it already has, without asking again', async () => {
    await render();
    await open();

    await close();
    await open();

    httpMock.expectNone(() => true);
    expect(component.isPlaying()).toBe(true);
    expect(fixture.nativeElement.querySelector('video')).toBeTruthy();
  });

  it('marks the file missing and notifies when the media element fails to load', async () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');

    await render();
    await open();

    fixture.nativeElement.querySelector('video').dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(component.fileNotFound()).toBe(true);
    expect(component.canPlay()).toBe(false);
    expect(notify).toHaveBeenCalledWith('error', 'File not found (status: 404)');
  });

  describe('when a download of this subscription finishes', () => {
    const finished = (overrides: Partial<DownloadModel> = {}) =>
      downloadUpdated$.next({
        ...DownloadRecordMock,
        id: 9,
        watcherId: 1,
        status: DownloadStatus.DONE,
        ...overrides,
      } as DownloadModel);

    it('asks for the last download again and plays the new one', async () => {
      await render({ download: { fileExists: false } });
      expect(component.canPlay()).toBe(false);

      finished();
      httpMock
        .expectOne('/api/downloads/by-watcher/1?statuses=done')
        .flush({ ...DownloadRecordMock, id: 9, fileExists: true } as DownloadModel);
      await fixture.whenStable();

      expect(component.canPlay()).toBe(true);
      expect(component.mediaUrl()).toBe('/api/downloads/9/file?inline=1');
    });

    it('clears a missing file once a new one is found', async () => {
      await render();
      component.handleError();
      expect(component.fileNotFound()).toBe(true);

      finished();
      httpMock
        .expectOne('/api/downloads/by-watcher/1?statuses=done')
        .flush({ ...DownloadRecordMock, id: 9, fileExists: true } as DownloadModel);

      expect(component.fileNotFound()).toBe(false);
    });

    it('ignores other subscriptions and downloads that are not done yet', async () => {
      await render();

      finished({ watcherId: 2 });
      finished({ watcherId: null });
      finished({ status: DownloadStatus.RUNNING });

      httpMock.expectNone(() => true);
    });
  });
});
