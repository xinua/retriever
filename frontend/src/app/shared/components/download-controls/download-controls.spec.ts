import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NotifierService } from 'angular-notifier';
import { of } from 'rxjs';
import { Decision } from '../decision-dialog/decision-dialog';
import { ChoiseResult } from '../remember-choise-dialog/remember-choise-dialog';
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

  describe('removing', () => {
    afterEach(() => localStorage.removeItem('rememberChoise'));

    function answerWith(result: ChoiseResult | undefined) {
      return vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
        afterClosed: () => of(result),
      } as unknown as MatDialogRef<unknown, ChoiseResult>);
    }

    it('removes the record on a click on the delete button', async () => {
      const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
      await render({ id: 5, status: DownloadStatus.DONE });

      buttons()[0].click();

      const request = httpMock.expectOne('/api/downloads/5');
      expect(request.request.method).toBe('DELETE');
      expect(request.request.params.has('withFile')).toBe(false);

      request.flush({ ok: true });
      expect(notify).toHaveBeenCalledWith('success', 'Record removed.');
    });

    it('reports a failed record removal', async () => {
      const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
      await render({ id: 5, status: DownloadStatus.DONE });

      component.removeRecord();
      httpMock.expectOne('/api/downloads/5').flush(null, { status: 500, statusText: 'Server Error' });

      expect(notify).toHaveBeenCalledWith('error', 'Could not remove this record.');
    });

    it('does nothing for a record without a file', async () => {
      const open = answerWith({ value: true, rememberChoise: false });
      await render({ id: 5, status: DownloadStatus.DONE, fileExists: false });

      component.removeFile();

      expect(open).not.toHaveBeenCalled();
      httpMock.expectNone(() => true);
    });

    it('removes the file once confirmed', async () => {
      const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
      answerWith({ value: true, rememberChoise: false });
      await render({ id: 5, status: DownloadStatus.DONE, fileExists: true });

      component.removeFile();

      const request = httpMock.expectOne((req) => req.url === '/api/downloads/5');
      expect(request.request.method).toBe('DELETE');
      expect(request.request.params.get('withFile')).toBe('true');

      request.flush({ ok: true, fileDeleted: true });
      expect(notify).toHaveBeenCalledWith('success', 'File removed.');
      expect(localStorage.getItem('rememberChoise')).toBeNull();
    });

    it('remembers the choice and skips the dialog next time', async () => {
      const open = answerWith({ value: true, rememberChoise: true });
      await render({ id: 5, status: DownloadStatus.DONE, fileExists: true });

      component.removeFile();
      httpMock.expectOne((req) => req.url === '/api/downloads/5').flush({ ok: true, fileDeleted: true });
      expect(localStorage.getItem('rememberChoise')).toBe('true');

      component.removeFile();
      httpMock.expectOne((req) => req.url === '/api/downloads/5').flush({ ok: true, fileDeleted: true });
      expect(open).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['cancelled', { value: false, rememberChoise: true }],
      ['dismissed', undefined],
    ])('keeps the file when the dialog is %s', async (_, result) => {
      answerWith(result);
      await render({ id: 5, status: DownloadStatus.DONE, fileExists: true });

      component.removeFile();

      httpMock.expectNone(() => true);
      expect(localStorage.getItem('rememberChoise')).toBeNull();
    });
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

    component.fixPath(component.filePath, component.download());

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

      component.fixPath('moved/video.mp4', component.download());
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

      component.fixPath('moved/video.mp4', component.download());
      httpMock.expectOne('/api/downloads/5/path').flush(conflict, { status: 409, statusText: 'Conflict' });

      httpMock.expectNone('/api/downloads/5/path');
      expect(notify).not.toHaveBeenCalled();
    });
  });

  it('reports any other failure of the silent request itself', async () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
    await render({ id: 5, status: DownloadStatus.DONE });

    component.fixPath('nowhere.mp4', component.download());
    httpMock
      .expectOne('/api/downloads/5/path')
      .flush({ error: 'No file at that path' }, { status: 404, statusText: 'Not Found' });

    expect(notify).toHaveBeenCalledWith('error', 'No file at that path (status: 404)');
  });

  it('does not save a blank file path', async () => {
    await render({ status: DownloadStatus.DONE });

    component.fixPath('   ', component.download());
    httpMock.expectNone(() => true);
  });

  it('hides the controls while the file is being moved', async () => {
    await render({ status: DownloadStatus.DONE, move: { copied: 1, total: 2 } });
    expect(buttons()).toEqual([]);
  });

  describe('moving the file', () => {
    it('moves to a trimmed folder and confirms a move that is already done', async () => {
      const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
      await render({ id: 5, status: DownloadStatus.DONE, filePath: 'ep1.mkv' });

      component.moveFile(' movies/ ', component.download());

      const request = httpMock.expectOne('/api/downloads/5/move');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ folder: 'movies/' });

      request.flush({ ...DownloadRecordMock, id: 5, filePath: 'movies/ep1.mkv', move: null });
      expect(notify).toHaveBeenCalledWith('success', 'File moved.');
    });

    it('leaves a copy to another filesystem for the server to report', async () => {
      const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
      await render({ id: 5, status: DownloadStatus.DONE, filePath: 'ep1.mkv' });

      component.moveFile('/tank/movies', component.download());

      httpMock
        .expectOne('/api/downloads/5/move')
        .flush(
          { ...DownloadRecordMock, id: 5, move: { copied: 0, total: 100 } },
          { status: 202, statusText: 'Accepted' },
        );
      expect(notify).not.toHaveBeenCalled();
    });

    it.each([
      ['anime/show/ep1.mkv', '/anime//show/'],
      ['ep1.mkv', '/'],
    ])('sends nothing when %s is already in %s', async (filePath, folder) => {
      await render({ status: DownloadStatus.DONE, filePath });

      component.moveFile(folder, component.download());
      httpMock.expectNone(() => true);
    });

    it('does not move to a blank folder', async () => {
      await render({ status: DownloadStatus.DONE });

      component.moveFile('  ', component.download());
      httpMock.expectNone(() => true);
    });
  });
});
