import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DownloadRecord } from './download-record';
import { DownloadModel, DownloadSource, DownloadStatus, Types } from '@shared/models';
import { DownloadRecordMock, DRAG_TOKEN, HEIGHT_CHANGE_TOKEN, SCROLL_TOKEN } from '@shared/constants';
import { fromEvent, of } from 'rxjs';
import { provideNotifier } from '../../providers/notifier.provider';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';

describe('DownloadRecord', () => {
  let component: DownloadRecord;
  let fixture: ComponentFixture<DownloadRecord>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadRecord],
      providers: [
        provideNotifier(),
        { provide: DRAG_TOKEN, useValue: of(false) },
        {
          provide: SCROLL_TOKEN,
          useValue: fromEvent(document, 'scroll'),
        },
        {
          provide: HEIGHT_CHANGE_TOKEN,
          useValue: fromEvent(window, 'resize'),
        },
      ],
    }).compileComponents();

    const sanitizer = TestBed.inject(DomSanitizer);
    ['telegram', 'upload_image'].forEach((name) =>
      TestBed.inject(MatIconRegistry).addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml('<svg></svg>')),
    );

    fixture = TestBed.createComponent(DownloadRecord);
    component = fixture.componentInstance;
  });

  async function render(overrides: Partial<DownloadModel> = {}) {
    fixture.componentRef.setInput('download', { ...DownloadRecordMock, ...overrides });
    fixture.componentRef.setInput('index', 1);
    fixture.componentRef.setInput('paginator', { page: 1, pageSize: 10, totalItems: 100 });
    await fixture.whenStable();
  }

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);
  const text = (): string => fixture.nativeElement.textContent.replace(/\s+/g, ' ');

  it('links the title to the video, with the prefix in front', async () => {
    await render({ prefix: '[Music]', title: 'Song', url: 'https://youtu.be/abc' });

    const link = query('a.text-lg') as HTMLAnchorElement;
    expect(link.textContent.trim()).toBe('[Music] Song');
    expect(link.href).toBe('https://youtu.be/abc');
  });

  it('falls back to the url when there is no title yet', async () => {
    await render({ prefix: null, title: null, url: 'https://youtu.be/abc' });
    expect(query('a.text-lg').textContent.trim()).toBe('https://youtu.be/abc');
  });

  it.each([DownloadStatus.QUEUED, DownloadStatus.RUNNING])('shows progress while %s', async (status) => {
    await render({ status });
    expect(query('rt-progress-info')).not.toBeNull();
  });

  it('hides progress once finished', async () => {
    await render({ status: DownloadStatus.DONE });
    expect(query('rt-progress-info')).toBeNull();
  });

  it('marks downloads made by a subscription', async () => {
    await render({ source: DownloadSource.WATCHER, channelName: 'Channel' });
    expect(query('mat-icon[fonticon="subscriptions"]')).not.toBeNull();

    await render({ source: DownloadSource.MANUAL, channelName: 'Channel' });
    expect(query('mat-icon[fonticon="subscriptions"]')).toBeNull();
  });

  it('shows the playlist and position the download came from', async () => {
    await render({ playlistTitle: 'Best of', playlistIndex: 4 });
    expect(text()).toContain('Best of #4');
  });

  it('shows the error of a failed download', async () => {
    await render({ status: DownloadStatus.FAILED, error: 'Video unavailable' });
    expect(query('.text-red-400').textContent.trim()).toBe('Video unavailable');

    await render({ status: DownloadStatus.DONE, error: 'Video unavailable' });
    expect(query('.text-red-400')).toBeNull();
  });

  it('shows the type, date and size badges', async () => {
    await render({ type: Types.AUDIO, createdAt: '2024-06-01T12:00:00Z', totalBytes: 10240000 });

    const badges = [...fixture.nativeElement.querySelectorAll('rt-badge')].map((el: HTMLElement) =>
      el.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(badges[0]).toContain('Audio');
    expect(badges[1]).toContain('01 Jun 2024');
    expect(badges[2]).toBe('10.2 MB');
  });

  it('leaves out the size badge when the size is unknown', async () => {
    await render({ totalBytes: null });
    expect(fixture.nativeElement.querySelectorAll('rt-badge')).toHaveLength(2);
  });

  it('passes cancel up with the download', async () => {
    const cancel = vi.fn();
    component.cancel.subscribe(cancel);
    await render({ id: 9, status: DownloadStatus.RUNNING });

    query('rt-progress-info button').click();
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));
  });

  it('passes remove up with the download and its card', async () => {
    const remove = vi.fn();
    component.remove.subscribe(remove);
    await render({ id: 9, status: DownloadStatus.DONE });

    query('rt-download-controls button').click();

    const [{ download, elementRef }] = remove.mock.calls[0];
    expect(download.id).toBe(9);
    expect(elementRef).toBe(query('div'));
  });
});
