import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCard, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable,
} from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { ConfirmationDialog, NextCheckComponent, SubscriptionDetails } from '@shared/components';
import { filterDefined } from '@shared/helpers';
import { PollType, SubscriptionModel } from '@shared/models';
import { HttpService, StorageService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { filter, Observable, switchMap, take, tap } from 'rxjs';
import { DayPipe } from '../../shared/pipes/day.pipe';
import { NoData } from '../no-data/no-data';

@Component({
  selector: 'rt-subscriptions',
  imports: [
    DatePipe,
    MatCard,
    MatCardContent,
    MatCardHeader,
    MatCardTitle,
    MatCell,
    MatCellDef,
    MatColumnDef,
    MatHeaderCell,
    MatHeaderRow,
    MatHeaderRowDef,
    MatIcon,
    MatButton,
    MatIconButton,
    MatRow,
    MatRowDef,
    MatSlideToggle,
    MatTable,
    MatTooltip,
    MatHeaderCellDef,
    FormsModule,
    NoData,
    DayPipe,
    NextCheckComponent,
    SubscriptionDetails,
  ],
  templateUrl: './subscriptions.html',
  styleUrl: './subscriptions.css',
})
export class SubscriptionsViewComponent implements OnInit {
  private readonly _storage = inject(StorageService);
  private readonly _httpService = inject(HttpService);
  private readonly _dialog = inject(MatDialog);
  private readonly _notifier = inject(NotifierService);

  displayedColumns = [
    'enabled',
    'name',
    'videoName',
    'lastCaptureAt',
    'lastCheckedAt',
    'nextCheckAt',
    'actions',
    'expand',
  ];
  expandedSubscription = signal<number | null>(null);

  readonly pollType: typeof PollType = PollType;
  readonly subscriptions = this._storage.subscriptions;
  readonly settings = this._storage.settings;
  readonly isEnabled = computed(
    () => this.subscriptions().filter((c) => c.enabled).length > 0 && this.settings().enabled,
  );
  showShine = signal(false);
  showFlip = signal(false);

  constructor() {
    effect(() => {
      if (this.subscriptions()?.length) this.showShine.set(true);
      setTimeout(() => this.showShine.set(false), 3000);
    });
  }

  ngOnInit() {
    this._getSubscriptions().subscribe();
  }

  toggleSubscription(enabled: boolean, subscription: SubscriptionModel) {
    this._httpService
      .updateSubscription({ ...subscription, enabled })
      .pipe(
        filterDefined(),
        tap((subscription: SubscriptionModel) => this._updateStorageSubs(subscription)),
      )
      .subscribe();
  }

  editSubscription(sub: SubscriptionModel) {
    this._storage.editingSubscription.set(sub);
    this._storage.showForm.set(true);
  }

  deleteSubscription(id: SubscriptionModel['id']) {
    this._openConfirmationDialog()
      .pipe(
        take(1),
        filter(Boolean),
        switchMap(() => this._httpService.deleteSubscription(id)),
      )
      .subscribe(() => this._storage.subscriptions.set(this._storage.subscriptions().filter((c) => c.id !== id)));
  }

  scan(id: SubscriptionModel['id']) {
    this._httpService
      .scanSubscription(id)
      .pipe(
        tap(() => this._notifier.notify('info', 'Scanned successfully')),
        filterDefined(),
        switchMap(() => this._httpService.getSubscriptions()),
      )
      .subscribe();
  }

  refreshSubscriptions(withAnimation = false): void {
    if (withAnimation) this.showFlip.set(true);

    setTimeout(() => {
      this.showFlip.set(false);

      this._getSubscriptions().subscribe({
        next: (subscriptions) => {
          this._storage.subscriptions.set(subscriptions);
          this._notifier.notify('success', 'Subscriptions refreshed successfully');
        },
        error: () => {
          this._notifier.notify('error', 'Failed to refresh subscriptions');
        },
      });
    }, 1000);
  }

  showForm(): void {
    this._storage.editingSubscription.set(null);
    this._storage.showForm.set(true);
  }

  trackByFn(_index: number, item: SubscriptionModel): SubscriptionModel['id'] {
    return item.id;
  }

  private _getSubscriptions(): Observable<SubscriptionModel[]> {
    return this._httpService.getSubscriptions();
  }

  private _openConfirmationDialog(): Observable<boolean> {
    const dialogRef = this._dialog.open(ConfirmationDialog, {
      restoreFocus: false,
      data: {
        title: 'Confirmation',
        message: 'Are you sure you want to delete this subscription?',
        actionText: 'Delete',
      },
    });

    return dialogRef.afterClosed();
  }

  private _updateStorageSubs(subscription: SubscriptionModel) {
    this._storage.subscriptions.set(
      this._storage.subscriptions().map((c) => (c.id === subscription.id ? subscription : c)) as SubscriptionModel[],
    );
  }
}
