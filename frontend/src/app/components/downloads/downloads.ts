import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCard, MatCardContent, MatCardHeader, MatCardSubtitle, MatCardTitle } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatInput, MatLabel } from '@angular/material/input';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { Badge, DownloadRecord } from '@shared/components';
import { AppearDirective, BgDirective } from '@shared/directives';
import { DownloadInfoModel, DownloadModel, DownloadsPageModel, DownloadStatus, Platform } from '@shared/models';
import { AnimationService, HttpService, StorageService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { debounceTime, distinctUntilChanged, finalize, forkJoin, iif, Observable, Subject, switchMap, tap } from 'rxjs';
import { WsService } from '../../shared/services/ws.service';
import { NoData } from '../no-data/no-data';
import { DOWNLOADS_STATUS_FILTERS } from './downloads.const';

/** Long enough to merge a delete's HTTP response with its own broadcast. */
const REFILL_DEBOUNCE_MS = 100;

@Component({
  selector: 'rt-downloads',
  imports: [
    MatCard,
    MatCardContent,
    MatCardHeader,
    MatCardTitle,
    MatIcon,
    MatIconButton,
    MatButton,
    MatInput,
    MatTableModule,
    BgDirective,
    MatCardSubtitle,
    AsyncPipe,
    MatPaginator,
    MatFormField,
    MatLabel,
    ReactiveFormsModule,
    NoData,
    Badge,
    DownloadRecord,
    AppearDirective,
  ],
  templateUrl: './downloads.html',
  styleUrl: './downloads.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Downloads implements OnInit {
  private readonly _storage = inject(StorageService);
  private readonly _httpService = inject(HttpService);
  private readonly _wsService = inject(WsService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _notifier = inject(NotifierService);
  private readonly _animationService = inject(AnimationService);

  @HostListener('window:keydown', ['$event'])
  handleHotkeys(event: KeyboardEvent) {
    // Open search by Ctrl/Cmd + K
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.showSearch.set(true);
      this.searchField()?.nativeElement?.focus();
    }

    // Ignore typing targets (focused inputs, textareas, selects)
    if (this._isTypingTarget(event)) {
      return;
    }

    // Navigate through pages with ArrowLeft
    if (event.key.toLowerCase() === 'arrowleft') {
      event.preventDefault();
      this.onPageChange({
        pageIndex: Math.max(this.paginator().page - 1, 0),
        pageSize: this.paginatorSize(),
        length: this.paginator().total,
      });
    }

    // Navigate through pages with ArrowRight
    if (event.key.toLowerCase() === 'arrowright') {
      event.preventDefault();
      this.onPageChange({
        pageIndex: Math.min(this.paginator().page + 1, Math.floor(this.paginator().total / this.paginator().limit)),
        pageSize: this.paginatorSize(),
        length: this.paginator().total,
      });
    }
  }

  readonly status = DownloadStatus;
  readonly downloadInfo$: Observable<DownloadInfoModel>;
  readonly platform = Platform;
  readonly statuses = DOWNLOADS_STATUS_FILTERS;

  downloads = this._storage.downloads;
  progressValue = signal(0);

  paginator = this._storage.paginator;
  filters = this._storage.filters;
  filters$ = toObservable(this.filters);
  searchControl = new FormControl<string>('');
  showSearch = signal<boolean>(false);
  isAnimationInProgress = signal<boolean>(false);

  searchField = viewChild<ElementRef<HTMLInputElement>>('searchField');

  hasFinished = computed(() => this.downloads().some((d) => this._isFinished(d)));
  paginatorSize = computed(() => this.paginator().limit);

  private readonly _refill$ = new Subject<void>();

  constructor() {
    this.downloadInfo$ = toObservable(this.downloads).pipe(
      distinctUntilChanged((a, b) => a.length === b.length),
      switchMap(() => this._httpService.getDownloadsInfo()),
    );

    effect(() => {
      this._storage.filters.set(this.filters());
      if (!!this.filters()[0]) this.searchControl.setValue('');
    });
  }

  ngOnInit() {
    this._fetchDownloads()
      .pipe(switchMap(() => this._checkDownloadFiles()))
      .subscribe();

    this._trackSearch()
      .pipe(switchMap(() => this._checkDownloadFiles()))
      .subscribe();

    this._trackRefill().subscribe((result) => this._syncPage(result));

    this._wsService
      .downloadUpdated$()
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        tap((download) => this._upsert(download)),
      )
      .subscribe();

    this._wsService
      .downloadsBatch$()
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        tap((rows) => this._upsertMany(rows)),
        tap(() => this._refill$.next()),
      )
      .subscribe();

    this._wsService
      .downloadRemoved$()
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        tap(({ id }) => {
          this.downloads.update((rows) => rows.filter((r) => r.id !== id));
          this._refill$.next();
        }),
      )
      .subscribe();

    this._wsService
      .downloadsCleared$()
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        tap(() => {
          this.downloads.update((rows) => rows.filter((r) => !this._isFinished(r)));
          this._refill$.next();
        }),
      )
      .subscribe();
  }

  onPageChange(event: PageEvent) {
    this.paginator.set({ total: event.length, page: event.pageIndex, limit: event.pageSize });
    this._fetchDownloads()
      .pipe(switchMap(() => this._checkDownloadFiles()))
      .subscribe();
  }

  trackById(_index: number, download: DownloadModel) {
    return download.id;
  }

  retry(download: DownloadModel) {
    this._httpService.retryDownload(download.id).subscribe({
      next: (row) => this._upsert(row),
      error: () => this._notifier.notify('error', 'Could not retry this download.'),
    });
  }

  cancel(download: DownloadModel) {
    this._httpService.cancelDownload(download.id).subscribe({
      error: () => this._notifier.notify('error', 'Could not cancel this download.'),
    });
  }

  saveAs(download: DownloadModel) {
    if (!download.filePath) return;

    const link = document.createElement('a');

    link.href = this._httpService.downloadFileUrl(download.id);
    link.download = '';
    link.rel = 'noopener';

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  copyFilePath(download: DownloadModel) {
    navigator.clipboard.writeText(download.filePath);
    this._notifier.notify('success', 'File path copied to clipboard.');
  }

  async remove(download: DownloadModel, elementRef: HTMLElement, downloadsContainer: HTMLDivElement) {
    let animationDuration = 0;

    if (this._storage.downloads().length === this.paginator().limit) {
      await this._animationService.animateRemoveDownload(elementRef, downloadsContainer);
      animationDuration = AnimationService.REMOVE_DOWNLOAD_DURATION;
      this.isAnimationInProgress.set(true);
    }

    this._httpService
      .deleteDownload(download.id)
      .pipe(
        finalize(() => {
          setTimeout(() => {
            downloadsContainer.style.height = '';
            this.isAnimationInProgress.set(false);
          }, animationDuration);
        }),
      )
      .subscribe({
        next: () => {
          this.downloads.update((rows) => rows.filter((r) => r.id !== download.id));
          this._refill$.next();
        },
        error: () => this._notifier.notify('error', 'Could not remove this download.'),
      });
  }

  filter(status: DownloadStatus | null) {
    this.filters.set([status]);
    this.searchControl.setValue('');
    this._httpService
      .getDownloads(1, this.paginator().limit, this.filters())
      .pipe(
        tap((result: DownloadsPageModel) =>
          this.paginator.update((current) => ({ ...current, total: result.total, page: result.page - 1 })),
        ),
      )
      .subscribe();
  }

  clearFinished() {
    this._httpService.clearFinishedDownloads().subscribe({
      next: () => {
        this.downloads.update((rows) => rows.filter((r) => !this._isFinished(r)));
        this._refill$.next();
      },
      error: () => this._notifier.notify('error', 'Could not clear the list.'),
    });
  }

  private _trackRefill(): Observable<DownloadsPageModel> {
    return this._refill$.pipe(
      takeUntilDestroyed(this._destroyRef),
      debounceTime(REFILL_DEBOUNCE_MS),
      switchMap(() =>
        this._httpService.getDownloads(this.paginator().page + 1, this.paginator().limit, this.filters()),
      ),
      tap((result: DownloadsPageModel) => this.paginator.update((current) => ({ ...current, total: result.total }))),
    );
  }

  private _fetchDownloads(): Observable<DownloadsPageModel> {
    return iif(
      () => !!this.searchControl.value,
      this._httpService.searchDownloads(this.searchControl.value, this.paginator().limit, this.paginator().page + 1),
      this._httpService.getDownloads(this.paginator().page + 1, this.paginator().limit, this.filters()),
    ).pipe(
      tap((result: DownloadsPageModel) =>
        this.paginator.update((current) => ({ ...current, total: result.total, page: result.page - 1 })),
      ),
    );
  }

  private _trackSearch(): Observable<DownloadsPageModel> {
    return this.searchControl.valueChanges.pipe(
      takeUntilDestroyed(this._destroyRef),
      debounceTime(300),
      distinctUntilChanged(),
      tap(() => this.filters.set([null])),
      switchMap((value) => this._httpService.searchDownloads(value, this.paginator().limit, 1)),
      tap((result: DownloadsPageModel) =>
        this.paginator.update((current) => ({ ...current, total: result.total, page: 0 })),
      ),
    );
  }

  private _checkDownloadFiles(): Observable<boolean[]> {
    return forkJoin(
      this.downloads().map((download) =>
        this._httpService
          .checkDownloadFile(download.id)
          .pipe(
            tap((result) =>
              this.downloads.update((downloads) =>
                downloads.map((d) => (d.id === download.id ? { ...d, filePath: result ? d.filePath : null } : d)),
              ),
            ),
          ),
      ),
    );
  }

  private _syncPage(result: DownloadsPageModel): void {
    const served = Math.max(result.page - 1, 0);

    if (served !== this.paginator().page) {
      this.paginator.update((current) => ({ ...current, total: result.total, page: served }));
    }
  }

  private _isFinished(download: DownloadModel): boolean {
    return (
      download.status === DownloadStatus.DONE ||
      download.status === DownloadStatus.FAILED ||
      download.status === DownloadStatus.CANCELED
    );
  }

  private _upsert(download: DownloadModel) {
    this._storage.upsertDownloads([download]);
  }

  private _upsertMany(incoming: DownloadModel[]) {
    this._storage.upsertDownloads(incoming);
  }

  private _isTypingTarget(event: KeyboardEvent): boolean {
    const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;

    if (!target) {
      return false;
    }

    return target.isContentEditable || ['input', 'textarea', 'select'].includes(target.tagName?.toLowerCase());
  }
}
