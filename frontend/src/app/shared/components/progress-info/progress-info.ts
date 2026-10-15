import { UpperCasePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { ProgressBarComponent } from '../progress-bar/progress-bar.component';
import { MatIcon } from '@angular/material/icon';
import { DownloadModel } from '../../models/download.model';
import { SizePipe } from '../../pipes/size.pipe';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';

@Component({
  selector: 'rt-progress-info',
  imports: [ProgressBarComponent, MatIcon, MatButtonModule, MatTooltip, SizePipe, UpperCasePipe],
  templateUrl: './progress-info.html',
  styleUrl: './progress-info.css',
})
export class ProgressInfo {
  download = input.required<DownloadModel>();
  /** Emitted for the download, or for the move when `move` is set. */
  cancel = output<DownloadModel>();

  movePercent = computed(() => {
    const move = this.download().move;

    return move?.total ? Math.floor((move.copied / move.total) * 100) : 0;
  });
}
