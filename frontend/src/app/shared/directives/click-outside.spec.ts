import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClickOutside } from './click-outside';

@Component({
  imports: [ClickOutside],
  template: `<div id="inside" (clickOutside)="outsideClicks = outsideClicks + 1"></div>`,
})
class HostComponent {
  outsideClicks = 0;
}

describe('ClickOutside', () => {
  it('should emit only for clicks outside the host element', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('#inside').click();
    expect(fixture.componentInstance.outsideClicks).toBe(0);

    document.body.click();
    expect(fixture.componentInstance.outsideClicks).toBe(1);
  });
});
