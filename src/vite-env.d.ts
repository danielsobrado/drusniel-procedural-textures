/// <reference types="vite/client" />

interface Window {
  __PTL_THUMBNAIL_GENERATOR__?: {
    presetIds: readonly string[];
    render: (id: string) => Promise<string>;
    dispose: () => void;
  };
}
