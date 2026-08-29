export function presetThumbnailUrl(id: string): string {
  return `${import.meta.env.BASE_URL}thumbnails/presets/${encodeURIComponent(id)}.png`;
}

export function presetTerrainTextureUrl(id: string): string {
  return `${import.meta.env.BASE_URL}terrain-presets/${encodeURIComponent(id)}.png`;
}
