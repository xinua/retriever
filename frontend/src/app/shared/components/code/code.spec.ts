import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NotifierService } from 'angular-notifier';

import { provideCodeHighlight } from '../../providers';
import { Code } from './code';

describe('Code', () => {
  let component: Code;
  let fixture: ComponentFixture<Code>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Code],
      providers: [provideCodeHighlight(), { provide: NotifierService, useValue: { notify: vi.fn() } }],
    }).compileComponents();

    fixture = TestBed.createComponent(Code);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('language', 'yaml');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
