import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtimeUrl = new URL('../dist-runtime/index.js', import.meta.url);
const runtime = await import(runtimeUrl.href);

const recipe = {
  format: 'ptl-material',
  version: 1,
  seed: 42,
  coordinateSpace: 'object',
  groups: [],
  layers: [{
    id: 'base',
    name: 'Base',
    kind: 'base',
    enabled: true,
    blendMode: 'normal',
    channel: 'surface',
    opacity: 1,
    scale: 1,
    strength: 1,
    seed: 1,
    colorA: '#202830',
    colorB: '#9099a2',
    roughness: 0.1,
    displacement: 0,
    groupId: null,
    maskSourceLayerId: null,
    structureSourceLayerId: null,
    maskInvert: false,
    maskStrength: 1
  }]
};

const parsed = runtime.parseMaterialRecipe(recipe);
assert.equal(parsed.coordinateSpace, 'object');
assert.equal(parsed.algorithms.version, runtime.PTL_ALGORITHM_VERSION);

const material = new runtime.ProceduralMaterial(parsed);
try {
  assert.equal(material.material.isMeshPhysicalMaterial, true);
  assert.equal(material.seed, 42);
} finally {
  material.dispose();
}

const bundle = await readFile(runtimeUrl, 'utf8');
assert.equal(bundle.includes('lab.yaml'), false, 'runtime bundle must not include editor YAML config');
assert.equal(bundle.includes('TextureBaker'), false, 'runtime bundle must not include editor baking code');

console.log('Runtime package smoke passed.');
