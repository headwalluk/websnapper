import { DEFAULT_PRESET_SLUG, presetFits, VIEWPORT_PRESETS, type ViewportPreset } from '../browser/viewports.js';
import { IMAGE_FORMATS, type Config, type ImageFormat } from '../config.js';
import { ServiceError } from '../errors.js';

export const WAIT_MODES = ['load', 'networkidle'] as const;
export type WaitMode = (typeof WAIT_MODES)[number];

const MAX_TARGET_URL_LENGTH = 4096;
const MIN_QUALITY = 1;
const MAX_QUALITY = 100;
const MIN_DIMENSION_PX = 1;
const KNOWN_PARAMETERS = new Set(['url', 'viewport', 'width', 'height', 'full', 'format', 'quality', 'wait', 'delay_ms']);

export interface SnapshotViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  isLandscape: boolean;
  userAgent: string | null;
}

export interface SnapshotRequest {
  url: URL;
  viewport: SnapshotViewport;
  fullPage: boolean;
  format: ImageFormat;
  /** Undefined for PNG, which is lossless. */
  quality: number | undefined;
  wait: WaitMode;
  delayMs: number;
}

/** Reads a whole number parameter within bounds, recording a problem otherwise. */
function integerParameter(parameters: URLSearchParams, name: string, minimum: number, maximum: number, problems: string[]): number | undefined {
  const value = parameters.get(name);
  if (value === null) {
    return undefined;
  }
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  const isValid = Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum;
  if (!isValid) {
    problems.push(`${name} must be a whole number from ${minimum} to ${maximum}; got "${value}".`);
  }
  return isValid ? parsed : undefined;
}

/** Reads the target URL, which must be an absolute http(s) URL. */
function targetUrl(parameters: URLSearchParams, problems: string[]): URL {
  const value = parameters.get('url');
  let parsed = new URL('http://invalid.invalid/');
  if (value === null || value.trim() === '') {
    problems.push('url is required.');
  } else if (value.length > MAX_TARGET_URL_LENGTH) {
    problems.push(`url must be at most ${MAX_TARGET_URL_LENGTH} characters.`);
  } else if (!URL.canParse(value)) {
    problems.push(`url must be an absolute URL; got "${value}".`);
  } else {
    parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      problems.push(`url must use http or https; got "${parsed.protocol}".`);
    }
  }
  return parsed;
}

/** Works out the viewport from a preset slug or explicit width and height. */
function viewportFrom(parameters: URLSearchParams, fullPage: boolean, limits: Config['snapshot'], problems: string[]): SnapshotViewport {
  const slug = parameters.get('viewport');
  const width = integerParameter(parameters, 'width', MIN_DIMENSION_PX, limits.maxWidthPx, problems);
  const height = integerParameter(parameters, 'height', MIN_DIMENSION_PX, limits.maxHeightPx, problems);
  const hasCustomSize = parameters.has('width') || parameters.has('height');
  const fallback = VIEWPORT_PRESETS.get(DEFAULT_PRESET_SLUG);
  if (fallback === undefined) {
    throw new Error(`The default viewport preset "${DEFAULT_PRESET_SLUG}" is missing.`);
  }
  let viewport: SnapshotViewport = fallback;
  let preset: ViewportPreset | undefined = fallback;
  if (slug !== null && hasCustomSize) {
    problems.push('Give either viewport or width/height, not both.');
  } else if (slug !== null) {
    preset = VIEWPORT_PRESETS.get(slug);
    if (preset === undefined) {
      problems.push(`Unknown viewport "${slug}". GET /v1/viewports lists them.`);
    } else {
      viewport = preset;
    }
  } else if (hasCustomSize) {
    preset = undefined;
    if (!parameters.has('width')) {
      problems.push('width is required when height is given.');
    }
    if (!parameters.has('height') && !fullPage) {
      problems.push('Give height, or full=1 to capture the full rendered height.');
    }
    // A width-only full-page capture starts from the default height, kept inside the limit.
    const startHeight = Math.min(fallback.height, limits.maxHeightPx);
    viewport = { ...fallback, width: width ?? fallback.width, height: height ?? startHeight, userAgent: null };
  } else {
    // No size given: the default preset.
  }
  if (preset !== undefined && !presetFits(preset, limits)) {
    problems.push(`Viewport "${preset.slug}" (${preset.width}x${preset.height}) is larger than this server allows `
      + `(${limits.maxWidthPx}x${limits.maxHeightPx}). Choose another from GET /v1/viewports, or give width and height.`);
  }
  return viewport;
}

/** Reads a 0/1 flag parameter. */
function flagParameter(parameters: URLSearchParams, name: string, problems: string[]): boolean {
  const value = parameters.get(name);
  if (value !== null && value !== '0' && value !== '1') {
    problems.push(`${name} must be 0 or 1; got "${value}".`);
  }
  return value === '1';
}

/** Validates snapshot parameters, reporting every problem at once as invalid_request. */
export function parseSnapshotRequest(parameters: URLSearchParams, limits: Config['snapshot']): SnapshotRequest {
  const problems: string[] = [];
  for (const name of new Set(parameters.keys())) {
    if (!KNOWN_PARAMETERS.has(name)) {
      problems.push(`Unknown parameter "${name}".`);
    } else if (parameters.getAll(name).length > 1) {
      problems.push(`${name} was given more than once.`);
    }
  }
  const url = targetUrl(parameters, problems);
  const fullPage = flagParameter(parameters, 'full', problems);
  const viewport = viewportFrom(parameters, fullPage, limits, problems);

  const formatValue = parameters.get('format') ?? limits.defaultFormat;
  const format = IMAGE_FORMATS.find((candidate) => candidate === formatValue);
  if (format === undefined) {
    problems.push(`format must be one of ${IMAGE_FORMATS.join(', ')}; got "${formatValue}".`);
  }
  const requestedQuality = integerParameter(parameters, 'quality', MIN_QUALITY, MAX_QUALITY, problems);
  if (format === 'png' && parameters.has('quality')) {
    problems.push('quality applies to jpeg and webp only.');
  }
  const waitValue = parameters.get('wait') ?? 'load';
  const wait = WAIT_MODES.find((candidate) => candidate === waitValue);
  if (wait === undefined) {
    problems.push(`wait must be one of ${WAIT_MODES.join(', ')}; got "${waitValue}".`);
  }
  const delayMs = integerParameter(parameters, 'delay_ms', 0, limits.maxDelayMs, problems) ?? 0;

  if (problems.length > 0) {
    throw new ServiceError('invalid_request', problems.join(' '));
  }
  const resolvedFormat = format ?? limits.defaultFormat;
  return {
    url,
    viewport,
    fullPage,
    format: resolvedFormat,
    quality: resolvedFormat === 'png' ? undefined : requestedQuality ?? limits.defaultQuality,
    wait: wait ?? 'load',
    delayMs,
  };
}
