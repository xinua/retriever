import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'rt-no-data',
  imports: [MatIcon, MatButton],
  template: `
    <div class="flex flex-col items-center justify-center h-40 gap-2">
      <mat-icon class="h-15! w-15! text-6xl!">{{ icon() }}</mat-icon>
      <h1 class="text-lg font-medium">{{ message() }}</h1>
      <ng-content></ng-content>
    </div>

    <div class="flex justify-center mb-5">
      @if (showAction()) {
        <button matButton="elevated" (click)="action.emit()">
          <mat-icon>add</mat-icon>
          {{ buttonLabel() }}
        </button>
      }
    </div>
  `,
  styleUrl: './no-data.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoData {
  message = input<string>('No data found');
  buttonLabel = input<string>('Create');
  action = output<void>();
  showAction = input<boolean>(true);
  icon = input<string>('queue');
}
