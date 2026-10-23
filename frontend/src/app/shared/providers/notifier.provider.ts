import { EnvironmentProviders, importProvidersFrom } from '@angular/core';
import { NotifierModule, NotifierOptions } from 'angular-notifier';

/**
 * angular-notifier ships as an NgModule whose services (NotifierService and the
 * NotifierQueueService it pushes actions onto) are plain `@Injectable()` — no
 * `providedIn: 'root'`. Whichever injector imports the module gets its own copy
 * of the whole set, and the queue service is the bus the container listens on,
 * so two copies means notifications that are pushed but never rendered.
 *
 * Hence exactly one call site: the root environment injector, via appConfig.
 * `NotifierModule.withConfig()` is what supplies NotifierConfigToken, and the
 * package treats that config as global and immutable, so it may only be applied
 * here — never a second time in a component or a route's providers.
 */
export const NOTIFIER_CONFIG: NotifierOptions = {
  position: {
    horizontal: { position: 'left', distance: 12 },
    vertical: { position: 'bottom', distance: 12, gap: 10 },
  },
  theme: 'material',
  behaviour: { autoHide: 10000, onClick: 'hide', onMouseover: 'pauseAutoHide', showDismissButton: false, stacking: 4 },
  animations: {
    enabled: true,
    show: { preset: 'slide', speed: 300, easing: 'ease' },
    hide: { preset: 'slide', speed: 300, easing: 'ease', offset: 50 },
    shift: { speed: 300, easing: 'ease' },
    overlap: 150,
  },
};

/**
 * Returns `EnvironmentProviders`, not `Provider[]`. That is the type
 * `importProvidersFrom()` produces and it is only accepted where an environment
 * injector is being configured — `ApplicationConfig.providers`, a `Route`'s
 * `providers`, `createEnvironmentInjector()`. A component's `providers` array is
 * typed `Provider[]` and rejects it, which is the real meaning of
 * "Type 'EnvironmentProviders' is not assignable to type 'Provider'": the
 * compiler is pointing out that a component injector is the wrong home for this.
 */
export function provideNotifier(options: NotifierOptions = NOTIFIER_CONFIG): EnvironmentProviders {
  return importProvidersFrom(NotifierModule.withConfig(options));
}
