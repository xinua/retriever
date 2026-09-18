/**
 * Presentation-only settings, kept apart from the `settings` table because
 * nothing here changes what the app does - only what it looks like.
 *
 * The two lists below are the source of truth for what the API accepts, and
 * they mirror the BgType / ThemeColors enums on the frontend. A colour added
 * here also needs a generated palette block in the frontend's
 * material-theme.scss, or the UI will store it and then render the base theme;
 * a background needs its class in styles.css and, if it has moving parts, an
 * entry in BgDirective's animation map.
 */
export const BG_TYPES = [
  "dotted",
  "striped",
  "glass",
  "gradient",
  "fire",
  "stars",
  "snow",
  "rain",
  "matrix",
  "none"
] as const;
export type BgType = (typeof BG_TYPES)[number];

export const THEME_COLORS = ["red", "green", "blue", "yellow", "purple", "orange", "pink"] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

export interface UiConfigPayload {
  sectionsBg: BgType;
  themeColor: ThemeColor;
  enableAnimations: boolean;
  autoPaste: boolean;
}

/** Must stay in step with DefaultUiConfig on the frontend. */
export const DEFAULT_UI_CONFIG: UiConfigPayload = {
  sectionsBg: "dotted",
  themeColor: "red",
  enableAnimations: true,
  autoPaste: false
};
