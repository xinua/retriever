import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { DownloadModel } from '../../models/download.model';
import { DownloadRecordMock } from '../../constants/mocks.const';
import { DownloadControls } from './download-controls';
import { provideNotifier } from '../../providers/notifier.provider';

describe('DownloadControls', () => {
  let component: DownloadControls;
  let fixture: ComponentFixture<DownloadControls>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadControls],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNotifier()],
    }).compileComponents();

    fixture = TestBed.createComponent(DownloadControls);
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
