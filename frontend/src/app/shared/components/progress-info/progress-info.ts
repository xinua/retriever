import { Component, input, output } from '@angular/core';
import { ProgressBarComponent } from '../progress-bar/progress-bar.component';
import { MatIcon } from '@angular/material/icon';
import { DownloadModel } from '../../models/download.model';
import { SizePipe } from '../../pipes/size.pipe';

@Component({
  selector: 'rt-progress-info',
  imports: [ProgressBarComponent, MatIcon, SizePipe],
  templateUrl: './progress-info.html',
  styleUrl: './progress-info.css',
})
export class ProgressInfo {
  download = input.required<DownloadModel>();
  cancel = output<DownloadModel>();
}
