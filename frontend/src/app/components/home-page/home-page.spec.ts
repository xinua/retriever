import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ComponentFixture, DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { DefaultSectionOrder, MockSubscription, SectionOrderStorageKey } from '@shared/constants';
import {
  DownloadInfoModel,
  DownloadModel,
  HomeSection,
  NextCheckModel,
  NotificationPayload,
  SubscriptionModel,
  SubscriptionPayload,
} from '@shared/models';
import { HttpService, LayoutService, StorageService, WsService } from '@shared/services';
import { NotifierService } from 'angular-notifier';
import { of, Subject, throwError } from 'rxjs';

import { HomePage } from './home-page';

const subscription = (overrides: Partial<SubscriptionModel> = {}): SubscriptionModel => ({
  ...MockSubscription,
  ...overrides,
});

const info = (overrides: Partial<DownloadInfoModel> = {}): DownloadInfoModel =>
  ({ total: 0, queued: 0, running: 0, done: 0, failed: 0, canceled: 0, ...overrides }) as DownloadInfoModel;

/**
 * jsdom has no IntersectionObserver, yet Angular still wires up `@defer (on viewport)`
 * triggers under DeferBlockBehavior.Manual. A no-op observer never fires, so every
 * section stays on its placeholder.
 */
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const nextCheck = (overrides: Partial<NextCheckModel> = {}): NextCheckModel => ({
  ok: true,
  nextCheckAt: '2024-01-01T12:00:00Z',
  channel: { id: MockSubscription.id, name: MockSubscription.name },
  ...overrides,
});

describe('HomePage', () => {
  let fixture: ComponentFixture<HomePage>;
  let component: HomePage;
  let storage: StorageService;
  let layout: LayoutService;
  let http: Record<string, ReturnType<typeof vi.fn>>;
  let notify: ReturnType<typeof vi.fn>;
  let notifications$: Subject<NotificationPayload>;
  let nextCheck$: Subject<NextCheckModel>;
  let subscriptionUpdated$: Subject<SubscriptionPayload>;

  beforeEach(async () => {
    localStorage.removeItem(SectionOrderStorageKey);
    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);

    notifications$ = new Subject();
    nextCheck$ = new Subject();
    subscriptionUpdated$ = new Subject();

    http = {
      cancelAllDownloads: vi.fn(() => of({ ok: true, canceled: 3 })),
    };
    notify = vi.fn();

    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        { provide: HttpService, useValue: http },
        { provide: NotifierService, useValue: { notify } },
        {
          provide: WsService,
          useValue: {
            notifications$: () => notifications$,
            nextCheck$: () => nextCheck$,
            subscriptionUpdated$: () => subscriptionUpdated$,
          },
        },
      ],
      // Keep every section on its placeholder: the real children bring their own
      // HTTP/websocket wiring and are covered by their own specs.
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).compileComponents();

    storage = TestBed.inject(StorageService);
    layout = TestBed.inject(LayoutService);
  });

  afterEach(() => {
    localStorage.removeItem(SectionOrderStorageKey);
    vi.unstubAllGlobals();
  });

  async function render() {
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function refresh() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const stopButton = (): HTMLButtonElement | null => el().querySelector('.stop-all-button');
  const handles = (): HTMLButtonElement[] => Array.from(el().querySelectorAll('.section-handle'));
  const dropEvent = (previousIndex: number, currentIndex: number) =>
    ({ previousIndex, currentIndex }) as CdkDragDrop<HomeSection[]>;

  it('renders a draggable item for every section in the stored order', async () => {
    await render();

    expect(el().querySelectorAll('[cdkDrag]').length).toBe(DefaultSectionOrder.length);
    expect(component.sectionOrder()).toEqual(DefaultSectionOrder);
  });

  describe('activeCount', () => {
    it('is zero without download info', async () => {
      await render();

      expect(component.activeCount()).toBe(0);
    });

    it('sums queued and running downloads only', async () => {
      storage.downloadInfo.set(info({ queued: 4, running: 2, done: 10, failed: 1, total: 17 }));
      await render();

      expect(component.activeCount()).toBe(6);
    });
  });

  describe('stop all button', () => {
    it('is hidden while nothing is active', async () => {
      storage.downloadInfo.set(info({ done: 5 }));
      await render();

      expect(stopButton()).toBeNull();
    });

    it('shows the active count', async () => {
      storage.downloadInfo.set(info({ queued: 2, running: 1 }));
      await render();

      expect(stopButton()!.textContent).toContain('Stop all (3)');
      expect(stopButton()!.disabled).toBe(false);
    });

    it('switches to the stopping state while the request is in flight', async () => {
      const cancel$ = new Subject<{ ok: boolean; canceled: number }>();
      http['cancelAllDownloads'].mockReturnValue(cancel$);
      storage.downloadInfo.set(info({ queued: 2 }));
      await render();

      stopButton()!.click();
      await refresh();

      expect(component.stopping()).toBe(true);
      expect(stopButton()!.disabled).toBe(true);
      expect(stopButton()!.textContent).toContain('Stopping…');

      cancel$.next({ ok: true, canceled: 2 });
      cancel$.complete();
      await refresh();

      expect(component.stopping()).toBe(false);
      expect(stopButton()!.disabled).toBe(false);
    });
  });

  describe('stopAll', () => {
    beforeEach(() => storage.downloadInfo.set(info({ queued: 3 })));

    it('cancels all downloads and reports how many were stopped', async () => {
      await render();

      component.stopAll();

      expect(http['cancelAllDownloads']).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith('success', 'Stopped 3 downloads');
      expect(component.stopping()).toBe(false);
    });

    it('uses the singular for a single download', async () => {
      http['cancelAllDownloads'].mockReturnValue(of({ ok: true, canceled: 1 }));
      await render();

      component.stopAll();

      expect(notify).toHaveBeenCalledWith('success', 'Stopped 1 download');
    });

    it('notifies an error and resets the stopping flag on failure', async () => {
      http['cancelAllDownloads'].mockReturnValue(throwError(() => new Error('boom')));
      await render();

      component.stopAll();

      expect(notify).toHaveBeenCalledWith('error', 'Could not stop the downloads.');
      expect(component.stopping()).toBe(false);
    });

    it('does nothing when there is nothing active', async () => {
      storage.downloadInfo.set(info());
      await render();

      component.stopAll();

      expect(http['cancelAllDownloads']).not.toHaveBeenCalled();
    });

    it('ignores repeated calls while a stop is already running', async () => {
      http['cancelAllDownloads'].mockReturnValue(new Subject());
      await render();

      component.stopAll();
      component.stopAll();

      expect(http['cancelAllDownloads']).toHaveBeenCalledTimes(1);
    });
  });

  describe('section handles', () => {
    it('hides the downloads grip while the queue is empty', async () => {
      await render();

      expect(component.hasContent()).toEqual({
        [HomeSection.SUBSCRIPTIONS]: true,
        [HomeSection.DOWNLOADS]: false,
      });
      expect(handles().map((h) => h.getAttribute('aria-label'))).toEqual(['Reorder Subscriptions section']);
    });

    it('shows the downloads grip once there are downloads', async () => {
      storage.downloads.set([{ id: 1 } as DownloadModel]);
      await render();

      expect(handles().map((h) => h.getAttribute('aria-label'))).toEqual([
        'Reorder Subscriptions section',
        'Reorder Downloads section',
      ]);
    });
  });

  describe('drop', () => {
    it('moves the dragged section to the target position', async () => {
      await render();
      const spy = vi.spyOn(layout, 'moveSection');

      component.drop(dropEvent(0, 1));

      expect(spy).toHaveBeenCalledWith(HomeSection.SUBSCRIPTIONS, HomeSection.DOWNLOADS);
      expect(component.sectionOrder()).toEqual([HomeSection.DOWNLOADS, HomeSection.SUBSCRIPTIONS]);
    });

    it('re-renders the sections in the new order', async () => {
      storage.downloads.set([{ id: 1 } as DownloadModel]);
      await render();

      component.drop(dropEvent(1, 0));
      await refresh();

      expect(handles()[0].getAttribute('aria-label')).toBe('Reorder Downloads section');
    });

    it('ignores indexes outside the section order', async () => {
      await render();
      const spy = vi.spyOn(layout, 'moveSection');

      component.drop(dropEvent(0, 5));
      component.drop(dropEvent(-1, 0));

      expect(spy).not.toHaveBeenCalled();
      expect(component.sectionOrder()).toEqual(DefaultSectionOrder);
    });
  });

  describe('websocket updates', () => {
    it('forwards server notifications to the notifier', async () => {
      await render();

      notifications$.next({ type: 'warning', message: 'Disk almost full' } as NotificationPayload);

      expect(notify).toHaveBeenCalledWith('warning', 'Disk almost full');
    });

    it('stores the next check and updates the matching subscription dates', async () => {
      const other = subscription({ id: 2, name: 'Other' });
      const otherLastChecked = other.lastCheckedAt;
      storage.subscriptions.set([subscription(), other]);
      storage.nextCheck.set(nextCheck({ nextCheckAt: '2024-01-01T11:00:00Z' }));
      await render();

      const update = nextCheck({ nextCheckAt: '2024-01-01T12:00:00Z' });
      nextCheck$.next(update);

      const [updated, untouched] = storage.subscriptions();
      expect(updated.lastCheckedAt).toEqual(new Date('2024-01-01T11:00:00Z'));
      expect(updated.nextCheckAt).toEqual(new Date('2024-01-01T12:00:00Z'));
      expect(untouched.lastCheckedAt).toBe(otherLastChecked);
      expect(storage.nextCheck()).toBe(update);
    });

    it('replaces the matching subscription instead of mutating it', async () => {
      const original = subscription();
      const originalNextCheckAt = original.nextCheckAt;
      storage.subscriptions.set([original]);
      storage.nextCheck.set(nextCheck({ nextCheckAt: '2024-01-01T11:00:00Z' }));
      await render();

      nextCheck$.next(nextCheck());

      expect(storage.subscriptions()[0]).not.toBe(original);
      expect(original.nextCheckAt).toBe(originalNextCheckAt);
    });

    it('keeps the last checked date when no previous next check is stored', async () => {
      storage.subscriptions.set([subscription()]);
      await render();

      nextCheck$.next(nextCheck({ nextCheckAt: '2024-01-01T12:00:00Z' }));

      expect(storage.subscriptions()[0].lastCheckedAt).toEqual(MockSubscription.lastCheckedAt);
      expect(storage.subscriptions()[0].nextCheckAt).toEqual(new Date('2024-01-01T12:00:00Z'));

      // The stream survives, so later updates still land.
      nextCheck$.next(nextCheck({ nextCheckAt: '2024-01-01T13:00:00Z' }));

      expect(storage.subscriptions()[0].lastCheckedAt).toEqual(new Date('2024-01-01T12:00:00Z'));
      expect(storage.subscriptions()[0].nextCheckAt).toEqual(new Date('2024-01-01T13:00:00Z'));
    });

    it('ignores next check updates that are not ok', async () => {
      const previous = nextCheck();
      storage.nextCheck.set(previous);
      storage.subscriptions.set([subscription()]);
      await render();

      nextCheck$.next(nextCheck({ ok: false, nextCheckAt: '2030-01-01T00:00:00Z' }));

      expect(storage.nextCheck()).toBe(previous);
      expect(storage.subscriptions()[0].nextCheckAt).toEqual(MockSubscription.nextCheckAt);
    });

    it('replaces the updated subscription and keeps the others', async () => {
      const other = subscription({ id: 2, name: 'Other' });
      storage.subscriptions.set([subscription(), other]);
      await render();

      const changed = subscription({ name: 'Renamed' });
      subscriptionUpdated$.next({ channel: changed });

      expect(storage.subscriptions()).toEqual([changed, other]);
      expect(storage.subscriptions()[1]).toBe(other);
    });

    it('stops listening once the page is destroyed', async () => {
      await render();
      fixture.destroy();

      notifications$.next({ type: 'info', message: 'late' } as NotificationPayload);
      subscriptionUpdated$.next({ channel: subscription({ name: 'late' }) });

      expect(notify).not.toHaveBeenCalled();
      expect(notifications$.observed).toBe(false);
      expect(nextCheck$.observed).toBe(false);
      expect(subscriptionUpdated$.observed).toBe(false);
    });
  });
});
