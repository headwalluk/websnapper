import { KnownDevices } from 'puppeteer-core';
import type { Config } from '../config.js';

/** The CSS-pixel limits a viewport must fit inside. */
export type ViewportLimits = Pick<Config['snapshot'], 'maxWidthPx' | 'maxHeightPx'>;

export interface ViewportPreset {
  slug: string;
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  isLandscape: boolean;
  userAgent: string | null;
}

/** Plain browser-window sizes, with the desktop user agent. */
const BASIC_PRESETS: readonly ViewportPreset[] = [
  { slug: 'desktop', label: 'Desktop', width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true, userAgent: null },
  { slug: 'desktop-hd', label: 'Desktop HD', width: 2560, height: 1440, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true, userAgent: null },
  { slug: 'laptop', label: 'Laptop', width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true, userAgent: null },
  { slug: 'tablet', label: 'Tablet', width: 768, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false, userAgent: null },
  { slug: 'mobile', label: 'Mobile', width: 390, height: 844, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false, userAgent: null },
];

export const DEFAULT_PRESET_SLUG = 'desktop';

/** Turns a device name such as "iPhone 11 Pro landscape" into "iphone-11-pro-landscape". */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Builds the preset table: the basic sizes, then every Puppeteer device. */
function buildPresets(): Map<string, ViewportPreset> {
  const presets = new Map<string, ViewportPreset>(BASIC_PRESETS.map((preset) => [preset.slug, preset]));
  for (const [name, device] of Object.entries(KnownDevices)) {
    const slug = slugify(name);
    if (presets.has(slug)) {
      continue;
    }
    presets.set(slug, {
      slug,
      label: name,
      width: device.viewport.width,
      height: device.viewport.height,
      deviceScaleFactor: device.viewport.deviceScaleFactor ?? 1,
      isMobile: device.viewport.isMobile ?? false,
      hasTouch: device.viewport.hasTouch ?? false,
      isLandscape: device.viewport.isLandscape ?? false,
      userAgent: device.userAgent,
    });
  }
  return presets;
}

export const VIEWPORT_PRESETS: ReadonlyMap<string, ViewportPreset> = buildPresets();

/** Whether a preset fits inside the configured width and height limits. */
export function presetFits(preset: ViewportPreset, limits: ViewportLimits): boolean {
  return preset.width <= limits.maxWidthPx && preset.height <= limits.maxHeightPx;
}

/** The presets this server's limits allow, in table order. */
export function availableViewports(limits: ViewportLimits): ViewportPreset[] {
  return [...VIEWPORT_PRESETS.values()].filter((preset) => presetFits(preset, limits));
}
