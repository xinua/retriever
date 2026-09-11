import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressInfo } from './progress-info';
import { DownloadRecordMock } from '@shared/constants';
import { DownloadModel } from '@shared/models';
import { provideNotifier } from '../../providers/notifier.provider';

describe('ProgressInfo', () => {
  let component: ProgressInfo;
  let fixture: ComponentFixture<ProgressInfo>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressInfo],
      providers: [provideNotifier()],
    }).compileComponents();

    fixture = TestBed.createComponent(ProgressInfo);
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
