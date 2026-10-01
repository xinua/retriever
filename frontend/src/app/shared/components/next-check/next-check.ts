import { AsyncPipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpService } from '../../services/http.service';
import { StorageService } from '../../services/storage.service';
import { defaultIfEmpty, filter, interval, map, Observable, takeWhile } from 'rxjs';

interface NextCheckIn {
  totalSeconds: number;
  isChecking: boolean;
  channel: string;
  displayTime: string;
}

@Component({
  selector: 'rt-next-check',
  imports: [AsyncPipe],
  templateUrl: './next-check.html',
  styleUrl: './next-check.css',
})
export class NextCheckComponent implements OnInit {
  private readonly _httpService = inject(HttpService);
  private readonly _storage = inject(StorageService);
  private readonly _destroyRef = inject(DestroyRef);

  readonly nextCheck = this._storage.nextCheck;
  settings = this._storage.settings;
  activeChannels = computed(() => this._storage.subscriptions().filter((c) => c.enabled));
  timer$: Observable<NextCheckIn> = this._getTimer();

  constructor() {
    effect(() => {
      if (this.nextCheck()?.ok) this.timer$ = this._getTimer();
    });
  }

  ngOnInit(): void {
    this._httpService.getNextCheck().subscribe();
  }

  private _getTimer(): Observable<NextCheckIn> {
    return interval(1000).pipe(
      filter(() => this.nextCheck()?.ok),
      map(() => this._formatTime()),
      takeWhile(({ totalSeconds }) => totalSeconds >= 0),
      defaultIfEmpty({ displayTime: '—', isChecking: false, channel: '', totalSeconds: 0 }),
      takeUntilDestroyed(this._destroyRef),
    );
  }

  private _formatTime(): NextCheckIn {
    const totalSeconds = this.calculateTimeLeft();

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
      totalSeconds,
      isChecking: totalSeconds > 0,
      channel: this.nextCheck().channel.name,
      displayTime:
        totalSeconds > 0
          ? `${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${seconds ? `${seconds}s` : '0s'}`
          : 'checking...',
    };
  }

  private calculateTimeLeft(): number {
    const nextCheck = this.nextCheck().nextCheckAt;

    if (!nextCheck) return 0;

    const now = new Date();
    const nextCheckDate = new Date(nextCheck);
    return Math.floor((nextCheckDate.getTime() - now.getTime()) / 1000) || 0;
  }
}
