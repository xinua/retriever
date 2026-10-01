import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NoData } from './no-data';

@Component({
  imports: [NoData],
  template: `
    <rt-no-data (action)="onAction()">
      <p class="projected">Projected content</p>
    </rt-no-data>
  `,
})
class HostComponent {
  actions = 0;
  onAction() {
    this.actions++;
  }
}

describe('NoData', () => {
  let fixture: ComponentFixture<NoData>;
  let component: NoData;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoData],
    }).compileComponents();
  });

  async function render(inputs: Partial<Record<'message' | 'buttonLabel' | 'showAction' | 'icon', unknown>> = {}) {
    fixture = TestBed.createComponent(NoData);
    component = fixture.componentInstance;
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const heading = (): string => el().querySelector('h1')!.textContent.trim();
  const icon = (): string => el().querySelector('mat-icon')!.textContent.trim();
  const button = (): HTMLButtonElement | null => el().querySelector('button');

  describe('defaults', () => {
    it('renders the default message, icon and button', async () => {
      await render();

      expect(heading()).toBe('No data found');
      expect(icon()).toBe('queue');
      expect(button()).not.toBeNull();
      expect(button()!.textContent).toContain('Create');
      expect(button()!.querySelector('mat-icon')!.textContent.trim()).toBe('add');
    });
  });

  describe('inputs', () => {
    it('renders a custom message', async () => {
      await render({ message: 'Nothing here yet' });

      expect(heading()).toBe('Nothing here yet');
    });

    it('renders a custom icon', async () => {
      await render({ icon: 'download' });

      expect(icon()).toBe('download');
    });

    it('renders a custom button label', async () => {
      await render({ buttonLabel: 'Add subscription' });

      expect(button()!.textContent).toContain('Add subscription');
      expect(button()!.textContent).not.toContain('Create');
    });

    it('hides the action button when showAction is false', async () => {
      await render({ showAction: false });

      expect(button()).toBeNull();
    });

    it('updates the view when inputs change', async () => {
      await render();

      fixture.componentRef.setInput('message', 'Updated');
      fixture.componentRef.setInput('showAction', false);
      await fixture.whenStable();

      expect(heading()).toBe('Updated');
      expect(button()).toBeNull();
    });
  });

  describe('action', () => {
    it('emits action when the button is clicked', async () => {
      await render();
      const spy = vi.fn();
      component.action.subscribe(spy);

      button()!.click();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('in a host', () => {
    let hostFixture: ComponentFixture<HostComponent>;

    beforeEach(async () => {
      hostFixture = TestBed.createComponent(HostComponent);
      await hostFixture.whenStable();
    });

    it('projects content', () => {
      const projected = hostFixture.nativeElement.querySelector('rt-no-data .projected');

      expect(projected).not.toBeNull();
      expect(projected.textContent).toBe('Projected content');
    });

    it('forwards the action output to the parent', () => {
      hostFixture.nativeElement.querySelector('rt-no-data button').click();

      expect(hostFixture.componentInstance.actions).toBe(1);
    });
  });
});
