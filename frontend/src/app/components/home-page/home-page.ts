import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
import { Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { SectionLabels } from '@shared/constants';
import {
  SubscriptionPayload,
  DownloadStatus,
  HomeSection,
  NextCheckModel,
  NextCheckPayload,
  NotificationPayload,
} from '@shared/models';
import { HttpService, LayoutService, WsService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { filter, finalize, Observable, tap } from 'rxjs';
import { PAGE_ELEMENTS } from '../../shared/constants/page-elements.const';
import { BgDirective } from '../../shared/directives';
import { StorageService } from '../../shared/services';
import { ScrollToService } from '../../shared/services/scroll-to.service';
import { SubscriptionsViewComponent } from '../subscriptions/subscriptions';
import { Downloads } from '../downloads/downloads';
import { Header } from '../header/header';
import { ManualFormComponent } from '../manual-form/manual-form.component';
import { SubscriptionForm } from '../subscription-form/subscription-form';

@Component({
  selector: 'rt-home-page',
  templateUrl: 'home-page.html',
  styleUrl: './home-page.css',
  imports: [
    Header,
    SubscriptionsViewComponent,
    SubscriptionForm,
    Downloads,
    BgDirective,
    ManualFormComponent,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
    MatIcon,
    MatTooltip,
    MatButton,
  ],
  providers: [
    ScrollToService,
    {
      provide: PAGE_ELEMENTS,
      useFactory: () => {
        const page = inject(HomePage);
        return [
          { name: 'header', element: page.header },
          { name: 'mainForm', element: page.mainForm },
          { name: 'subscriptions', element: page.subscriptions },
          { name: 'downloads', element: page.downloads },
        ];
      },
    },
  ],
})
export class HomePage implements OnInit {
  private readonly _storage = inject(StorageService);
  private readonly _wsService = inject(WsService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _layout = inject(LayoutService);
  private readonly _http = inject(HttpService);
  private readonly _notifier = inject(NotifierService);

  settings = this._storage.settings;
  showForm = this._storage.showForm;

  readonly sections = HomeSection;
  readonly sectionLabels = SectionLabels;

  header = viewChild<ElementRef<Header>>('header');
  mainForm = viewChild<ElementRef<ManualFormComponent>>('mainForm');
  subscriptions = viewChild<ElementRef<SubscriptionsViewComponent>>('subscriptions');
  downloads = viewChild<ElementRef<Downloads>>('downloads');

  sectionOrder = this._layout.sectionOrder;

  /**
   * Every section stays mounted whatever the order, because the components
   * do more than render: Downloads loads the queue and subscribes to the
   * websocket from its own ngOnInit. Dropping it from the template would
   * mean the queue is never fetched, so an empty list could never fill.
   *
   * Downloads hides itself while the queue is empty, leaving a zero-height
   * item — so the grip is hidden too rather than offering a drag of nothing.
   */
  /**
   * Queued or running — what a stop-all would actually affect. Read from the
   * whole-table counts, not the loaded rows: those are one page, so they would
   * cap the number at the paginator's limit.
   */
  activeCount = computed(() => {
    const info = this._storage.downloadInfo();

    return info ? info[DownloadStatus.QUEUED] + info[DownloadStatus.RUNNING] : 0;
  });

  stopping = signal(false);

  hasContent = computed(() => ({
    [HomeSection.SUBSCRIPTIONS]: true,
    [HomeSection.DOWNLOADS]: this._storage.downloads().length > 0,
  }));

  ngOnInit() {
    this._serverNotifications().subscribe();

    this._nextCheckUpdates().subscribe();

    this._subscriptionUpdates().subscribe();
  }

  /**
   * Deliberately has no confirmation step: this exists for the moment a
   * pasted playlist turns out to be hundreds of videos, and a dialog is the
   * opposite of what is wanted then. Cancelled rows keep their retry button.
   */
  stopAll() {
    if (this.stopping() || !this.activeCount()) return;

    this.stopping.set(true);

    this._http
      .cancelAllDownloads()
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        finalize(() => this.stopping.set(false)),
      )
      .subscribe({
        next: ({ canceled }) =>
          this._notifier.notify('success', `Stopped ${canceled} download${canceled === 1 ? '' : 's'}`),
        error: () => this._notifier.notify('error', 'Could not stop the downloads.'),
      });
  }

  drop(event: CdkDragDrop<HomeSection[]>) {
    const order = this.sectionOrder();
    const moved = order[event.previousIndex];
    const target = order[event.currentIndex];

    if (!moved || !target) return;

    this._layout.moveSection(moved, target);
  }

  private _serverNotifications(): Observable<NotificationPayload> {
    return this._wsService.notifications$().pipe(
      takeUntilDestroyed(this._destroyRef),
      tap((notification) => this._notifier.notify(notification.type, notification.message)),
    );
  }

  private _nextCheckUpdates(): Observable<NextCheckPayload> {
    return this._wsService.nextCheck$().pipe(
      takeUntilDestroyed(this._destroyRef),
      filter((response) => response?.ok),
      tap((nextCheck) => this._updateSubscription(nextCheck)),
      tap((nextCheck) => this._storage.nextCheck.set(nextCheck)),
    );
  }

  private _subscriptionUpdates(): Observable<SubscriptionPayload> {
    return this._wsService.subscriptionUpdated$().pipe(
      takeUntilDestroyed(this._destroyRef),
      tap((data) => {
        this._storage.subscriptions.update((subscriptions) =>
          subscriptions.map((subscription) => (subscription.id === data.channel.id ? data.channel : subscription)),
        );
      }),
    );
  }

  private _updateSubscription(nextCheck: NextCheckModel) {
    this._storage.subscriptions.update((subscriptions) => {
      return subscriptions.map((subscription) => {
        if (subscription.id === nextCheck.channel.id) {
          subscription.lastCheckedAt = new Date(this._storage.nextCheck().nextCheckAt);
          subscription.nextCheckAt = new Date(nextCheck.nextCheckAt);
        }
        return subscription;
      });
    });
  }
}
