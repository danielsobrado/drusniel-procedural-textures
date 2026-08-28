import { describe, expect, it } from 'vitest';
import {
  Ktx2TextureResolver,
  type Ktx2SupportRenderer
} from '../src/assets/Ktx2TextureResolver';

/**
 * detectSupport() only reads compressed-format capabilities off the renderer, so a stub that
 * reports no extensions is enough to reach the transcoder initialization we want to fail.
 */
function supportRendererStub(): Ktx2SupportRenderer {
  return {
    isWebGPURenderer: false,
    extensions: {
      has: () => false,
      get: () => null
    }
  } as unknown as Ktx2SupportRenderer;
}

describe('KTX2 transcoder retry', () => {
  it('replays a transcoder failure instead of refetching it for every texture field', async () => {
    const resolver = new Ktx2TextureResolver();
    let rendererRequests = 0;
    resolver.setSupportRendererProvider(async () => {
      rendererRequests += 1;
      return supportRendererStub();
    });

    try {
      // The transcoder assets cannot be fetched under the test runner, so init() fails here the
      // same way it does when they are missing, blocked, or unsupported in a browser.
      await expect(resolver.resolve('perlin.01')).rejects.toThrow(/transcoder/iu);
      expect(rendererRequests).toBe(1);

      // A second field must not rebuild a KTX2Loader or re-request the ~570 KB transcoder pair.
      await expect(resolver.resolve('perlin.02')).rejects.toThrow(/transcoder/iu);
      expect(rendererRequests).toBe(1);
    } finally {
      resolver.dispose();
    }
  });

  it('keeps retrying immediately when the support renderer is not ready yet', async () => {
    const resolver = new Ktx2TextureResolver();
    let attempts = 0;
    resolver.setSupportRendererProvider(async () => {
      attempts += 1;
      throw new Error('Renderer is not ready.');
    });

    try {
      // A provider failure is transient by nature: the renderer is still initializing. It must
      // not be parked behind the transcoder cooldown.
      await expect(resolver.resolve('perlin.01')).rejects.toThrow(/not ready/iu);
      await expect(resolver.resolve('perlin.01')).rejects.toThrow(/not ready/iu);
      expect(attempts).toBe(2);
    } finally {
      resolver.dispose();
    }
  });
});
