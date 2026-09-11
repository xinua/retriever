import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DownloadPoster } from './download-poster';
import { DownloadRecordMock } from '@shared/constants';
import { DownloadModel } from '@shared/models';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

describe('Poster', () => {
  let component: DownloadPoster;
  let fixture: ComponentFixture<DownloadPoster>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadPoster],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(DownloadPoster);
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
