import { provideHighlightOptions } from 'ngx-highlightjs';

/**
 * highlight.js for the code examples (rt-code): the core and each language load
 * lazily, so the library stays out of the initial bundle. Specs rendering a
 * component that contains rt-code need this too.
 */
export function provideCodeHighlight() {
  return provideHighlightOptions({
    coreLibraryLoader: () => import('highlight.js/lib/core'),
    languages: {
      yaml: () => import('highlight.js/lib/languages/yaml'),
      javascript: () => import('highlight.js/lib/languages/javascript'),
    },
  });
}
