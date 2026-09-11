import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RtAvatar } from './avatar';

describe('RtAvatar', () => {
  let component: RtAvatar;
  let fixture: ComponentFixture<RtAvatar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RtAvatar],
    }).compileComponents();

    fixture = TestBed.createComponent(RtAvatar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
