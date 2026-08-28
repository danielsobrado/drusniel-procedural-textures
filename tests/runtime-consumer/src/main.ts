import * as THREE from 'three';
import {
  DEFAULT_TEXTURE_FIELD_SETTINGS,
  PTL_ALGORITHM_VERSION,
  PTL_GENERATED_TEXTURE_FIELD_FAMILIES,
  PTL_GENERATED_TEXTURE_FIELD_VERSION,
  ProceduralMaterial,
  parseMaterialRecipe,
  type MaterialRecipe,
  type ResolvedTextureField,
  type TextureResolver
} from '@drusniel/ptl-runtime';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const recipe = parseMaterialRecipe({
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
});

const typedRecipe: MaterialRecipe = recipe;
assert(typedRecipe.algorithms.version === PTL_ALGORITHM_VERSION, 'Algorithm version mismatch.');
assert(PTL_GENERATED_TEXTURE_FIELD_VERSION === 1, 'Generated texture-field version mismatch.');
assert(PTL_GENERATED_TEXTURE_FIELD_FAMILIES.includes('perlin'), 'Generated perlin family is missing.');

const packedTexture = new THREE.DataTexture(new Uint8Array([64, 128, 192, 255]), 1, 1);
let packedResolveCount = 0;
const packedResolver: TextureResolver = {
  async resolve(): Promise<ResolvedTextureField> {
    packedResolveCount += 1;
    return { texture: packedTexture, channel: 'b' };
  }
};

const runtime = new ProceduralMaterial(recipe, { textureResolver: packedResolver });
const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
const previous = mesh.material;
try {
  await runtime.prepare();
  runtime.applyTo(mesh);
  assert(runtime.backend === 'webgpu', 'WebGPU must be the default backend.');
  assert(mesh.material === runtime.material, 'Runtime material was not applied.');
  assert(
    (runtime.material as THREE.Material & { isNodeMaterial?: boolean }).isNodeMaterial === true,
    'Default runtime material is not a node material.'
  );
} finally {
  previous.dispose();
  mesh.geometry.dispose();
  runtime.dispose();
}

const texturedRecipe = parseMaterialRecipe({
  ...recipe,
  layers: recipe.layers.map((layer, index) => index === 0
    ? {
        ...layer,
        texture: {
          ...DEFAULT_TEXTURE_FIELD_SETTINGS,
          id: 'perlin.01',
          mode: 'detail',
          modeAmount: 0.4
        }
      }
    : layer),
  dependencies: { textures: [{ id: 'perlin.01', version: 1 }] }
});

const generatedRuntime = new ProceduralMaterial(texturedRecipe, {
  backend: 'webgl',
  generatedTextureFields: { resolution: 32 }
});
try {
  assert(generatedRuntime.textureFieldSource === 'generated', 'Generated fields must be the code-only default.');
  await generatedRuntime.prepare();
} finally {
  generatedRuntime.dispose();
}

const externalRuntime = new ProceduralMaterial(texturedRecipe, {
  backend: 'webgl',
  textureFieldSource: 'external',
  textureResolver: packedResolver
});
try {
  assert(externalRuntime.textureFieldSource === 'external', 'External field source was not selected.');
  await externalRuntime.prepare();
  assert(packedResolveCount === 1, 'External packed resolver was not used exactly once.');
} finally {
  externalRuntime.dispose();
  packedTexture.dispose();
}

console.log('Packed runtime external consumer passed.');
