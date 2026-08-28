import { describe, expect, it } from 'vitest';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';
import { SURFACE_DESIGNER_CATALOG } from '../src/materials/surfaceDesignerCatalog';
import { SURFACE_DESIGNER_PRESETS } from '../src/materials/surfaceDesignerPresets';

function validatePresetGraph(label: string, graph: unknown): void {
  expect(graph, `${label} must expose an authored graph`).toBeDefined();
  expect(() => compileSurfaceGraph(graph), `${label} must compile through the V0.3 graph contract`).not.toThrow();
}

describe('V0.3 Surface Designer catalog contract', () => {
  it('compiles every authored source preset', () => {
    for (const preset of SURFACE_DESIGNER_PRESETS) validatePresetGraph(preset.id, preset.graph);
  });

  it('compiles every material exposed by the Surface Designer catalog', () => {
    for (const preset of SURFACE_DESIGNER_CATALOG) validatePresetGraph(preset.id, preset.graph);
  });
});
