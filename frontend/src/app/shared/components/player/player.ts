import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { filter, Observable } from 'rxjs';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { HttpService } from '../../services/http.service';
import { NotifierService } from 'angular-notifier';
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

  subscriptionId = input.required<number>();
  containerSize = input<string>('');
  posterClass = input<string>('');

  fileNotFound = signal<boolean>(false);
  isPlaying = signal<boolean>(false);
  download = signal<DownloadModel | null>(null);
  mediaUrl = computed(() => this._getVideoUrl());

  /**
   * Asks up front whether there is anything to play, so a card whose file was
   * deleted outside the app reads as unplayable instead of offering a click
   * that ends in a 404 toast. Narrowed to done downloads because that is what
   * `_getDownload()` will ask for — probing a different row than the one that
   * gets fetched would answer the wrong question.
   */
  ngOnInit(): void {
    this._http
      .checkSubscriptionFile(this.subscriptionId(), [DownloadStatus.DONE])
      .subscribe((exists) => this.fileNotFound.set(!exists));
  }

  openVideo(event?: MouseEvent) {
    event?.preventDefault();

    console.log('click');
    if (this.fileNotFound()) return;
    console.log('found file');

    if (this.isPlaying()) {
      this.isPlaying.set(false);
      console.log('stop playing');
      return;
    }

    if (this.download()) {
      console.log('found download');
      if (!!this.download()?.filePath) this.isPlaying.set(true);
      return;
    }

    console.log('get download');
    this._getDownload().subscribe({
      next: (download) => {
        console.log('got download');
        this.download.set(download);
        this.isPlaying.set(true);
      },
      error: () => {
        this.download.set({} as DownloadModel);
        this.fileNotFound.set(true);
      },
    });
  }

  handleError() {
    this.fileNotFound.set(true);
    this._notifier.notify('error', 'File not found (status: 404)');
  }

  private _getVideoUrl(): string {
    return this._http.streamFileUrl(this.download()?.id);
  }

  private _getDownload(): Observable<DownloadModel> {
    return this._http.getDownloadByWatcher(this.subscriptionId(), [DownloadStatus.DONE]).pipe(filter(Boolean));
  }
}
