import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressInfo } from './progress-info';
import { DownloadRecordMock } from '@shared/constants';
import { Codecs, DownloadModel } from '@shared/models';
import { provideNotifier } from '../../providers/notifier.provider';

describe('ProgressInfo', () => {
  let component: ProgressInfo;
  let fixture: ComponentFixture<ProgressInfo>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressInfo],
      providers: [provideNotifier()],
    }).compileComponents();

    fixture = TestBed.createComponent(ProgressInfo);
    component = fixture.componentInstance;
  });

  async function render(overrides: Partial<DownloadModel> = {}) {
    fixture.componentRef.setInput('download', { ...DownloadRecordMock, ...overrides });
    await fixture.whenStable();
  }

  const stats = (): string =>
    [...fixture.nativeElement.querySelectorAll('.text-xs > span')]
      .map((el: HTMLElement) => el.textContent.trim())
      .join(' ');
  const bar = (): HTMLElement => fixture.nativeElement.querySelector('rt-progress-bar');

  it('shows progress, speed, eta and size while downloading', async () => {
    await render({ progress: 42, speed: '1.5MiB/s', eta: '00:12', totalBytes: 10240000 });

    expect(stats()).toBe('Progress: 42% Speed: 1.5MiB/s ETA: 00:12 Size: 10.2 MB');
    expect(bar().getAttribute('aria-label')).toBe('Downloading...');
    expect(bar().getAttribute('aria-valuenow')).toBe('42');
  });

  it('leaves out stats that are not known yet', async () => {
    await render({ progress: 5, speed: null, eta: null, totalBytes: null });
    expect(stats()).toBe('Progress: 5%');
  });

  it('switches to post-processing at 100%', async () => {
    await render({ progress: 100, speed: '1.5MiB/s' });

    expect(stats()).toContain('Post-processing...');
    expect(stats()).not.toContain('Speed');
    expect(bar().getAttribute('aria-valuenow')).toBeNull();
  });

  it('names the target codec while converting', async () => {
    await render({ phase: 'converting', codec: Codecs.H265, progress: 30 });
    expect(bar().getAttribute('aria-label')).toBe('Converting to H265...');
  });

  it('emits cancel with the download', async () => {
    const cancel = vi.fn();
    component.cancel.subscribe(cancel);
    await render({ id: 7 });

    fixture.nativeElement.querySelector('button').click();
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });
});
