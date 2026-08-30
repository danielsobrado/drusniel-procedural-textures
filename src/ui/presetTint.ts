import { presetThumbnailUrl } from '../assets/PresetAssets';

const SAMPLE_SIZE = 4;
/**
 * Preset thumbnails are a rendered sphere on a dark backdrop, so averaging the whole image
 * returns something far darker and less saturated than the material. Only the centre is
 * reliably sphere.
 */
const CENTRE_CROP = 0.5;

const tints = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

async function computeTint(presetId: string): Promise<string | null> {
  try {
    const response = await fetch(presetThumbnailUrl(presetId));
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return null;
      const crop = Math.max(1, Math.round(Math.min(bitmap.width, bitmap.height) * CENTRE_CROP));
      context.drawImage(
        bitmap,
        (bitmap.width - crop) / 2,
        (bitmap.height - crop) / 2,
        crop,
        crop,
        0,
        0,
        SAMPLE_SIZE,
        SAMPLE_SIZE
      );
      const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let index = 0; index < data.length; index += 4) {
        red += data[index] ?? 0;
        green += data[index + 1] ?? 0;
        blue += data[index + 2] ?? 0;
      }
      const count = SAMPLE_SIZE * SAMPLE_SIZE;
      return `rgb(${Math.round(red / count)}, ${Math.round(green / count)}, ${Math.round(blue / count)})`;
    } finally {
      bitmap.close();
    }
  } catch {
    // A stand-in colour is a nicety; failing to derive one must never break an assignment.
    return null;
  }
}

/** Synchronous read for a tint already derived, so the first paint costs nothing. */
export function cachedPresetTint(presetId: string): string | null {
  return tints.get(presetId) ?? null;
}

/**
 * Average colour of a preset's thumbnail, memoised per id. Used as a sub-frame stand-in
 * while the real nine-channel atlas downloads, so picking never feels like it stalled.
 */
export async function loadPresetTint(presetId: string): Promise<string | null> {
  if (tints.has(presetId)) return tints.get(presetId) ?? null;
  const inFlight = pending.get(presetId);
  if (inFlight !== undefined) return inFlight;
  const request = computeTint(presetId).then((tint) => {
    tints.set(presetId, tint);
    pending.delete(presetId);
    return tint;
  });
  pending.set(presetId, request);
  return request;
}
