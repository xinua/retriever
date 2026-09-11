import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DownloadRecord } from './download-record';
import { DownloadModel } from '@shared/models';
import { DownloadRecordMock, HEIGHT_CHANGE_TOKEN, SCROLL_TOKEN } from '@shared/constants';
import { fromEvent } from 'rxjs';
import { provideNotifier } from '../../providers/notifier.provider';

describe('DownloadRecord', () => {
  let component: DownloadRecord;
  let fixture: ComponentFixture<DownloadRecord>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadRecord],
      providers: [
        provideNotifier(),
        {
          provide: SCROLL_TOKEN,
          useValue: fromEvent(document, 'scroll'),
        },
        {
          provide: HEIGHT_CHANGE_TOKEN,
          useValue: fromEvent(window, 'resize'),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DownloadRecord);
    component = fixture.componentInstance;
  });

  async function render(overrides: Partial<DownloadModel> = {}) {
    fixture.componentRef.setInput('download', { ...DownloadRecordMock, ...overrides });
    fixture.componentRef.setInput('index', 1);
    fixture.componentRef.setInput('paginator', { page: 1, pageSize: 10, totalItems: 100 });
    await fixture.whenStable();
  }

  it('should create', async () => {
    await render();
    expect(component).toBeTruthy();
  });
});
