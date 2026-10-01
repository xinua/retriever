import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Badge } from './badge';

@Component({
  imports: [Badge],
  template: `<rt-badge>Video</rt-badge>`,
})
class HostComponent {}

describe('Badge', () => {
  let component: Badge;
  let fixture: ComponentFixture<Badge>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Badge],
    }).compileComponents();

    fixture = TestBed.createComponent(Badge);
    component = fixture.componentInstance;
  });

  async function render(inputs: { badgeClass?: string; isClickable?: boolean } = {}) {
    if (inputs.badgeClass !== undefined) fixture.componentRef.setInput('badgeClass', inputs.badgeClass);
    if (inputs.isClickable !== undefined) fixture.componentRef.setInput('isClickable', inputs.isClickable);
    await fixture.whenStable();
  }

  const badge = (): HTMLSpanElement => fixture.nativeElement.querySelector('span');

  it('applies the default classes', async () => {
    await render();
    expect([...badge().classList].sort()).toEqual(component.defaultClass.split(' ').sort());
  });

  it('adds the custom class after the default ones', async () => {
    await render({ badgeClass: 'bg-green-700' });

    expect(badge().classList).toContain('bg-green-700');
    expect(badge().classList).toContain('rounded-md');
  });

  it('adds the hover classes only when clickable', async () => {
    await render();
    expect(badge().classList).not.toContain('cursor-pointer');

    await render({ isClickable: true });
    expect(badge().classList).toContain('cursor-pointer');
    expect(badge().classList).toContain('hover:scale-110');
  });

  it('projects its content', async () => {
    const host = TestBed.createComponent(HostComponent);
    await host.whenStable();

    expect(host.nativeElement.querySelector('rt-badge span').textContent.trim()).toBe('Video');
  });
});
