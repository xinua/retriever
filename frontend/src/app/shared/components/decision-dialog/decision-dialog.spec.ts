import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { Decision, DecisionDialog } from './decision-dialog';

describe('DecisionDialog', () => {
  let fixture: ComponentFixture<DecisionDialog>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [DecisionDialog],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { title: 'Replace poster', message: 'Replace it?', cancelText: 'No', actionText: 'Yes' },
        },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DecisionDialog);
    await fixture.whenStable();
  });

  const buttons = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('button'));
  const pressEnter = (target: HTMLElement) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  it('shows the title, message and button labels', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Replace poster');
    expect(text).toContain('Replace it?');
    expect(text).toContain('No');
    expect(text).toContain('Yes');
  });

  it('closes without a decision from the close button', () => {
    buttons()[0].click();

    expect(close).toHaveBeenCalledWith(null);
  });

  it('confirms on Enter', () => {
    pressEnter(fixture.nativeElement.querySelector('p'));

    expect(close).toHaveBeenCalledWith(Decision.CONFIRM);
  });

  it('leaves Enter on a focused button to that button', () => {
    pressEnter(buttons()[1]);

    expect(close).not.toHaveBeenCalledWith(Decision.CONFIRM);
  });
});
