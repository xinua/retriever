import { Pipe, PipeTransform } from '@angular/core';

type TimeUnit = 'H' | 'M' | 'S';

const UNITS: readonly TimeUnit[] = ['H', 'M', 'S'];
const UNIT_SECONDS: Record<TimeUnit, number> = { H: 3600, M: 60, S: 1 };
const TOKEN = /\[[^\]]*]|H{1,2}|M{1,2}|S{1,2}/g;

/**
 * Formats a duration given in seconds with a `DatePipe`-like format string.
 *
 * Tokens: `H` hours, `M` minutes, `S` seconds — doubled (`HH`, `MM`, `SS`) to
 * zero-pad to two digits. Everything else is copied over as a literal:
 * `'HHh:MMm:SSs'` → `00h:00m:00s`, `'H,M,SSs'` → `0,0,00s`.
 *
 * The largest unit in the format carries the overflow, so `'MM:SS'` of an hour
 * renders `60:00`. A `[…]` group is dropped when all of its units are zero:
 * `'[H:]MM:SS'` renders `05:30` but `1:05:30` once there are hours.
 */
@Pipe({
  name: 'time',
  standalone: true,
})
export class TimePipe implements PipeTransform {
  transform(totalSeconds: number, format = 'HH:MM:SS'): string {
    if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds)) return '—';

    const sign = totalSeconds < 0 ? '-' : '';

    return sign + this.render(format, this.split(Math.floor(Math.abs(totalSeconds)), format));
  }

  /** Splits the duration over the units used by the format, largest one first. */
  private split(totalSeconds: number, format: string): Record<TimeUnit, number> {
    const values: Record<TimeUnit, number> = { H: 0, M: 0, S: 0 };
    const largest = UNITS.findIndex((unit) => format.includes(unit));
    if (largest < 0) return values;

    let rest = totalSeconds;
    for (const unit of UNITS.slice(largest)) {
      values[unit] = Math.floor(rest / UNIT_SECONDS[unit]);
      rest %= UNIT_SECONDS[unit];
    }

    return values;
  }

  private render(format: string, values: Record<TimeUnit, number>): string {
    return format.replace(TOKEN, (token) => {
      if (token.startsWith('[')) {
        const body = token.slice(1, -1);
        const used = (body.match(/[HMS]/g) ?? []) as TimeUnit[];

        return used.every((unit) => !values[unit]) ? '' : this.render(body, values);
      }

      const value = values[token[0] as TimeUnit];

      return token.length > 1 ? String(value).padStart(2, '0') : String(value);
    });
  }
}
