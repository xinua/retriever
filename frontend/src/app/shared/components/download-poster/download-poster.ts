import { Component, computed, inject, input, signal } from '@angular/core';
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
  readonly downloadStatus = DownloadStatus;

  download = input.required<DownloadModel>();

  activeVideo = signal<number | null>(null);
  mediaUrl = computed(() => this._httpService.streamFileUrl(this.download()?.id));

  togglePlay(target: DownloadModel, isAbleToOpen: boolean, event?: MouseEvent | Event) {
    if (!isAbleToOpen) return;
    this.activeVideo.update((current) => (current === target.id ? null : target.id));
    if (this.activeVideo() === null) event?.preventDefault();
  }
}
