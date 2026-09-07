import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { DownloadModel, DownloadStatus } from '@shared/models';
import { HttpService, StorageService, WsService } from '@shared/services';
import { catchError, of, startWith, switchMap } from 'rxjs';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'rt-widget-page',
  imports: [MatCardModule, MatTooltip, MatIcon],
  templateUrl: './widget-page.html',
  styleUrl: './widget-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  isAbleToOpen = computed(() => this.download()?.type !== 'thumbnail' && !!this.download()?.filePath);

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

  openVideo(event?: MouseEvent) {
    if (!this.isAbleToOpen) return;
    event?.preventDefault();
    this.isPlaying.set(!this.isPlaying());
  }
}
