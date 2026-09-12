import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { hasFile } from '@shared/helpers';
import { DownloadModel, DownloadStatus } from '@shared/models';
import { HttpService, StorageService, WsService } from '@shared/services';
import { catchError, fromEvent, of, startWith, switchMap, take, takeWhile } from 'rxjs';
import { NgTemplateOutlet } from '@angular/common';
import { AudioPlayer } from '@shared/components';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NotifierService } from 'angular-notifier';

@Component({
  selector: 'rt-widget-page',
  templateUrl: './widget-page.html',
  styleUrl: './widget-page.css',
  imports: [MatCardModule, MatTooltip, MatIcon, NgTemplateOutlet, AudioPlayer],
})
export class WidgetPage implements OnInit {
  private readonly _http = inject(HttpService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _id = this._route.snapshot.paramMap.get('id');
  private readonly _storage = inject(StorageService);
  private readonly _ws = inject(WsService);
  readonly _notifier = inject(NotifierService);
  readonly _cdr = inject(ChangeDetectorRef);
  readonly _destroyRef = inject(DestroyRef);

  isPlaying = signal(false);
  download = signal<DownloadModel | null>(null);
  channel = computed(() => this._storage.subscriptions().find((c) => c.id === +this._id));
  videoUrl = computed(() => this._http.streamFileUrl(this.download()?.id));
  canPlay = computed(() => this.download()?.type !== 'thumbnail' && hasFile(this.download()));

  audioPlayer = viewChild<AudioPlayer>(AudioPlayer);
  videoPlayer = viewChild<ElementRef<HTMLVideoElement>>('videoPlayer');
  playOverlay = viewChild<ElementRef<HTMLDivElement>>('playOverlay');
  audioContainer = viewChild<ElementRef<HTMLAudioElement>>('audioContainer');

  ngOnInit(): void {
    this._ws
      .nextCheck$()
      .pipe(
        startWith(null),
        switchMap(() => this._http.getSubscription(+this._id)),
      )
      .subscribe();

    this._http
      .getDownloadByWatcher(+this._id, { statuses: [DownloadStatus.DONE], types: [] })
      .pipe(catchError(() => of(null)))
      .subscribe((download) => this.download.set(download));
  }

  togglePlay(event?: MouseEvent) {
    if (!this.canPlay()) return;
    event?.preventDefault();
    this.isPlaying.set(!this.isPlaying());
    if (this.isPlaying()) this._trackVideoFinished();

    const action = this.isPlaying() ? 'add' : 'remove';
    this.playOverlay()?.nativeElement.classList[action]('opacity-0!');

    setTimeout(() => {
      if (this.isPlaying()) {
        this.playOverlay()?.nativeElement.classList.remove('z-2');
        this.audioContainer()?.nativeElement.classList.add('animate');
      } else {
        this.playOverlay()?.nativeElement.classList.add('z-2');
        this.audioContainer()?.nativeElement.classList.remove('animate');
      }
    }, 500);
  }

  handleError() {
    this.isPlaying.set(false);
    this._notifier.notify('error', 'File is no longer on disk');
    this.playOverlay()?.nativeElement.classList.remove('opacity-0!');
  }

  private _trackVideoFinished() {
    this._cdr.detectChanges();
    const player = this.videoPlayer()?.nativeElement || this.audioPlayer()?.nativePlayer()?.nativeElement;

    if (!player) return;

    fromEvent(player, 'ended')
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        takeWhile(() => this.isPlaying()),
        take(1),
      )
      .subscribe(() => this.isPlaying.set(false));
  }
}
