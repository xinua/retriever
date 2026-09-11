import { Pipe, PipeTransform } from '@angular/core';

export enum TimeFormat {
  SHORT = 'short',
  LONG = 'long',
}

@Pipe({
  name: 'time',
  standalone: true,
})
export class TimePipe implements PipeTransform {
  transform(totalSeconds: number, format: TimeFormat = null): string {
    if (totalSeconds === null || totalSeconds === undefined) return '—';

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    // todo - add normal format later 'hh:mm:ss'
    if (format === TimeFormat.SHORT) {
      return `${hours ? `${hours}:` : ''}${minutes ? `${minutes < 10 ? '0' : ''}${minutes}:` : '00:'}${seconds ? `${seconds < 10 ? '0' : ''}${seconds}` : '00'}`;
    }

    if (format === TimeFormat.LONG) {
      return `${hours ? `${hours}h ` : '0h'} ${minutes ? `${minutes < 10 ? '0' : ''}${minutes}m ` : '00m'} ${seconds ? `${seconds < 10 ? '0' : ''}${seconds}s` : ''}`;
    }

    return totalSeconds > 0
      ? `${hours ? `${hours}h ` : ''}${minutes ? `${minutes < 10 ? '0' : ''}${minutes}m ` : ''}${seconds ? `${seconds < 10 ? '0' : ''}${seconds}s` : '00s'}`
      : totalSeconds.toString();
  }
}
