import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DownloadInfo } from './download-info';
import { DownloadModel, DownloadStatus, Types } from '@shared/models';
import { DownloadRecordMock } from '@shared/constants';

describe('DownloadInfo', () => {
  let fixture: ComponentFixture<DownloadInfo>;
  let component: DownloadInfo;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadInfo],
    }).compileComponents();

    fixture = TestBed.createComponent(DownloadInfo);
    component = fixture.componentInstance;
    // No change detection here on purpose: the template reads `download()` unconditionally,
    // so rendering before the input is set is exactly the "reading 'totalBytes'" crash.
  });

  /** Sets the input like a parent template would, then renders. Overrides let each test tweak one thing. */
  async function render(overrides: Partial<DownloadModel> = {}) {
    fixture.componentRef.setInput('download', { ...DownloadRecordMock, ...overrides });
    await fixture.whenStable();
  }

  /** Text of a body cell; Material tags every cell with `mat-column-<name>`. */
  function cell(column: string): string {
    return fixture.nativeElement.querySelector(`td.mat-column-${column}`).textContent.trim();
  }

  function errorBox(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.error-message');
  }

  it('should create', async () => {
    await render();
    expect(component).toBeTruthy();
  });

  it('renders the download details in the table', async () => {
    await render({ totalBytes: 10240000, type: Types.VIDEO, format: 'mp4', duration: 1200 } as Partial<DownloadModel>);

    expect(cell('size')).toBe('9.8 MB');
    expect(cell('type')).toBe('Video');
    expect(cell('format')).toBe('Mp4');
    expect(cell('duration')).toBe('20:00');
  });

  it('shows a dash for values that are missing', async () => {
    await render({ totalBytes: null, codec: null });

    expect(cell('size')).toBe('—');
    expect(cell('codec')).toBe('—');
  });

  it('hides format, quality, codec and duration for thumbnails', async () => {
    await render({ type: Types.THUMBNAIL });

    expect(cell('format')).toBe('—');
    expect(cell('quality')).toBe('—');
    expect(cell('codec')).toBe('—');
    expect(cell('duration')).toBe('—');
  });

  it('shows the error message only for failed downloads that carry one', async () => {
    await render({ status: DownloadStatus.FAILED, error: 'Video unavailable' });
    expect(errorBox()?.textContent.trim()).toBe('Video unavailable');

    // Same error text, but the download is not failed: the box must stay hidden.
    await render({ status: DownloadStatus.DONE, error: 'Video unavailable' });
    expect(errorBox()).toBeNull();
  });
});
