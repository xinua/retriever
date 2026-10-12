import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TextInput } from './text-input';

@Component({
  imports: [TextInput],
  template: `
    <rt-text-input
      [value]="value()"
      [isEditing]="editing()"
      inputClass="title-input"
      (save)="saved.push($event)"
      (cancel)="cancels = cancels + 1"
    >
      <span id="display">{{ value() }}</span>
    </rt-text-input>
  `,
})
class HostComponent {
  value = signal('My video');
  editing = signal(false);
  saved: string[] = [];
  cancels = 0;
}

describe('TextInput', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  const el = (): HTMLElement => fixture.nativeElement;
  const input = (): HTMLInputElement | null => el().querySelector('input');
  const doneButton = (): HTMLButtonElement => el().querySelector('button')!;

  async function edit() {
    host.editing.set(true);
    await fixture.whenStable();
  }

  function type(text: string) {
    input()!.value = text;
    input()!.dispatchEvent(new Event('input'));
  }

  function press(key: string) {
    input()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('shows the projected content and no input when not editing', () => {
    expect(el().querySelector('#display')!.textContent).toBe('My video');
    expect(input()).toBeNull();
  });

  it('ignores Enter and Escape when not editing', () => {
    const textInput = el().querySelector('rt-text-input')!;
    textInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    textInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(host.saved).toEqual([]);
    expect(host.cancels).toBe(0);
  });

  describe('edit mode', () => {
    it('replaces the content with a focused input holding the value', async () => {
      await edit();

      expect(el().querySelector('#display')).toBeNull();
      expect(input()!.value).toBe('My video');
      expect(document.activeElement).toBe(input());
    });

    it('applies the input class', async () => {
      await edit();

      expect(input()!.classList).toContain('title-input');
      expect(input()!.classList).toContain('w-full');
    });

    it('saves the typed text on Enter', async () => {
      await edit();

      type('Renamed');
      press('Enter');

      expect(host.saved).toEqual(['Renamed']);
    });

    it('saves the typed text from the done button', async () => {
      await edit();

      type('Renamed');
      doneButton().click();

      expect(host.saved).toEqual(['Renamed']);
    });

    it('saves the unchanged value when nothing was typed', async () => {
      await edit();

      press('Enter');

      expect(host.saved).toEqual(['My video']);
    });

    it('cancels on Escape without saving', async () => {
      await edit();

      type('Renamed');
      press('Escape');

      expect(host.cancels).toBe(1);
      expect(host.saved).toEqual([]);
    });

    it('cancels on a click outside, but not on one inside', async () => {
      await edit();

      input()!.click();
      expect(host.cancels).toBe(0);

      document.body.click();
      expect(host.cancels).toBe(1);
    });

    it('starts from the current value again when reopened', async () => {
      await edit();
      type('Discarded');
      host.editing.set(false);
      await fixture.whenStable();

      host.value.set('Updated');
      await edit();

      expect(input()!.value).toBe('Updated');
      press('Enter');
      expect(host.saved).toEqual(['Updated']);
    });
  });
});
