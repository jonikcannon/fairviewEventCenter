// Admin-adjustable font size and family for the site's customizable text.
// Overrides are stored per field *kind* (e.g. every FAQ question shares one),
// keyed by the ids below, and applied inline via [ngStyle]. An unset field
// falls through to the stylesheet, so an untouched site renders as before.

export type TextStyle = { size?: number; font?: string };
export type TextStyles = Record<string, TextStyle>;

// Web-safe stacks only: nothing to download, and no third-party font host to
// allow in the CSP. Ids (not stacks) are what gets stored and validated, so a
// saved value can never inject arbitrary CSS. Keep in sync with
// fairviewApi/content.js.
export const TEXT_FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'georgia', label: 'Georgia (serif)', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'times', label: 'Times New Roman (serif)', stack: "'Times New Roman', Times, serif" },
  { id: 'palatino', label: 'Palatino (serif)', stack: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { id: 'arial', label: 'Arial (sans-serif)', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'verdana', label: 'Verdana (sans-serif)', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet (sans-serif)', stack: "'Trebuchet MS', Helvetica, sans-serif" },
  { id: 'courier', label: 'Courier (monospace)', stack: "'Courier New', Courier, monospace" }
];

export const TEXT_SIZE_MIN = 8;
export const TEXT_SIZE_MAX = 120;

// Hero eyebrow/headline/intro already have their own size sliders, so those
// keys take a font only.
export const FONT_ONLY_KEYS = new Set(['hero.eyebrow', 'hero.headline', 'hero.intro']);

// Returns the inline style for a field, or an empty object when nothing is
// overridden. The size is capped at 11vw so a large desktop size cannot
// overflow a phone screen.
export function textStyle(styles: TextStyles | undefined, key: string): Record<string, string> {
  const entry = styles?.[key];
  const result: Record<string, string> = {};
  if (!entry) return result;
  if (entry.size && !FONT_ONLY_KEYS.has(key)) result['font-size'] = `min(${entry.size}px, 11vw)`;
  const font = TEXT_FONTS.find(option => option.id === entry.font);
  if (font) result['font-family'] = font.stack;
  return result;
}
