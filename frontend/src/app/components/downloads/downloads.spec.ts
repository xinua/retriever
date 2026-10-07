import { Component, input, output } from '@angular/core';
import { ComponentFixture, DeferBlockState, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { DownloadRecord } from '@shared/components';
import { DefaultFilters, DefaultPaginator, DownloadRecordMock } from '@shared/constants';
import { DownloadInfoModel, DownloadModel, DownloadsPageModel, DownloadStatus, PaginatorModel } from '@shared/models';
import { AnimationService, HttpService, StorageService, WsService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { of, Subject, throwError } from 'rxjs';

import { Downloads } from './downloads';

/** Stands in for the real card, which pulls in drag/scroll tokens and its own services. */
@Component({ selector: 'rt-download-record', template: '{{ download().title }}' })
class DownloadRecordStub {
  download = input.required<DownloadModel>();
  index = input<number>();
  paginator = input<PaginatorModel>();
  cancel = output<DownloadModel>();
  retry = output<DownloadModel>();
  remove = output<{ download: DownloadModel; elementRef: HTMLElement }>();
  saveAs = output<DownloadModel>();
  copyFilePath = output<DownloadModel>();
}

const download = (overrides: Partial<DownloadModel> = {}): DownloadModel => ({ ...DownloadRecordMock, ...overrides });

const page = (items: DownloadModel[], overrides: Partial<DownloadsPageModel> = {}): DownloadsPageModel => ({
  items,
  total: items.length,
  page: 1,
  pages: 1,
  limit: 5,
  ...overrides,
});

const info = (overrides: Partial<DownloadInfoModel> = {}): DownloadInfoModel =>
  ({ total: 0, done: 0, failed: 0, ...overrides }) as DownloadInfoModel;

describe('Downloads', () => {
  let fixture: ComponentFixture<Downloads>;
  let component: Downloads;
  let storage: StorageService;
  let http: Record<
    | 'getDownloads'
    | 'getDownloadsInfo'
    | 'retryDownload'
    | 'cancelDownload'
    | 'deleteDownload'
    | 'clearFinishedDownloads'
    | 'downloadFileUrl'
    | 'getTelegramChats'
    | 'getTelegramStatus',
    ReturnType<typeof vi.fn>
  >;
  let notify: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let animateRemove: ReturnType<typeof vi.fn>;
  let serverPage: DownloadsPageModel;
  let ws: {
    updated: Subject<DownloadModel>;
    batch: Subject<DownloadModel[]>;
    removed: Subject<{ id: number }>;
    cleared: Subject<unknown>;
  };

  beforeEach(async () => {
    serverPage = page([]);
    ws = { updated: new Subject(), batch: new Subject(), removed: new Subject(), cleared: new Subject() };
    notify = vi.fn();
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(true) }));
    animateRemove = vi.fn(() => Promise.resolve());

    http = {
      // Mirrors the real service, which stores the page it fetched.
      getDownloads: vi.fn(() => {
        storage.downloads.set(serverPage.items);
        return of(serverPage);
      }),
      getDownloadsInfo: vi.fn(() => of(info())),
      retryDownload: vi.fn((id: number) => of(download({ id, status: DownloadStatus.QUEUED }))),
      cancelDownload: vi.fn(() => of({ ok: true })),
      deleteDownload: vi.fn(() => of({ ok: true })),
      clearFinishedDownloads: vi.fn(() => of({ ok: true })),
      downloadFileUrl: vi.fn((id: number) => `/api/downloads/${id}/file`),
      getTelegramChats: vi.fn(() => of([])),
      getTelegramStatus: vi.fn(() => of(null)),
    };

    TestBed.configureTestingModule({
      imports: [Downloads],
      providers: [
        { provide: HttpService, useValue: http },
        { provide: NotifierService, useValue: { notify } },
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: AnimationService, useValue: { animateRemoveDownload: animateRemove } },
        {
          provide: WsService,
          useValue: {
            downloadUpdated$: () => ws.updated,
            downloadsBatch$: () => ws.batch,
            downloadRemoved$: () => ws.removed,
            downloadsCleared$: () => ws.cleared,
          },
        },
      ],
    });
    TestBed.overrideComponent(Downloads, {
      remove: { imports: [DownloadRecord] },
      add: { imports: [DownloadRecordStub] },
    });
    await TestBed.compileComponents();

    storage = TestBed.inject(StorageService);
    storage.downloads.set([]);
    storage.filters.set(DefaultFilters);
    storage.paginator.set(DefaultPaginator);
  });

  afterEach(() => vi.useRealTimers());

  async function render() {
    fixture = TestBed.createComponent(Downloads);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function refresh() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const text = (): string => el().textContent.replace(/\s+/g, ' ');
  const records = (): HTMLElement[] => Array.from(el().querySelectorAll('rt-download-record'));
  const key = (k: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent('keydown', { key: k, cancelable: true, ...init });

  describe('loading', () => {
    it('fetches the stored page on init, converting it to the 1-based API page', async () => {
      storage.paginator.set({ total: 0, page: 2, limit: 10 });
      serverPage = page([download()], { page: 3, total: 21 });

      await render();

      expect(http.getDownloads).toHaveBeenCalledWith(3, 10, DefaultFilters, '');
      expect(storage.paginator()).toEqual({ total: 21, page: 2, limit: 10 });
    });

    it('renders a card per download', async () => {
      serverPage = page([download({ id: 1, title: 'First' }), download({ id: 2, title: 'Second' })]);

      await render();

      expect(records()).toHaveLength(2);
      expect(text()).toContain('First');
      expect(text()).toContain('Second');
    });

    it('shows the empty state when there are no downloads', async () => {
      await render();

      expect(records()).toHaveLength(0);
      expect(el().querySelector('rt-no-data')).not.toBeNull();
      expect(text()).toContain('No downloads found');
    });

    it('mentions the search term in the empty state', async () => {
      fixture = TestBed.createComponent(Downloads);
      fixture.componentInstance.searchControl.setValue('cats', { emitEvent: false });
      await fixture.whenStable();

      expect(text()).toContain('No downloads matching: cats');
    });

    it('loads the whole-table counts and stores them', async () => {
      http.getDownloadsInfo.mockReturnValue(of(info({ total: 7, done: 3, failed: 1 })));
      serverPage = page([download()]);

      await render();
      await fixture.getDeferBlocks().then(([block]) => block.render(DeferBlockState.Complete));

      expect(storage.downloadInfo()).toEqual(info({ total: 7, done: 3, failed: 1 }));
      expect(text()).toContain('Total:7');
      expect(text()).toContain('Completed:3');
      expect(text()).toContain('Failed:1');
    });

    it('offers to clear finished downloads only when some are done', async () => {
      serverPage = page([download()]);
      await render();
      expect(text()).not.toContain('Clear finished');

      http.getDownloadsInfo.mockReturnValue(of(info({ total: 1, done: 1 })));
      storage.downloads.set([download({ status: DownloadStatus.DONE })]);
      await refresh();

      expect(text()).toContain('Clear finished');
    });

    it('does not refetch counts when only progress changes', async () => {
      serverPage = page([download({ status: DownloadStatus.RUNNING, progress: 10 })]);
      await render();
      http.getDownloadsInfo.mockClear();

      storage.downloads.set([download({ status: DownloadStatus.RUNNING, progress: 50 })]);
      await refresh();
      expect(http.getDownloadsInfo).not.toHaveBeenCalled();

      storage.downloads.set([download({ status: DownloadStatus.DONE, progress: 100 })]);
      await refresh();
      expect(http.getDownloadsInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasFinished', () => {
    it.each([DownloadStatus.DONE, DownloadStatus.FAILED, DownloadStatus.CANCELED])(
      'is true with a %s row',
      async (s) => {
        await render();
        storage.downloads.set([download({ status: DownloadStatus.RUNNING }), download({ id: 2, status: s })]);
        expect(component.hasFinished()).toBe(true);
      },
    );

    it('is false while everything is still in progress', async () => {
      await render();
      storage.downloads.set([
        download({ status: DownloadStatus.QUEUED }),
        download({ id: 2, status: DownloadStatus.RUNNING }),
      ]);
      expect(component.hasFinished()).toBe(false);
    });
  });

  describe('paging', () => {
    it('stores the new page and fetches it', async () => {
      await render();
      serverPage = page([download()], { page: 2, total: 12 });

      component.onPageChange({ pageIndex: 1, pageSize: 5, length: 12 });

      expect(http.getDownloads).toHaveBeenLastCalledWith(2, 5, DefaultFilters, '');
      expect(storage.paginator()).toEqual({ total: 12, page: 1, limit: 5 });
    });

    it('swiping right goes back a page, never below the first', async () => {
      storage.paginator.set({ total: 20, page: 1, limit: 5 });
      serverPage = page([download()], { page: 2, total: 20 });
      await render();
      const onPageChange = vi.spyOn(component, 'onPageChange');

      component.onSwipe({ direction: 'right' });
      expect(onPageChange).toHaveBeenLastCalledWith({ pageIndex: 0, pageSize: 5, length: 20 });

      storage.paginator.set({ total: 20, page: 0, limit: 5 });
      component.onSwipe({ direction: 'right' });
      expect(onPageChange).toHaveBeenLastCalledWith({ pageIndex: 0, pageSize: 5, length: 20 });
    });

    it('swiping left goes forward a page, never past the last', async () => {
      storage.paginator.set({ total: 20, page: 3, limit: 5 });
      serverPage = page([download()], { page: 4, total: 20 });
      await render();
      const onPageChange = vi.spyOn(component, 'onPageChange');

      storage.paginator.set({ total: 20, page: 1, limit: 5 });
      component.onSwipe({ direction: 'left' });
      expect(onPageChange).toHaveBeenLastCalledWith({ pageIndex: 2, pageSize: 5, length: 20 });

      storage.paginator.set({ total: 12, page: 2, limit: 5 });
      component.onSwipe({ direction: 'left' });
      expect(onPageChange).toHaveBeenLastCalledWith({ pageIndex: 2, pageSize: 5, length: 12 });
    });
  });

  describe('hotkeys', () => {
    beforeEach(async () => {
      storage.paginator.set({ total: 20, page: 1, limit: 5 });
      serverPage = page([download()], { page: 2, total: 20 });
      await render();
    });

    it('opens the search with Ctrl+K and Cmd+K', () => {
      const ctrl = key('k', { ctrlKey: true });
      window.dispatchEvent(ctrl);
      expect(component.showSearch()).toBe(true);
      expect(ctrl.defaultPrevented).toBe(true);

      component.showSearch.set(false);
      window.dispatchEvent(key('K', { metaKey: true }));
      expect(component.showSearch()).toBe(true);
    });

    it('pages with the arrow keys', () => {
      const onPageChange = vi.spyOn(component, 'onPageChange');

      window.dispatchEvent(key('ArrowLeft'));
      expect(onPageChange).toHaveBeenLastCalledWith({ pageIndex: 0, pageSize: 5, length: 20 });

      storage.paginator.set({ total: 20, page: 1, limit: 5 });
      window.dispatchEvent(key('ArrowRight'));
      expect(onPageChange).toHaveBeenLastCalledWith({ pageIndex: 2, pageSize: 5, length: 20 });
    });

    it('ignores the arrow keys while typing', () => {
      const onPageChange = vi.spyOn(component, 'onPageChange');
      const input = el().querySelector('input')!;

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

      expect(onPageChange).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('searches from the first page once typing settles', async () => {
      storage.paginator.set({ total: 20, page: 2, limit: 5 });
      serverPage = page([download()], { page: 3, total: 20 });
      await render();
      vi.useFakeTimers();
      http.getDownloads.mockClear();
      serverPage = page([download()], { total: 4 });

      component.searchControl.setValue('c');
      component.searchControl.setValue('cat');
      vi.advanceTimersByTime(299);
      expect(http.getDownloads).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(http.getDownloads).toHaveBeenCalledExactlyOnceWith(1, 5, DefaultFilters, 'cat');
      expect(storage.paginator()).toEqual({ total: 4, page: 0, limit: 5 });
    });

    it('does not search again for the same term', async () => {
      await render();
      vi.useFakeTimers();
      http.getDownloads.mockClear();

      component.searchControl.setValue('cat');
      vi.advanceTimersByTime(300);
      component.searchControl.setValue('cats');
      component.searchControl.setValue('cat');
      vi.advanceTimersByTime(300);

      expect(http.getDownloads).toHaveBeenCalledTimes(1);
    });
  });

  describe('filtering', () => {
    it('stores the filters and fetches the first page with the current search', async () => {
      storage.paginator.set({ total: 20, page: 2, limit: 5 });
      serverPage = page([download()], { page: 3, total: 20 });
      await render();
      component.searchControl.setValue('cat', { emitEvent: false });
      serverPage = page([download()], { page: 1, total: 2 });
      const filters = { types: [], statuses: [DownloadStatus.DONE] };

      component.filterDownloads(filters);

      expect(storage.filters()).toEqual(filters);
      expect(http.getDownloads).toHaveBeenLastCalledWith(1, 5, filters, 'cat');
      expect(storage.paginator()).toEqual({ total: 2, page: 0, limit: 5 });
    });
  });

  describe('row actions', () => {
    beforeEach(async () => {
      serverPage = page([download({ id: 1, status: DownloadStatus.FAILED }), download({ id: 2 })]);
      await render();
    });

    it('retries a download and merges the returned row in place', () => {
      component.retry(download({ id: 1 }));

      expect(http.retryDownload).toHaveBeenCalledWith(1);
      expect(storage.downloads().map((d) => [d.id, d.status])).toEqual([
        [1, DownloadStatus.QUEUED],
        [2, DownloadStatus.QUEUED],
      ]);
    });

    it('reports a failed retry', () => {
      http.retryDownload.mockReturnValue(throwError(() => new Error('nope')));
      component.retry(download({ id: 1 }));
      expect(notify).toHaveBeenCalledWith('error', 'Could not retry this download.');
    });

    it('cancels a download', () => {
      component.cancel(download({ id: 2 }));
      expect(http.cancelDownload).toHaveBeenCalledWith(2);
      expect(notify).not.toHaveBeenCalled();
    });

    it('reports a failed cancel', () => {
      http.cancelDownload.mockReturnValue(throwError(() => new Error('nope')));
      component.cancel(download({ id: 2 }));
      expect(notify).toHaveBeenCalledWith('error', 'Could not cancel this download.');
    });

    it('wires the card outputs to the actions', () => {
      const retry = vi.spyOn(component, 'retry');
      const card = fixture.debugElement.query((de) => de.componentInstance instanceof DownloadRecordStub)
        .componentInstance as DownloadRecordStub;

      card.retry.emit(download({ id: 1 }));

      expect(retry).toHaveBeenCalledWith(download({ id: 1 }));
    });

    it('copies the file path', () => {
      const writeText = vi.fn(() => Promise.resolve());
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

      component.copyFilePath(download({ filePath: '/downloads/a.mp4' }));

      expect(writeText).toHaveBeenCalledWith('/downloads/a.mp4');
      expect(notify).toHaveBeenCalledWith('success', 'File path copied to clipboard.');
      vi.unstubAllGlobals();
    });
  });

  describe('saveAs', () => {
    beforeEach(async () => render());

    it('clicks a temporary link to the file', () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      component.saveAs(download({ id: 5, fileExists: true }));

      expect(click).toHaveBeenCalledTimes(1);
      const link = click.mock.contexts[0] as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/api/downloads/5/file');
      expect(link.hasAttribute('download')).toBe(true);
      expect(link.isConnected).toBe(false);
      click.mockRestore();
    });

    it('does nothing when the server has no file', () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      component.saveAs(download({ fileExists: false }));
      component.saveAs(download({ fileExists: undefined, filePath: null }));

      expect(click).not.toHaveBeenCalled();
      click.mockRestore();
    });
  });

  describe('remove', () => {
    let row: HTMLElement;
    let container: HTMLDivElement;

    beforeEach(() => {
      row = document.createElement('div');
      container = document.createElement('div');
      container.style.height = '300px';
    });

    it('removes the row, refills the page and resets the container', async () => {
      serverPage = page([download({ id: 1 }), download({ id: 2 })]);
      await render();
      vi.useFakeTimers();
      serverPage = page([download({ id: 2 })]);
      http.getDownloads.mockClear();

      await component.remove(download({ id: 1 }), row, container);

      expect(animateRemove).not.toHaveBeenCalled();
      expect(http.deleteDownload).toHaveBeenCalledWith(1);
      expect(storage.downloads().map((d) => d.id)).toEqual([2]);
      expect(component.isAnimationInProgress()).toBe(true);

      vi.advanceTimersByTime(0);
      expect(component.isAnimationInProgress()).toBe(false);
      expect(container.style.height).toBe('');

      vi.advanceTimersByTime(100);
      expect(http.getDownloads).toHaveBeenCalledExactlyOnceWith(1, 5, DefaultFilters, '');
    });

    it('animates the row out when the page is full', async () => {
      storage.paginator.set({ total: 10, page: 0, limit: 2 });
      serverPage = page([download({ id: 1 }), download({ id: 2 })], { total: 10, limit: 2 });
      await render();
      vi.useFakeTimers();

      await component.remove(download({ id: 1 }), row, container);

      expect(animateRemove).toHaveBeenCalledWith(row, container);
      vi.advanceTimersByTime(AnimationService.REMOVE_DOWNLOAD_DURATION - 1);
      expect(component.isAnimationInProgress()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(component.isAnimationInProgress()).toBe(false);
    });

    it('keeps the row and reports a failed delete', async () => {
      serverPage = page([download({ id: 1 })]);
      await render();
      vi.useFakeTimers();
      http.deleteDownload.mockReturnValue(throwError(() => new Error('nope')));

      await component.remove(download({ id: 1 }), row, container);
      vi.advanceTimersByTime(0);

      expect(storage.downloads().map((d) => d.id)).toEqual([1]);
      expect(notify).toHaveBeenCalledWith('error', 'Could not remove this download.');
      expect(component.isAnimationInProgress()).toBe(false);
    });
  });

  describe('clearFinished', () => {
    beforeEach(async () => {
      serverPage = page([
        download({ id: 1, status: DownloadStatus.DONE }),
        download({ id: 2, status: DownloadStatus.RUNNING }),
        download({ id: 3, status: DownloadStatus.CANCELED }),
      ]);
      await render();
    });

    it('asks for confirmation, then drops finished rows', () => {
      component.clearFinished();

      expect(dialogOpen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ data: expect.objectContaining({ actionText: 'Clear' }) }),
      );
      expect(http.clearFinishedDownloads).toHaveBeenCalled();
      expect(storage.downloads().map((d) => d.id)).toEqual([2]);
    });

    it('does nothing when the dialog is dismissed', () => {
      dialogOpen.mockReturnValue({ afterClosed: () => of(false) });

      component.clearFinished();

      expect(http.clearFinishedDownloads).not.toHaveBeenCalled();
      expect(storage.downloads()).toHaveLength(3);
    });

    it('reports a failed clear', () => {
      http.clearFinishedDownloads.mockReturnValue(throwError(() => new Error('nope')));

      component.clearFinished();

      expect(notify).toHaveBeenCalledWith('error', 'Could not clear the list.');
      expect(storage.downloads()).toHaveLength(3);
    });
  });

  describe('websocket', () => {
    beforeEach(async () => {
      serverPage = page([download({ id: 1, status: DownloadStatus.RUNNING }), download({ id: 2 })]);
      await render();
      vi.useFakeTimers();
      http.getDownloads.mockClear();
      http.getDownloadsInfo.mockClear();
    });

    it('merges an update to a row on the page', () => {
      ws.updated.next(download({ id: 1, status: DownloadStatus.RUNNING, progress: 42 }));

      expect(storage.downloads().find((d) => d.id === 1)?.progress).toBe(42);
      vi.advanceTimersByTime(100);
      expect(http.getDownloads).not.toHaveBeenCalled();
    });

    it('refills the page for a newly queued row instead of prepending it', () => {
      ws.updated.next(download({ id: 9, status: DownloadStatus.QUEUED }));

      expect(storage.downloads().map((d) => d.id)).toEqual([1, 2]);
      vi.advanceTimersByTime(100);
      expect(http.getDownloads).toHaveBeenCalledTimes(1);
    });

    it('refreshes the counts once when off-page rows finish', () => {
      ws.updated.next(download({ id: 9, status: DownloadStatus.CANCELED }));
      ws.updated.next(download({ id: 10, status: DownloadStatus.CANCELED }));
      vi.advanceTimersByTime(100);

      expect(http.getDownloadsInfo).toHaveBeenCalledTimes(1);
      expect(storage.downloads().map((d) => d.id)).toEqual([1, 2]);
    });

    it('ignores progress on an off-page row', () => {
      ws.updated.next(download({ id: 9, status: DownloadStatus.RUNNING }));
      vi.advanceTimersByTime(100);

      expect(http.getDownloads).not.toHaveBeenCalled();
      expect(storage.downloads().map((d) => d.id)).toEqual([1, 2]);
    });

    it('merges a batch and refills once', () => {
      ws.batch.next([
        download({ id: 1, status: DownloadStatus.CANCELED }),
        download({ id: 2, status: DownloadStatus.CANCELED }),
      ]);
      ws.batch.next([download({ id: 2, status: DownloadStatus.CANCELED })]);

      expect(storage.downloads().every((d) => d.status === DownloadStatus.CANCELED)).toBe(true);
      vi.advanceTimersByTime(100);
      expect(http.getDownloads).toHaveBeenCalledTimes(1);
    });

    it('drops a removed row and refills', () => {
      ws.removed.next({ id: 1 });

      expect(storage.downloads().map((d) => d.id)).toEqual([2]);
      vi.advanceTimersByTime(100);
      expect(http.getDownloads).toHaveBeenCalledTimes(1);
    });

    it('drops finished rows when the list is cleared elsewhere', () => {
      storage.downloads.set([download({ id: 1, status: DownloadStatus.DONE }), download({ id: 2 })]);

      ws.cleared.next(undefined);

      expect(storage.downloads().map((d) => d.id)).toEqual([2]);
      vi.advanceTimersByTime(100);
      expect(http.getDownloads).toHaveBeenCalledTimes(1);
    });

    it('steps back a page when a refill lands on a different one', () => {
      storage.paginator.set({ total: 6, page: 1, limit: 5 });
      serverPage = page([download({ id: 2 })], { page: 1, total: 5 });

      ws.removed.next({ id: 1 });
      vi.advanceTimersByTime(100);

      expect(storage.paginator()).toEqual({ total: 5, page: 0, limit: 5 });
    });
  });
});
