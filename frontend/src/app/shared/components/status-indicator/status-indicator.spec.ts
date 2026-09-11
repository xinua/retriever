import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusIndicator } from './status-indicator';
import { provideNotifier } from '../../providers/notifier.provider';
import { DownloadModel } from '@shared/models';
import { DownloadRecordMock } from '@shared/constants';

describe('StatusIndicator', () => {
  let component: StatusIndicator;
  let fixture: ComponentFixture<StatusIndicator>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusIndicator],
      providers: [provideNotifier()],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusIndicator);
    component = fixture.componentInstance;
  });

  async function render(overrides: Partial<DownloadModel> = {}) {
    fixture.componentRef.setInput('download', { ...DownloadRecordMock, ...overrides });
    await fixture.whenStable();
  }

  it('should create', async () => {
    await render();
    expect(component).toBeTruthy();
  });
});
