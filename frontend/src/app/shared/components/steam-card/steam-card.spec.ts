import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RtSteamCard } from './steam-card';

const SOURCE = '/api/images/poster.jpg';
const MOCK = 'https://mockimage.tw/photo/257x145/1f1f1f/ff8800/Image%20not%20found';

describe('RtSteamCard', () => {
  let fixture: ComponentFixture<RtSteamCard>;
  let component: RtSteamCard;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RtSteamCard],
    }).compileComponents();

    fixture = TestBed.createComponent(RtSteamCard);
    component = fixture.componentInstance;
    host = fixture.nativeElement;
  });

  afterEach(() => vi.useRealTimers());

  function render(inputs: Partial<Record<keyof RtSteamCard, unknown>> = {}) {
    fixture.componentRef.setInput('imageSourceUrl', SOURCE);
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
    fixture.detectChanges();
  }

  const img = (): HTMLImageElement | null => host.querySelector('img');
  const preloader = (): HTMLElement | null => host.querySelector('.preloader');
  const wrapper = (): HTMLElement => host.querySelector('div')!;
  const content = (): HTMLElement => host.querySelector('.rt-card-content')!;
  const shine = (): HTMLElement => host.querySelector('.shine-line')!;

  /** jsdom never fetches images, so load/error have to be fired by hand. */
  function fire(type: 'load' | 'error') {
    img()!.dispatchEvent(new Event(type));
    fixture.detectChanges();
  }

  describe('image', () => {
    it('shows a preloader and hides the image until it loads', () => {
      render();

      expect(img()!.getAttribute('src')).toBe(SOURCE);
      expect(img()!.classList).toContain('hidden!');
      expect(preloader()).not.toBeNull();
    });

    it('sizes the preloader from imgSize', () => {
      render({ imgSize: '320x180' });

      expect(preloader()!.style.minWidth).toBe('320px');
      expect(preloader()!.style.minHeight).toBe('180px');
    });

    it('reveals the image with its custom class once loaded', () => {
      render({ imageClass: 'grayscale' });
      fire('load');

      expect(preloader()).toBeNull();
      expect(img()!.classList).not.toContain('hidden!');
      expect(img()!.classList).toContain('grayscale');
    });

    it('applies customClass to the card content', () => {
      render({ customClass: 'rounded-full' });
      expect(content().classList).toContain('rounded-full');
    });

    it('switches to a new source', () => {
      render();
      render({ imageSourceUrl: '/api/images/other.jpg' });

      expect(img()!.getAttribute('src')).toBe('/api/images/other.jpg');
    });
  });

  describe('missing image', () => {
    it.each([null, ''])('shows the placeholder for a %j source', (imageSourceUrl) => {
      render({ imageSourceUrl });
      expect(img()!.getAttribute('src')).toBe(MOCK);
    });

    it('builds the placeholder from imgSize and mockMessage', () => {
      render({ imageSourceUrl: null, imgSize: '100x50', mockMessage: 'No%20poster' });
      expect(img()!.getAttribute('src')).toBe('https://mockimage.tw/photo/100x50/1f1f1f/ff8800/No%20poster');
    });

    it('renders only the preloader while pending', () => {
      render({ imageSourceUrl: null, pending: true });

      expect(img()).toBeNull();
      expect(preloader()).not.toBeNull();
    });

    it('falls back to the placeholder when the image fails', () => {
      render();
      fire('error');

      expect(img()!.getAttribute('src')).toBe(MOCK);
    });

    it('goes back to the preloader when the source is cleared', () => {
      render();
      fire('load');
      render({ imageSourceUrl: null, pending: true });

      expect(img()).toBeNull();
      expect(preloader()).not.toBeNull();
    });
  });

  describe('retry', () => {
    beforeEach(() => vi.useFakeTimers());

    it('retries a failed image once after two seconds', () => {
      render({ retry: true });
      fire('error');
      expect(img()!.getAttribute('src')).toBe(SOURCE);

      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(img()!.getAttribute('src')).toBe(`${SOURCE}?r=1`);

      fire('error');
      expect(img()!.getAttribute('src')).toBe(MOCK);
    });

    it('retries again after the source changes', () => {
      render({ retry: true });
      fire('error');
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      fire('error');

      render({ imageSourceUrl: '/api/images/other.jpg' });
      fire('error');
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();

      expect(img()!.getAttribute('src')).toBe('/api/images/other.jpg?r=1');
    });

    it('does not retry a missing source', () => {
      render({ retry: true, imageSourceUrl: null });
      fire('error');
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();

      expect(img()!.getAttribute('src')).toBe(MOCK);
    });
  });

  describe('click', () => {
    it('opens the url in a new tab', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const emitted = vi.fn();
      component.cardClick.subscribe(emitted);
      render({ url: 'https://store.steampowered.com' });

      content().click();

      expect(open).toHaveBeenCalledWith('https://store.steampowered.com', '_blank');
      expect(emitted).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it('emits cardClick without a url', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const emitted = vi.fn();
      component.cardClick.subscribe(emitted);
      render();

      content().click();

      expect(emitted).toHaveBeenCalledWith(expect.any(MouseEvent));
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it('shows a pointer cursor only with a url', () => {
      render();
      expect(wrapper().classList).not.toContain('cursor-pointer');

      render({ url: 'https://store.steampowered.com' });
      expect(wrapper().classList).toContain('cursor-pointer');
    });
  });

  describe('tilt', () => {
    beforeEach(() => {
      render();
      vi.spyOn(wrapper(), 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 50,
        width: 200,
        height: 100,
      } as DOMRect);
    });

    function mouse(type: string, clientX = 0, clientY = 0) {
      wrapper().dispatchEvent(new MouseEvent(type, { clientX, clientY }));
      fixture.detectChanges();
    }

    it('starts flat with the shine hidden', () => {
      expect(content().style.transform).toBe('perspective(1000px) rotateX(0deg) rotateY(0deg)');
      expect(shine().classList).not.toContain('visible');
    });

    it('tilts towards the cursor and moves the shine under it', () => {
      // Top-right corner of the card
      mouse('mousemove', 300, 50);

      expect(content().style.transform).toBe('perspective(1000px) rotateX(15deg) rotateY(15deg)');
      expect(shine().style.left).toBe('200px');
      expect(shine().style.top).toBe('0px');
      expect(shine().classList).toContain('visible');
    });

    it('scales the tilt with the distance from the centre', () => {
      // Halfway to the left edge, halfway to the bottom edge
      mouse('mousemove', 150, 125);
      expect(content().style.transform).toBe('perspective(1000px) rotateX(-7.5deg) rotateY(-7.5deg)');
    });

    it('flattens and hides the shine when the mouse leaves', () => {
      mouse('mousemove', 300, 50);
      mouse('mouseleave');

      expect(content().style.transform).toBe('perspective(1000px) rotateX(0deg) rotateY(0deg)');
      expect(shine().classList).not.toContain('visible');
    });
  });
});
