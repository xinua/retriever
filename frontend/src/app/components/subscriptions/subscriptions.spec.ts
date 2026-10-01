import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialog, NextCheckComponent, SubscriptionDetails } from '@shared/components';
import { MockSubscription } from '@shared/constants';
import { SubscriptionModel } from '@shared/models';
import { HttpService, StorageService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { of, throwError } from 'rxjs';

import { SubscriptionsViewComponent } from './subscriptions';

/** NextCheck polls the API on its own and has its own spec. */
@Component({ selector: 'rt-next-check', template: '' })
class NextCheckStub {}

/** SubscriptionDetails pulls in its own services and has its own spec. */
@Component({ selector: 'rt-subscription-details', template: '' })
class SubscriptionDetailsStub {
  sub = input.required<SubscriptionModel>();
  isExpanded = input<boolean>(false);
}

const subscription = (overrides: Partial<SubscriptionModel> = {}): SubscriptionModel => ({
  ...MockSubscription,
  ...overrides,
});

describe('SubscriptionsViewComponent', () => {
  let fixture: ComponentFixture<SubscriptionsViewComponent>;
  let component: SubscriptionsViewComponent;
  let storage: StorageService;
  let http: Record<
    'getSubscriptions' | 'updateSubscription' | 'deleteSubscription' | 'scanSubscription',
    ReturnType<typeof vi.fn>
  >;
  let notify: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    http = {
      getSubscriptions: vi.fn(() => of(storage.subscriptions())),
      updateSubscription: vi.fn((sub: SubscriptionModel) => of(sub)),
      deleteSubscription: vi.fn(() => of(null)),
      scanSubscription: vi.fn(() => of({ ok: true })),
    };
    notify = vi.fn();
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(true) }));

    await TestBed.configureTestingModule({
      imports: [SubscriptionsViewComponent],
      providers: [
        { provide: HttpService, useValue: http },
        { provide: NotifierService, useValue: { notify } },
        { provide: MatDialog, useValue: { open: dialogOpen } },
      ],
    })
      .overrideComponent(SubscriptionsViewComponent, {
        remove: { imports: [NextCheckComponent, SubscriptionDetails] },
        add: { imports: [NextCheckStub, SubscriptionDetailsStub] },
      })
      .compileComponents();

    storage = TestBed.inject(StorageService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function render(subscriptions: SubscriptionModel[] = []) {
    storage.subscriptions.set(subscriptions);
    fixture = TestBed.createComponent(SubscriptionsViewComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function refresh() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const text = (): string => el().textContent.replace(/\s+/g, ' ');
  const rows = (): HTMLTableRowElement[] =>
    Array.from(el().querySelectorAll('tr.mat-mdc-row:not(.subscription-detail-row)'));
  const buttonByText = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent.includes(label));
  const rowButton = (row: HTMLElement, icon: string): HTMLButtonElement =>
    Array.from(row.querySelectorAll('button')).find((b) => b.querySelector('mat-icon')?.textContent.trim() === icon)!;
  const details = (): HTMLElement[] => Array.from(el().querySelectorAll('rt-subscription-details'));

  describe('init', () => {
    it('loads subscriptions on init', async () => {
      await render();

      expect(http.getSubscriptions).toHaveBeenCalledTimes(1);
    });
  });

  describe('empty state', () => {
    it('shows the no-data placeholder and no table', async () => {
      await render();

      expect(el().querySelector('rt-no-data')).not.toBeNull();
      expect(text()).toContain('No subscriptions found');
      expect(el().querySelector('table')).toBeNull();
    });

    it('opens an empty form from the placeholder button', async () => {
      storage.editingSubscription.set(subscription());
      await render();

      buttonByText('Add subscription')!.click();

      expect(storage.editingSubscription()).toBeNull();
      expect(storage.showForm()).toBe(true);
    });

    it('shows zero totals', async () => {
      await render();

      expect(text()).toContain('Total subscriptions: 0');
      expect(text()).toContain('Active subscriptions: 0');
    });
  });

  describe('table', () => {
    it('renders one row per subscription', async () => {
      await render([
        subscription({ id: 1, name: 'First' }),
        subscription({ id: 2, name: 'Second', lastVideoTitle: 'Latest upload' }),
      ]);

      expect(el().querySelector('rt-no-data')).toBeNull();
      expect(rows().length).toBe(2);
      expect(rows()[0].textContent).toContain('First');
      expect(rows()[1].textContent).toContain('Second');
      expect(rows()[1].textContent).toContain('Latest upload');
    });

    it('shows a dash when there is no last video', async () => {
      await render([subscription({ lastVideoTitle: null })]);

      const cell = rows()[0].querySelector('.mat-column-videoName')!;
      expect(cell.textContent.trim()).toBe('—');
    });

    it('shows a dash for missing dates', async () => {
      await render([subscription({ lastCaptureAt: undefined, lastCheckedAt: undefined, nextCheckAt: undefined })]);

      for (const column of ['lastCaptureAt', 'lastCheckedAt', 'nextCheckAt']) {
        expect(rows()[0].querySelector(`.mat-column-${column}`)!.textContent.trim()).toBe('—');
      }
    });

    it('shows the time for dates that are today', async () => {
      const now = new Date();
      now.setHours(9, 5, 0, 0);
      await render([subscription({ lastCheckedAt: now })]);

      expect(rows()[0].querySelector('.mat-column-lastCheckedAt')!.textContent.trim()).toBe('09:05');
    });

    it('shows a formatted date for older dates', async () => {
      await render([subscription({ lastCaptureAt: new Date(2024, 0, 15, 10, 0) })]);

      expect(rows()[0].querySelector('.mat-column-lastCaptureAt')!.textContent.trim()).toBe('January 15');
    });

    it('hides the next check for disabled subscriptions', async () => {
      const now = new Date();
      now.setHours(9, 5, 0, 0);
      await render([
        subscription({ id: 1, nextCheckAt: now }),
        subscription({ id: 2, enabled: false, nextCheckAt: now }),
      ]);

      expect(rows()[0].querySelector('.mat-column-nextCheckAt')!.textContent.trim()).toBe('09:05');
      expect(rows()[1].querySelector('.mat-column-nextCheckAt')!.textContent.trim()).toBe('—');
    });

    it('shows total and active counts', async () => {
      await render([subscription({ id: 1 }), subscription({ id: 2, enabled: false }), subscription({ id: 3 })]);

      expect(text()).toContain('Total subscriptions: 3');
      expect(text()).toContain('Active subscriptions: 2');
    });

    it('opens an empty form from the header "Add subscription" button', async () => {
      storage.editingSubscription.set(subscription());
      await render([subscription()]);

      buttonByText('Add subscription')!.click();

      expect(storage.editingSubscription()).toBeNull();
      expect(storage.showForm()).toBe(true);
    });

    it('tracks rows by id', async () => {
      await render();

      expect(component.trackByFn(0, subscription({ id: 42 }))).toBe(42);
    });
  });

  describe('isEnabled', () => {
    it('is true when the app is enabled and at least one subscription is enabled', async () => {
      await render([subscription({ id: 1, enabled: false }), subscription({ id: 2, enabled: true })]);
      storage.settings.set({ ...storage.settings(), enabled: true });

      expect(component.isEnabled()).toBe(true);
    });

    it('is false when the app is paused', async () => {
      await render([subscription()]);
      storage.settings.set({ ...storage.settings(), enabled: false });

      expect(component.isEnabled()).toBe(false);
    });

    it('is false when no subscription is enabled', async () => {
      await render([subscription({ enabled: false })]);

      expect(component.isEnabled()).toBe(false);
    });
  });

  describe('toggleSubscription', () => {
    it('sends the new enabled flag and stores the updated subscription', async () => {
      const other = subscription({ id: 2, name: 'Other' });
      await render([subscription({ id: 1, enabled: true }), other]);

      component.toggleSubscription(false, storage.subscriptions()[0]);

      expect(http.updateSubscription).toHaveBeenCalledWith(expect.objectContaining({ id: 1, enabled: false }));
      expect(storage.subscriptions()[0].enabled).toBe(false);
      expect(storage.subscriptions()[1]).toBe(other);
    });

    it('leaves storage untouched on an empty response', async () => {
      await render([subscription({ enabled: true })]);
      const before = storage.subscriptions();
      http.updateSubscription.mockReturnValue(of(null));

      component.toggleSubscription(false, before[0]);

      expect(storage.subscriptions()).toBe(before);
    });

    it('is triggered by the slide toggle without expanding the row', async () => {
      await render([subscription({ id: 1, enabled: true })]);
      await refresh();

      (rows()[0].querySelector('mat-slide-toggle button') as HTMLButtonElement).click();
      await refresh();

      expect(http.updateSubscription).toHaveBeenCalledWith(expect.objectContaining({ id: 1, enabled: false }));
      expect(component.expandedSubscription()).toBeNull();
    });
  });

  describe('editSubscription', () => {
    it('stores the subscription for editing and opens the form', async () => {
      const sub = subscription();
      await render([sub]);

      rowButton(rows()[0], 'edit').click();

      expect(storage.editingSubscription()).toBe(sub);
      expect(storage.showForm()).toBe(true);
      expect(component.expandedSubscription()).toBeNull();
    });
  });

  describe('deleteSubscription', () => {
    it('asks for confirmation and removes the subscription when confirmed', async () => {
      await render([subscription({ id: 1 }), subscription({ id: 2 })]);

      rowButton(rows()[0], 'delete').click();

      expect(dialogOpen).toHaveBeenCalledWith(ConfirmationDialog, {
        restoreFocus: false,
        data: {
          title: 'Confirmation',
          message: 'Are you sure you want to delete this subscription?',
          actionText: 'Delete',
        },
      });
      expect(http.deleteSubscription).toHaveBeenCalledWith(1);
      expect(storage.subscriptions().map((s) => s.id)).toEqual([2]);
      expect(component.expandedSubscription()).toBeNull();
    });

    it('does nothing when the dialog is dismissed', async () => {
      dialogOpen.mockReturnValue({ afterClosed: () => of(false) });
      await render([subscription({ id: 1 })]);

      component.deleteSubscription(1);

      expect(http.deleteSubscription).not.toHaveBeenCalled();
      expect(storage.subscriptions().length).toBe(1);
    });
  });

  describe('scan', () => {
    it('scans, notifies and reloads subscriptions', async () => {
      await render([subscription({ id: 7 })]);
      http.getSubscriptions.mockClear();

      rowButton(rows()[0], 'track_changes').click();

      expect(http.scanSubscription).toHaveBeenCalledWith(7);
      expect(notify).toHaveBeenCalledWith('info', 'Scanned successfully');
      expect(http.getSubscriptions).toHaveBeenCalledTimes(1);
    });

    it('does not reload on an empty scan response', async () => {
      http.scanSubscription.mockReturnValue(of(null));
      await render([subscription({ id: 7 })]);
      http.getSubscriptions.mockClear();

      component.scan(7);

      expect(notify).toHaveBeenCalledWith('info', 'Scanned successfully');
      expect(http.getSubscriptions).not.toHaveBeenCalled();
    });

    it('disables the scan button while the app is paused', async () => {
      storage.settings.set({ ...storage.settings(), enabled: false });
      await render([subscription()]);

      expect(rowButton(rows()[0], 'track_changes').disabled).toBe(true);
    });

    it('enables the scan button while the app is running', async () => {
      storage.settings.set({ ...storage.settings(), enabled: true });
      await render([subscription()]);

      expect(rowButton(rows()[0], 'track_changes').disabled).toBe(false);
    });
  });

  describe('expanding rows', () => {
    it('expands and collapses a row by clicking it', async () => {
      await render([subscription({ id: 1 }), subscription({ id: 2 })]);

      rows()[1].click();
      await refresh();
      expect(component.expandedSubscription()).toBe(2);

      rows()[1].click();
      await refresh();
      expect(component.expandedSubscription()).toBeNull();
    });

    it('expands and collapses a row with the arrow button', async () => {
      await render([subscription({ id: 1 })]);
      const arrow = () => rowButton(rows()[0], 'keyboard_arrow_down');

      arrow().click();
      await refresh();
      expect(component.expandedSubscription()).toBe(1);
      expect(arrow().classList).toContain('toggle-button-expanded');

      arrow().click();
      await refresh();
      expect(component.expandedSubscription()).toBeNull();
      expect(arrow().classList).not.toContain('toggle-button-expanded');
    });

    it('only one row is expanded at a time', async () => {
      await render([subscription({ id: 1 }), subscription({ id: 2 })]);

      rows()[0].click();
      await refresh();
      rows()[1].click();
      await refresh();

      expect(component.expandedSubscription()).toBe(2);
    });

    it('renders details for every subscription', async () => {
      await render([subscription({ id: 1 }), subscription({ id: 2, enabled: false })]);

      expect(details().length).toBe(2);
      const detailCells = el().querySelectorAll('tr.subscription-detail-row td');
      expect(detailCells[0].classList).not.toContain('app-disabled');
      expect(detailCells[1].classList).toContain('app-disabled');
    });
  });

  describe('refreshSubscriptions', () => {
    it('reloads, stores and notifies after a delay', async () => {
      await render([subscription({ id: 1 })]);
      vi.useFakeTimers();
      const fresh = [subscription({ id: 1 }), subscription({ id: 2 })];
      http.getSubscriptions.mockClear();
      http.getSubscriptions.mockReturnValue(of(fresh));

      component.refreshSubscriptions();
      expect(http.getSubscriptions).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);

      expect(http.getSubscriptions).toHaveBeenCalledTimes(1);
      expect(storage.subscriptions()).toBe(fresh);
      expect(notify).toHaveBeenCalledWith('success', 'Subscriptions refreshed successfully');
    });

    it('notifies an error when reloading fails', async () => {
      await render([subscription({ id: 1 })]);
      vi.useFakeTimers();
      const before = storage.subscriptions();
      http.getSubscriptions.mockReturnValue(throwError(() => new Error('boom')));

      component.refreshSubscriptions();
      vi.advanceTimersByTime(1000);

      expect(storage.subscriptions()).toBe(before);
      expect(notify).toHaveBeenCalledWith('error', 'Failed to refresh subscriptions');
    });

    it('plays the flip animation only when asked', async () => {
      await render();
      vi.useFakeTimers();

      component.refreshSubscriptions();
      expect(component.showFlip()).toBe(false);

      component.refreshSubscriptions(true);
      expect(component.showFlip()).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(component.showFlip()).toBe(false);
    });
  });

  describe('shine animation', () => {
    it('shines when subscriptions are present and stops after 3 seconds', async () => {
      vi.useFakeTimers();
      storage.subscriptions.set([subscription()]);
      fixture = TestBed.createComponent(SubscriptionsViewComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      expect(component.showShine()).toBe(true);
      expect(el().querySelector('.shine-line')).not.toBeNull();

      vi.advanceTimersByTime(3000);
      fixture.detectChanges();

      expect(component.showShine()).toBe(false);
      expect(el().querySelector('.shine-line')).toBeNull();
    });

    it('does not shine without subscriptions', async () => {
      await render();

      expect(component.showShine()).toBe(false);
      expect(el().querySelector('.shine-line')).toBeNull();
    });
  });
});
