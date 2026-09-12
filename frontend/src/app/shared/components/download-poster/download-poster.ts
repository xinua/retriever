import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NotifierService } from 'angular-notifier';
import { fromEvent, skip, take, takeWhile } from 'rxjs';
import { hasFile } from '../../helpers/common.helpers';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { HttpService } from '../../services/http.service';
import { AudioPlayer } from '../audio-player/audio-player';
import { RtSteamCard } from '../steam-card/steam-card';

@Component({
  selector: 'rt-download-poster',
  imports: [RtSteamCard, AudioPlayer],
  templateUrl: './download-poster.html',
  styleUrl: './download-poster.css',
})
export class DownloadPoster {
  private readonly _httpService = inject(HttpService);
  private readonly _notifier = inject(NotifierService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);

  download = input.required<DownloadModel>();

  readonly downloadStatus = DownloadStatus;
  hasFile = computed(() => hasFile(this.download()));
  activeMedia = signal<number | null>(null);
  activeMedia$ = toObservable(this.activeMedia).pipe(skip(2));
  mediaUrl = computed(() => this._httpService.streamFileUrl(this.download()?.id));

  videoPlayer = viewChild<ElementRef<HTMLVideoElement>>('previewVideo');
  audioPlayer = viewChild<AudioPlayer>(AudioPlayer);

  togglePlay(target: DownloadModel, isAbleToOpen: boolean, event?: MouseEvent | Event) {
    if (!isAbleToOpen) return;
    this.activeMedia.update((current) => (current === target.id ? null : target.id));
    if (this.activeMedia() === null) event?.preventDefault();
    if (this.activeMedia() !== null) this._trackVideoFinished();
  }

  handleError() {
    this.activeMedia.set(null);
    this._notifier.notify('error', 'File is no longer on disk');
  }

  private _trackVideoFinished() {
    this._cdr.detectChanges();
    const player = this.videoPlayer()?.nativeElement || this.audioPlayer()?.nativePlayer()?.nativeElement;

    if (!player) return;

    fromEvent(player, 'ended')
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        takeWhile(() => this.activeMedia() !== null),
        take(1),
      )
      .subscribe(() => this.activeMedia.set(null));
  }
}
