import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NotifierService } from 'angular-notifier';
import { of } from 'rxjs';
import { Decision } from '../decision-dialog/decision-dialog';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { DownloadRecordMock } from '../../constants/mocks.const';
import { DownloadControls } from './download-controls';
import { provideNotifier } from '../../providers/notifier.provider';

describe('DownloadControls', () => {
  let component: DownloadControls;
  let fixture: ComponentFixture<DownloadControls>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadControls],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNotifier()],
    }).compileComponents();

    fixture = TestBed.createComponent(DownloadControls);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function render(overrides: Partial<DownloadModel> = {}) {
    fixture.componentRef.setInput('download', { ...DownloadRecordMock, ...overrides });
    await fixture.whenStable();
  }

  const buttons = (): HTMLButtonElement[] => [...fixture.nativeElement.querySelectorAll('button')];

  it.each([DownloadStatus.QUEUED, DownloadStatus.RUNNING])('hides the controls while %s', async (status) => {
    await render({ status });
    expect(buttons()).toEqual([]);
  });

  it.each([DownloadStatus.DONE, DownloadStatus.FAILED, DownloadStatus.CANCELED])(
    'shows remove and more actions once %s',
    async (status) => {
      await render({ status });
      expect(buttons()).toHaveLength(2);
    },
  );

  it('emits remove', async () => {
    const remove = vi.fn();
    component.remove.subscribe(remove);
    await render({ status: DownloadStatus.DONE });

    buttons()[0].click();
    expect(remove).toHaveBeenCalled();
  });

  it('knows whether the download has a file', async () => {
    await render({ filePath: '/downloads/video.mp4', fileExists: undefined });
    expect(component.hasFile()).toBe(true);

    await render({ filePath: '/downloads/video.mp4', fileExists: false });
    expect(component.hasFile()).toBe(false);

    await render({ filePath: null, fileExists: undefined });
    expect(component.hasFile()).toBe(false);
  });

  it('saves a trimmed file path and confirms it', async () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
    await render({ id: 5, status: DownloadStatus.DONE });
    component.filePath = ' moved/video.mp4 ';

    component.setFilePath(component.filePath, component.download());

    const request = httpMock.expectOne('/api/downloads/5/path');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ path: 'moved/video.mp4', force: false });

    request.flush({ ...DownloadRecordMock, id: 5 });
    expect(notify).toHaveBeenCalledWith('success', 'File path successfully updated.');
    expect(component.filePath).toBe('');
  });

  describe('when another record already points at the file', () => {
    const conflict = {
      error: 'Another record already points to this file',
      conflict: { id: 9, title: 'Other', index: 3 },
    };

    function answerWith(decision: Decision | undefined) {
      vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
        afterClosed: () => of(decision),
      } as unknown as MatDialogRef<unknown, Decision>);
    }

    it('saves again with force once confirmed', async () => {
      const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
      answerWith(Decision.CONFIRM);
      await render({ id: 5, status: DownloadStatus.DONE });

      component.setFilePath('moved/video.mp4', component.download());
      httpMock.expectOne('/api/downloads/5/path').flush(conflict, { status: 409, statusText: 'Conflict' });

      const forced = httpMock.expectOne('/api/downloads/5/path');
      expect(forced.request.body).toEqual({ path: 'moved/video.mp4', force: true });

      forced.flush({ ...DownloadRecordMock, id: 5 });
      expect(notify).toHaveBeenCalledWith('success', 'File path successfully updated.');
      expect(notify).not.toHaveBeenCalledWith('error', expect.anything());
    });

    it('changes nothing when cancelled', async () => {
      const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
      answerWith(undefined);
      await render({ id: 5, status: DownloadStatus.DONE });

      component.setFilePath('moved/video.mp4', component.download());
      httpMock.expectOne('/api/downloads/5/path').flush(conflict, { status: 409, statusText: 'Conflict' });

      httpMock.expectNone('/api/downloads/5/path');
      expect(notify).not.toHaveBeenCalled();
    });
  });

  it('reports any other failure of the silent request itself', async () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
    await render({ id: 5, status: DownloadStatus.DONE });

    component.setFilePath('nowhere.mp4', component.download());
    httpMock
      .expectOne('/api/downloads/5/path')
      .flush({ error: 'No file at that path' }, { status: 404, statusText: 'Not Found' });

    expect(notify).toHaveBeenCalledWith('error', 'No file at that path (status: 404)');
  });

  it('does not save a blank file path', async () => {
    await render({ status: DownloadStatus.DONE });

    component.setFilePath('   ', component.download());
    httpMock.expectNone(() => true);
  });
});
