import { Component, effect, ElementRef, input, OnInit, output, signal, viewChild } from '@angular/core';
import { Nullable } from '../../models/common.model';

@Component({
  selector: 'rt-steam-card',
  imports: [],
  template: `
    <div
      #cardEl
      class="h-min w-[90%] mx-auto"
      [class.cursor-pointer]="!!url()?.length"
      (mousemove)="move($event)"
      (mouseleave)="reset()"
    >
      <div
        [style.transform]="'perspective(1000px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg)'"
        class="rt-card-content relative {{ customClass() }}"
        (click)="openUrl($event)"
      >
        @if (!isLoaded()) {
          <div
            class="preloader bg-[#1f1f1f] animate-pulse {{ customClass() }}"
            [style.width]="imgSize().split('x')[0] + 'px'"
            [style.height]="imgSize().split('x')[1] + 'px'"
          ></div>
        }
        @if (imageUrl()) {
          <img
            [src]="imageUrl()"
            alt="Source image"
            [class]="!isLoaded() ? 'hidden!' : 'h-[inherit]! ' + imageClass()"
            (error)="handleImageError()"
            (load)="handleImageLoad()"
          />
        }

        <div class="shine-line" [style.left.px]="shineX" [style.top.px]="shineY" [class.visible]="isShineVisible"></div>
      </div>
    </div>
  `,
  styleUrl: './steam-card.css',
})
export class RtSteamCard implements OnInit {
  private _retried = false;

  imageSourceUrl = input.required<Nullable<string>>();
  pending = input<boolean>(false);
  url = input<Nullable<string>>(null);
  imgSize = input<string>('250x250');
  mockMessage = input<string>('Image%20not%20found');
  customClass = input<string>('rounded-md overflow-hidden h-[inherit]');
  imageClass = input<string>('');
  retry = input<boolean>(false);
  cardClick = output<MouseEvent>();

  card = viewChild<ElementRef<HTMLDivElement>>('cardEl');

  imageUrl = signal<string>('');
  isLoaded = signal<boolean>(false);

  rotateY = 0;
  rotateX = 0;
  shineX = 0;
  shineY = 0;
  isShineVisible = false;

  constructor() {
    effect(() => {
      const source = this.imageSourceUrl();

      // Through null first, so an <img> already pointed at this URL reloads
      // rather than keeping the frame it failed on.
      this.imageUrl.set(null);
      this.show(source);
    });
  }

  ngOnInit(): void {
    this.show(this.imageSourceUrl());
  }

  handleImageLoad() {
    this.isLoaded.set(true);
  }

  handleImageError() {
    // Nothing to ask for twice when there was no source to begin with.
    if (!this._retried && this.retry() && this.imageSourceUrl()?.length) {
      this._retried = true;
      setTimeout(() => this.imageUrl.set(`${this.imageSourceUrl()}?r=1`), 2000);
      return;
    }

    this.imageUrl.set(this.mock());
  }

  /**
   * Shows `source`, or the placeholder when there is nothing to show — the
   * server returns no path for a download whose artwork never arrived, and an
   * empty src would otherwise re-request the page itself.
   */
  private show(source: Nullable<string>) {
    this._retried = false;

    if (source?.length) {
      this.imageUrl.set(source);
      return;
    }

    // No <img> at all while pending: an empty src would re-request the page
    // itself, and the preloader is the whole point of showing nothing.
    this.isLoaded.set(false);
    this.imageUrl.set(this.pending() ? null : this.mock());
  }

  private mock(): string {
    return `https://mockimage.tw/photo/${this.imgSize()}/1f1f1f/ff8800/${this.mockMessage()}`;
  }

  move({ clientX, clientY }: MouseEvent) {
    const rotateRange = 15;
    const { width, height, left, top } = this.card()?.nativeElement.getBoundingClientRect();

    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    const percentX = deltaX / (width / 2);
    const percentY = deltaY / (height / 2);

    this.rotateY = percentX * rotateRange;
    this.rotateX = -percentY * rotateRange;

    this.shineX = clientX - left;
    this.shineY = clientY - top;
    this.isShineVisible = true;
  }

  reset() {
    this.rotateX = 0;
    this.rotateY = 0;
    this.isShineVisible = false;
  }

  openUrl(event: MouseEvent) {
    if (this.url()) window.open(this.url(), '_blank');
    else this.cardClick.emit(event);
  }
}
