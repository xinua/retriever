import { Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { DownloadModel, DownloadStatus } from '@shared/models';
import { HttpService, StorageService, WsService } from '@shared/services';
import { catchError, of, startWith, switchMap } from 'rxjs';
import { NgTemplateOutlet } from '@angular/common';
import { AudioPlayer } from '@shared/components';

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

  isPlaying = signal(false);
  download = signal<DownloadModel | null>(null);
  channel = computed(() => this._storage.subscriptions().find((c) => c.id === +this._id));
  videoUrl = computed(() => this._http.streamFileUrl(this.download()?.id));
  canPlay = computed(() => this.download()?.type !== 'thumbnail' && !!this.download()?.filePath);

  playOverlay = viewChild<ElementRef<HTMLDivElement>>('playOverlay');
  audioPlayer = viewChild<ElementRef<HTMLAudioElement>>('previewAudio');

  ngOnInit(): void {
    this._ws
      .nextCheck$()
      .pipe(
        startWith(null),
        switchMap(() => this._http.getSubscription(+this._id)),
      )
      .subscribe();

    this._http
      .getDownloadByWatcher(+this._id, [DownloadStatus.DONE])
      .pipe(catchError(() => of(null)))
      .subscribe((download) => this.download.set(download));
  }

  togglePlay(event?: MouseEvent) {
    if (!this.canPlay()) return;
    event?.preventDefault();
    this.isPlaying.set(!this.isPlaying());

    const action = this.isPlaying() ? 'add' : 'remove';
    this.playOverlay()?.nativeElement.classList[action]('opacity-0!');

    setTimeout(() => {
      if (this.isPlaying()) {
        this.playOverlay()?.nativeElement.classList.remove('z-2');
        this.audioPlayer()?.nativeElement.classList.add('animate');
      } else {
        this.playOverlay()?.nativeElement.classList.add('z-2');
        this.audioPlayer()?.nativeElement.classList.remove('animate');
      }
    }, 500);
  }
}
