import { Component, computed, inject, input, signal } from '@angular/core';
import { RtCard } from '../card/card';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { HttpService } from '../../services/http.service';

@Component({
  selector: 'rt-poster',
  imports: [RtCard],
  templateUrl: './poster.html',
  styleUrl: './poster.css',
})
export class Poster {
  private readonly _httpService = inject(HttpService);
  readonly downloadStatus = DownloadStatus;
  download = input<DownloadModel>();
  activeVideo = signal<number | null>(null);
  videoUrl = computed(() => this._httpService.streamFileUrl(this.download()?.id));

  openVideo(target: DownloadModel, isAbleToOpen: boolean, event?: MouseEvent) {
    if (!isAbleToOpen) return;
    this.activeVideo.update((current) => (current === target.id ? null : target.id));
    if (this.activeVideo() === null) event?.preventDefault();
  }
}
