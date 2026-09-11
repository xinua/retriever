import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubscriptionDetails } from './subscription-details';
import { DefaultSubscription } from '@shared/constants';
import { SubscriptionModel } from '@shared/models';
import { provideNotifier } from '../../providers/notifier.provider';

describe('SubscriptionDetails', () => {
  let component: SubscriptionDetails;
  let fixture: ComponentFixture<SubscriptionDetails>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubscriptionDetails],
      providers: [provideNotifier()],
    }).compileComponents();

    fixture = TestBed.createComponent(SubscriptionDetails);
    component = fixture.componentInstance;
  });

  async function render(overrides: Partial<SubscriptionModel> = {}) {
    fixture.componentRef.setInput('sub', { ...DefaultSubscription, ...overrides });
    await fixture.whenStable();
  }

  it('should create', async () => {
    await render();
    expect(component).toBeTruthy();
  });
});
