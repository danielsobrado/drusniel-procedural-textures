import { readFile, writeFile } from 'node:fs/promises';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const ORIGINAL_MATERIAL_NAME = 'FixtureOriginalMaterial';
const LAB_MESH_NAME = 'LabMesh';
const ORIGINAL_MESH_NAME = 'OriginalMesh';
const ROOT_NAME = 'FixtureRoot';
const ROOT_TRANSLATION = [2, 3, 4];
const ROOT_ROTATION = [0, 0, 0.24740395925452294, 0.9689124217106447];
const ROOT_SCALE = [1.5, 0.75, 2];
const ORIGINAL_ROUGHNESS = 0.73;
const ORIGINAL_METALNESS = 0.11;
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function pad4(length) {
  return (4 - (length % 4)) % 4;
}

function typedArrayBuffer(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function appendSegment(chunks, buffer) {
  const offset = chunks.reduce((total, chunk) => total + chunk.length, 0);
  chunks.push(buffer);
  const padding = pad4(buffer.length);
  if (padding > 0) chunks.push(Buffer.alloc(padding));
  return { byteOffset: offset, byteLength: buffer.length };
}

function glbBuffer(json, binary) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = pad4(jsonBytes.length);
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = pad4(binary.length);
  const paddedBin = Buffer.concat([binary, Buffer.alloc(binPadding)]);
  const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBin.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(GLB_VERSION, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK_TYPE, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBin.length, 0);
  binHeader.writeUInt32LE(BIN_CHUNK_TYPE, 4);

  return Buffer.concat([header, jsonHeader, paddedJson, binHeader, paddedBin]);
}

export async function createRoundtripFixture(path) {
  const chunks = [];
  const positions = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    -0.5, -0.5, 0,
     0.5, -0.5, 0,
     0.0,  0.5, 0
  ])));
  const normals = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1
  ])));
  const uvs = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    0, 0,
    1, 0,
    0.5, 1
  ])));
  const indices = appendSegment(chunks, typedArrayBuffer(new Uint16Array([0, 1, 2])));
  const image = appendSegment(chunks, PNG_1X1);
  const binary = Buffer.concat(chunks);

  const json = {
    asset: { version: '2.0', generator: 'Procedural Texture Lab browser smoke fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: ROOT_NAME,
        translation: ROOT_TRANSLATION,
        rotation: ROOT_ROTATION,
        scale: ROOT_SCALE,
        children: [1, 2]
      },
      { name: LAB_MESH_NAME, translation: [1, 0, 0], mesh: 0 },
      { name: ORIGINAL_MESH_NAME, translation: [-1, 0.5, 0], mesh: 1 }
    ],
    meshes: [
      {
        name: 'FixtureLabGeometry',
        primitives: [{
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices: 3,
          material: 0
        }]
      },
      {
        name: 'FixtureOriginalGeometry',
        primitives: [{
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices: 3,
          material: 1
        }]
      }
    ],
    materials: [
      {
        name: 'FixtureLabSourceMaterial',
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.35, 0.9, 1],
          metallicFactor: 0,
          roughnessFactor: 0.5
        }
      },
      {
        name: ORIGINAL_MATERIAL_NAME,
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          baseColorTexture: { index: 0 },
          metallicFactor: ORIGINAL_METALNESS,
          roughnessFactor: ORIGINAL_ROUGHNESS
        }
      }
    ],
    samplers: [{}],
    textures: [{ sampler: 0, source: 0 }],
    images: [{ name: 'FixtureOriginalTexture', mimeType: 'image/png', bufferView: 4 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.5, -0.5, 0],
        max: [0.5, 0.5, 0]
      },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, ...positions, target: 34962 },
      { buffer: 0, ...normals, target: 34962 },
      { buffer: 0, ...uvs, target: 34962 },
      { buffer: 0, ...indices, target: 34963 },
      { buffer: 0, ...image }
    ],
    buffers: [{ byteLength: binary.length }]
  };

  await writeFile(path, glbBuffer(json, binary));
}

export async function readGlbJson(path) {
  const data = await readFile(path);
  if (data.length < 20 || data.readUInt32LE(0) !== GLB_MAGIC || data.readUInt32LE(4) !== GLB_VERSION) {
    throw new Error('Exported fixture is not a valid GLB 2.0 container.');
  }
  if (data.readUInt32LE(8) !== data.length) {
    throw new Error('Exported fixture GLB length header does not match the file size.');
  }
  const jsonLength = data.readUInt32LE(12);
  const jsonType = data.readUInt32LE(16);
  if (jsonType !== JSON_CHUNK_TYPE || 20 + jsonLength > data.length) {
    throw new Error('Exported fixture does not contain a valid first JSON chunk.');
  }
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

function assertArrayClose(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new Error(`${label} is missing or has the wrong size.`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (Math.abs(actual[index] - expected[index]) > 1e-5) {
      throw new Error(`${label} changed during export.`);
    }
  }
}

function requireNamedNode(json, name) {
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const index = nodes.findIndex((node) => node?.name === name);
  if (index < 0) throw new Error(`Exported GLB is missing node ${name}.`);
  return nodes[index];
}

function materialForNode(json, node) {
  const mesh = json.meshes?.[node.mesh];
  const primitive = mesh?.primitives?.[0];
  const material = json.materials?.[primitive?.material];
  if (material === undefined) throw new Error(`Node ${node.name ?? '<unnamed>'} has no exported material.`);
  return material;
}

function assertTextureReference(json, textureInfo, label) {
  const texture = json.textures?.[textureInfo?.index];
  const image = json.images?.[texture?.source];
  if (texture === undefined || image === undefined) {
    throw new Error(`${label} does not reference an embedded image.`);
  }
  if (image.bufferView === undefined && typeof image.uri !== 'string') {
    throw new Error(`${label} image has no embedded bufferView or URI.`);
  }
}

export function assertRoundtripExport(json) {
  if (json?.asset?.version !== '2.0') throw new Error('Exported fixture is not glTF 2.0.');

  const root = requireNamedNode(json, ROOT_NAME);
  assertArrayClose(root.translation, ROOT_TRANSLATION, 'Fixture root translation');
  assertArrayClose(root.rotation, ROOT_ROTATION, 'Fixture root rotation');
  assertArrayClose(root.scale, ROOT_SCALE, 'Fixture root scale');

  const original = materialForNode(json, requireNamedNode(json, ORIGINAL_MESH_NAME));
  if (original.name !== ORIGINAL_MATERIAL_NAME) {
    throw new Error('Original mesh material name was not preserved.');
  }
  const originalPbr = original.pbrMetallicRoughness;
  if (Math.abs((originalPbr?.roughnessFactor ?? -1) - ORIGINAL_ROUGHNESS) > 1e-6) {
    throw new Error('Original mesh roughness was not preserved.');
  }
  if (Math.abs((originalPbr?.metallicFactor ?? -1) - ORIGINAL_METALNESS) > 1e-6) {
    throw new Error('Original mesh metalness was not preserved.');
  }
  assertTextureReference(json, originalPbr?.baseColorTexture, 'Original base-color texture');

  const lab = materialForNode(json, requireNamedNode(json, LAB_MESH_NAME));
  if (typeof lab.name !== 'string' || !lab.name.startsWith('PTL export ')) {
    throw new Error('Lab-assigned mesh did not receive a baked PTL material.');
  }
  const labPbr = lab.pbrMetallicRoughness;
  assertTextureReference(json, labPbr?.baseColorTexture, 'Baked base-color texture');
  assertTextureReference(json, labPbr?.metallicRoughnessTexture, 'Baked roughness texture');
  assertTextureReference(json, lab.normalTexture, 'Baked normal texture');

  const clearcoat = lab.extensions?.KHR_materials_clearcoat;
  if (clearcoat === undefined) throw new Error('Baked material is missing KHR_materials_clearcoat.');
  assertTextureReference(json, clearcoat.clearcoatTexture, 'Baked clearcoat texture');
  assertTextureReference(json, clearcoat.clearcoatRoughnessTexture, 'Baked clearcoat roughness texture');
}
