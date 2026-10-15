import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { RememberChoiseDialog } from './remember-choise-dialog';

describe('RememberChoiseDialog', () => {
  let fixture: ComponentFixture<RememberChoiseDialog>;
  let close: ReturnType<typeof vi.fn>;

  async function render(data: Record<string, unknown> = {}) {
    close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [RememberChoiseDialog],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            title: 'Remove file',
            message: 'Remove it?',
            rememberChoise: true,
            rememberChoiseText: "Don't ask me again",
            cancelText: 'Cancel',
            actionText: 'Remove',
            ...data,
          },
        },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RememberChoiseDialog);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const press = (key: string) => el().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('shows the title, message, checkbox and button labels', async () => {
    await render();
    const text = el().textContent;

    expect(text).toContain('Remove file');
    expect(text).toContain('Remove it?');
    expect(text).toContain("Don't ask me again");
    expect(text).toContain('Cancel');
    expect(text).toContain('Remove');
  });

  it('leaves the checkbox out unless asked for', async () => {
    await render({ rememberChoise: false });

    expect(el().querySelector('mat-checkbox')).toBeNull();
  });

  it('confirms on Enter and cancels on Escape, without remembering by default', async () => {
    await render();

    press('Enter');
    expect(close).toHaveBeenLastCalledWith({ value: true, rememberChoise: false });

    press('Escape');
    expect(close).toHaveBeenLastCalledWith({ value: false, rememberChoise: false });
  });

  it('passes the ticked checkbox along', async () => {
    await render();

    el().querySelector<HTMLInputElement>('mat-checkbox input')!.click();
    await fixture.whenStable();
    press('Enter');

    expect(close).toHaveBeenLastCalledWith({ value: true, rememberChoise: true });
  });
});
