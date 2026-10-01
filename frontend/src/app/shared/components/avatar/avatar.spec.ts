import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RtAvatar } from './avatar';

describe('RtAvatar', () => {
  let component: RtAvatar;
  let fixture: ComponentFixture<RtAvatar>;

  const MOCK_URL = 'https://mockimage.tw/photo/80x80/1f1f1f/ff8800/Avatar%20not%20found';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RtAvatar],
    }).compileComponents();

    fixture = TestBed.createComponent(RtAvatar);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('imgSize', '80x80');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function render(inputs: { sourceImg?: string | null; pending?: boolean; url?: string | null } = {}) {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  }

  const img = (): HTMLImageElement | null => fixture.nativeElement.querySelector('img');
  const preloader = (): HTMLElement | null => fixture.nativeElement.querySelector('.preloader');

  it('shows the source image', async () => {
    await render({ sourceImg: '/avatars/channel.jpg' });
    expect(img().getAttribute('src')).toBe('/avatars/channel.jpg');
  });

  it('falls back to the placeholder when there is no source', async () => {
    await render({ sourceImg: null });
    expect(img().getAttribute('src')).toBe(MOCK_URL);
  });

  it('renders no image while the avatar is still pending', async () => {
    await render({ sourceImg: null, pending: true });

    expect(img()).toBeNull();
    expect(preloader()).not.toBeNull();
  });

  it('hides the preloader once the image has loaded', async () => {
    await render({ sourceImg: '/avatars/channel.jpg' });
    expect(preloader()).not.toBeNull();

    img().dispatchEvent(new Event('load'));
    await fixture.whenStable();
    expect(preloader()).toBeNull();
  });

  it('retries a failed source a few times before giving up on it', async () => {
    vi.useFakeTimers();
    await render({ sourceImg: '/avatars/channel.jpg' });

    for (let attempt = 1; attempt <= 3; attempt++) {
      component.handleImageError();
      vi.advanceTimersByTime(2000);
      expect(component.imgPath()).toBe(`/avatars/channel.jpg?r=${attempt}`);
    }

    component.handleImageError();
    expect(component.imgPath()).toBe(MOCK_URL);
  });

  it('opens the author url in a new tab when clicked', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await render({ sourceImg: '/avatars/channel.jpg', url: 'https://youtube.com/@channel' });

    fixture.nativeElement.querySelector('div').click();
    expect(open).toHaveBeenCalledWith('https://youtube.com/@channel', '_blank');
  });

  it('does nothing when clicked without a url', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await render({ sourceImg: '/avatars/channel.jpg' });

    fixture.nativeElement.querySelector('div').click();
    expect(open).not.toHaveBeenCalled();
  });
});
