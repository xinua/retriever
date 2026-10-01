import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusIndicator } from './status-indicator';
import { provideNotifier } from '../../providers/notifier.provider';
import { DownloadModel, DownloadStatus } from '@shared/models';
import { DownloadRecordMock } from '@shared/constants';
import { StorageService } from '@shared/services';
import { NotifierService } from 'angular-notifier';

describe('StatusIndicator', () => {
  let component: StatusIndicator;
  let fixture: ComponentFixture<StatusIndicator>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusIndicator],
      providers: [provideNotifier()],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusIndicator);
    component = fixture.componentInstance;
  });

  async function render(overrides: Partial<DownloadModel> = {}) {
    fixture.componentRef.setInput('download', { ...DownloadRecordMock, ...overrides });
    await fixture.whenStable();
  }

  const dot = (): HTMLElement => fixture.nativeElement.querySelector('div');

  it.each([
    [DownloadStatus.DONE, 'bg-green-500'],
    [DownloadStatus.FAILED, 'bg-red-500'],
    [DownloadStatus.CANCELED, 'bg-gray-500'],
    [DownloadStatus.RUNNING, 'bg-yellow-500'],
  ])('colors a %s download with %s', async (status, color) => {
    await render({ status });

    const colors = [...dot().classList].filter((name) => /^bg-\w+-500$/.test(name));
    expect(colors).toEqual([color]);
  });

  it('has no color for a queued download', async () => {
    await render({ status: DownloadStatus.QUEUED });
    expect([...dot().classList].some((name) => name.startsWith('bg-'))).toBe(false);
  });

  it('copies the file path and confirms it', async () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
    await render();

    component.copyToClipboard('/downloads/video.mp4');

    expect(writeText).toHaveBeenCalledWith('/downloads/video.mp4');
    expect(notify).toHaveBeenCalledWith('success', 'File path copied to clipboard.');
    vi.unstubAllGlobals();
  });

  it('sets the file path of this download only', async () => {
    const storage = TestBed.inject(StorageService);
    storage.downloads.set([
      { ...DownloadRecordMock, id: 1, filePath: null },
      { ...DownloadRecordMock, id: 2, filePath: null },
    ]);
    await render({ id: 2 });

    component.setFilePath('/downloads/moved.mp4');

    expect(storage.downloads().map(({ filePath }) => filePath)).toEqual([null, '/downloads/moved.mp4']);
  });
});
