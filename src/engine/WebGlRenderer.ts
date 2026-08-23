import { WebGLRenderer } from 'three';

export const WEBGL2_UNAVAILABLE_MESSAGE =
  'WebGL2 is unavailable. Texture baking, 3D terrain preview, and GLB export require a WebGL2-capable browser.';

export interface OptionalWebGlRendererParameters {
  canvas?: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
  powerPreference?: WebGLPowerPreference;
}

export function createOptionalWebGlRenderer(
  parameters: Readonly<OptionalWebGlRendererParameters> = {}
): WebGLRenderer | null {
  const canvas = parameters.canvas ?? document.createElement('canvas');
  let context: WebGL2RenderingContext | null = null;

  try {
    context = canvas.getContext('webgl2', {
      alpha: parameters.alpha ?? false,
      antialias: parameters.antialias ?? false,
      depth: true,
      failIfMajorPerformanceCaveat: false,
      powerPreference: parameters.powerPreference ?? 'default',
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false
    });
  } catch {
    return null;
  }

  if (context === null) return null;

  try {
    return new WebGLRenderer({
      ...parameters,
      canvas,
      context: context as unknown as WebGLRenderingContext
    });
  } catch {
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
}
