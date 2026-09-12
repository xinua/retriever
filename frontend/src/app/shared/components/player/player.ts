import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NotifierService } from 'angular-notifier';
import { fromEvent, take, takeWhile } from 'rxjs';
import { hasFile } from '../../helpers/common.helpers';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { HttpService } from '../../services/http.service';
import { AudioPlayer } from '../audio-player/audio-player';

@Component({
  selector: 'rt-player',
  imports: [AudioPlayer],
  templateUrl: './player.html',
  styleUrl: './player.css',
})
export class RtPlayer implements OnInit {
  private readonly _http = inject(HttpService);
  private readonly _notifier = inject(NotifierService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);

  subscriptionId = input.required<number>();
  containerSize = input<string>('');
  posterClass = input<string>('');

  fileNotFound = signal<boolean>(false);
  isPlaying = signal<boolean>(false);
  download = signal<DownloadModel | null>(null);
  canPlay = computed(() => hasFile(this.download()) && !this.fileNotFound());
  mediaUrl = computed(() => this._getVideoUrl());

  videoPlayer = viewChild<ElementRef<HTMLVideoElement>>('videoPlayer');
  audioPlayer = viewChild<AudioPlayer>(AudioPlayer);

  constructor() {
    effect(() => {
      if (this.isPlaying()) this._trackVideoFinished();
    });
  }

  /**
   * Fetches the row up front, so a card whose file was deleted outside the app
   * reads as unplayable instead of offering a click that ends in an error.
   * The server checks the file while answering, so this one request says both
   * which download is the last video and whether it can be played.
   */
  ngOnInit(): void {
    this._http.getDownloadByWatcher(this.subscriptionId(), { statuses: [DownloadStatus.DONE], types: [] }).subscribe({
      next: (download) => this.download.set(download),
      error: () => this.fileNotFound.set(true),
    });
  }

  togglePlay(event?: MouseEvent) {
    event?.preventDefault();

    if (this.isPlaying()) {
      this.isPlaying.set(false);
      return;
    }

    if (this.canPlay()) this.isPlaying.set(true);
  }

  handleError() {
    this.fileNotFound.set(true);
    this._notifier.notify('error', 'File not found (status: 404)');
  }

  private _getVideoUrl(): string {
    return this._http.streamFileUrl(this.download()?.id);
  }

  private _trackVideoFinished(): void {
    this._cdr.detectChanges();
    const player = this.videoPlayer()?.nativeElement || this.audioPlayer()?.nativePlayer()?.nativeElement;

    if (!player) return;

    fromEvent(player, 'ended')
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        takeWhile(() => this.isPlaying() !== null),
        take(1),
      )
      .subscribe(() => this.isPlaying.set(false));
  }
}
