import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DownloadPoster } from './download-poster';
import { DownloadRecordMock, DRAG_TOKEN } from '@shared/constants';
import { of } from 'rxjs';
import { DownloadModel, DownloadStatus, Types } from '@shared/models';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { NotifierService } from 'angular-notifier';
import { provideNotifier } from '../../providers';

describe('Poster', () => {
  let component: DownloadPoster;
  let fixture: ComponentFixture<DownloadPoster>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadPoster],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNotifier(),
        { provide: DRAG_TOKEN, useValue: of(false) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DownloadPoster);
    component = fixture.componentInstance;
  });

  async function render(overrides: Partial<DownloadModel> = {}) {
    fixture.componentRef.setInput('download', {
      ...DownloadRecordMock,
      id: 3,
      status: DownloadStatus.DONE,
      fileExists: true,
      ...overrides,
    });
    await fixture.whenStable();
  }

  const card = (): HTMLElement | null => fixture.nativeElement.querySelector('rt-steam-card');
  const video = (): HTMLVideoElement | null => fixture.nativeElement.querySelector('video');
  const audio = (): HTMLElement | null => fixture.nativeElement.querySelector('rt-audio-player');

  async function clickCard() {
    card().querySelector<HTMLElement>('.rt-card-content').click();
    await fixture.whenStable();
  }

  it('shows the poster until it is clicked', async () => {
    await render({ thumbnailPath: '/thumbs/3.jpg' });

    expect(card()).not.toBeNull();
    expect(card().querySelector('img').getAttribute('src')).toBe('/thumbs/3.jpg');
    expect(video()).toBeNull();
  });

  it('plays a video from the stream url when clicked', async () => {
    await render({ type: Types.VIDEO });
    await clickCard();

    expect(card()).toBeNull();
    expect(video().getAttribute('src')).toBe('/api/downloads/3/file?inline=1');
  });

  it('plays audio in the audio player when clicked', async () => {
    await render({ type: Types.AUDIO });
    await clickCard();

    expect(video()).toBeNull();
    expect(audio()).not.toBeNull();
  });

  it('goes back to the poster when the video is clicked again', async () => {
    await render({ type: Types.VIDEO });
    await clickCard();

    video().click();
    await fixture.whenStable();

    expect(video()).toBeNull();
    expect(card()).not.toBeNull();
  });

  it('goes back to the poster when the video ends', async () => {
    await render({ type: Types.VIDEO });
    await clickCard();

    video().dispatchEvent(new Event('ended'));
    await fixture.whenStable();

    expect(component.activeMedia()).toBeNull();
    expect(card()).not.toBeNull();
  });

  it('does not open a file that is missing from disk', async () => {
    await render({ type: Types.VIDEO, fileExists: false });
    await clickCard();

    expect(video()).toBeNull();
  });

  it('does not open a thumbnail download', async () => {
    await render({ type: Types.THUMBNAIL });
    await clickCard();

    expect(video()).toBeNull();
    expect(audio()).toBeNull();
  });

  it('reports a file that fails to play and shows the poster again', async () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
    await render({ type: Types.VIDEO });
    await clickCard();

    video().dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(notify).toHaveBeenCalledWith('error', 'File is no longer on disk');
    expect(card()).not.toBeNull();
  });

  it('offers to replace the poster only once the download is finished and not a thumbnail', async () => {
    const dropArea = () => fixture.nativeElement.querySelector('rt-drop-area');

    await render({ type: Types.VIDEO });
    expect(dropArea()).not.toBeNull();

    await render({ type: Types.VIDEO, status: DownloadStatus.RUNNING });
    expect(dropArea()).toBeNull();

    await render({ type: Types.THUMBNAIL });
    expect(dropArea()).toBeNull();
  });
});
