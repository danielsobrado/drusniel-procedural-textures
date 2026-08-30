/// <reference types="vite/client" />

interface Window {
  __PTL_THUMBNAIL_GENERATOR__?: {
    presetIds: readonly string[];
    terrainAtlasSize: number;
    render: (id: string) => Promise<string>;
    renderTerrain: (id: string) => Promise<string>;
    dispose: () => void;
  };
}
