import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { NextCheckComponent } from './next-check';
import { StorageService } from '@shared/services';
import { DefaultSettings, MockSubscription } from '@shared/constants';
import { NextCheckModel } from '@shared/models';

const NOW = new Date('2026-01-01T12:00:00Z');

describe('NextCheckComponent', () => {
  let fixture: ComponentFixture<NextCheckComponent>;
  let storage: StorageService;
  let http: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW });

    await TestBed.configureTestingModule({
      imports: [NextCheckComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    storage = TestBed.inject(StorageService);
    http = TestBed.inject(HttpTestingController);
    storage.subscriptions.set([{ ...MockSubscription, enabled: true }]);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  /** Creates the component and answers its initial next-check request. */
  function render(nextCheck: Partial<NextCheckModel> = {}) {
    fixture = TestBed.createComponent(NextCheckComponent);
    fixture.detectChanges();
    http.expectOne('/api/next-check').flush({
      ok: true,
      nextCheckAt: new Date(NOW.getTime() + 90_000).toISOString(),
      channel: { id: 1, name: 'Some Channel' },
      ...nextCheck,
    });
    fixture.detectChanges();
  }

  function tick(ms = 1000) {
    vi.advanceTimersByTime(ms);
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim();

  it('stores the next check fetched on init', () => {
    render();
    expect(storage.nextCheck()?.channel.name).toBe('Some Channel');
  });

  it('shows a placeholder until the first tick', () => {
    render();
    expect(text()).toContain('Next check in: updating...');
    expect(text()).toContain('Next check for: Some Channel');
  });

  it('counts down every second', () => {
    render();

    tick();
    expect(text()).toContain('Next check in: 1m 29s');

    tick();
    expect(text()).toContain('Next check in: 1m 28s');
  });

  it.each([
    [3_723, '1h 2m 3s'],
    [3_600, '1h 0s'],
    [120, '2m 0s'],
    [4, '4s'],
  ])('formats %is left as "%s"', (seconds, expected) => {
    // +1s so the value is exact after the first tick
    render({ nextCheckAt: new Date(NOW.getTime() + (seconds + 1) * 1000).toISOString() });
    tick();
    expect(text()).toContain(`Next check in: ${expected}`);
  });

  it('shows "checking..." once the check is due', () => {
    render({ nextCheckAt: new Date(NOW.getTime() + 2_000).toISOString() });

    tick(2000);
    expect(text()).toContain('Next check in: checking...');
  });

  it('keeps the last value after the check time has passed', () => {
    render({ nextCheckAt: new Date(NOW.getTime() + 2_000).toISOString() });

    tick(5000);
    expect(text()).toContain('Next check in: checking...');
  });

  it('shows a dash when the check time is already in the past', () => {
    render({ nextCheckAt: new Date(NOW.getTime() - 5_000).toISOString() });

    tick();
    expect(text()).toContain('Next check in: —');
  });

  it('shows "checking..." when there is no scheduled time', () => {
    render({ nextCheckAt: null as unknown as string });

    tick();
    expect(text()).toContain('Next check in: checking...');
  });

  it('keeps waiting while the next check is not ok', () => {
    render({ ok: false });

    tick(5000);
    expect(text()).toContain('Next check in: updating...');
  });

  it('restarts the countdown when a new next check arrives', () => {
    render();
    tick();
    expect(text()).toContain('1m 29s');

    storage.nextCheck.set({
      ok: true,
      nextCheckAt: new Date(Date.now() + 10_000).toISOString(),
      channel: { id: 2, name: 'Other Channel' },
    });
    fixture.detectChanges();
    expect(text()).toContain('Next check in: updating...');
    expect(text()).toContain('Next check for: Other Channel');

    tick();
    expect(text()).toContain('Next check in: 9s');
  });

  it('renders nothing when checks are disabled', () => {
    storage.settings.set({ ...DefaultSettings, enabled: false });
    render();
    tick();

    expect(text()).toBe('');
  });

  it('renders nothing without enabled subscriptions', () => {
    storage.subscriptions.set([{ ...MockSubscription, enabled: false }]);
    render();
    tick();

    expect(text()).toBe('');
  });
});
