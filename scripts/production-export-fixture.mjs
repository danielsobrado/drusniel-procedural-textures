import { writeFile } from 'node:fs/promises';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

export const PRODUCTION_FIXTURE_FILE_NAME = 'ptl-production-export-fixture.glb';
export const PRODUCTION_MESH_NAMES = ['AtlasMeshA', 'AtlasMeshB', 'AutoUvMesh'];

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
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length), 0x20)]);
  const paddedBin = Buffer.concat([binary, Buffer.alloc(pad4(binary.length))]);
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

export async function createProductionExportFixture(path) {
  const chunks = [];
  const positions = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    -0.65, -0.55, 0,
     0.65, -0.55, 0,
    -0.65,  0.55, 0,
     0.65,  0.55, 0
  ])));
  const normals = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1
  ])));
  const uvs = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1
  ])));
  const indices = appendSegment(chunks, typedArrayBuffer(new Uint16Array([
    0, 1, 2,
    2, 1, 3
  ])));
  const binary = Buffer.concat(chunks);

  const basePrimitive = {
    attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
    indices: 3,
    material: 0
  };
  const json = {
    asset: { version: '2.0', generator: 'Procedural Texture Lab production export fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'ProductionRoot', children: [1, 2, 3] },
      { name: PRODUCTION_MESH_NAMES[0], translation: [-1.5, 0, 0], mesh: 0 },
      { name: PRODUCTION_MESH_NAMES[1], translation: [0, 0.35, 0], mesh: 1 },
      { name: PRODUCTION_MESH_NAMES[2], translation: [1.5, -0.15, 0], mesh: 2 }
    ],
    meshes: [
      { name: 'AtlasGeometryA', primitives: [{ ...basePrimitive }] },
      { name: 'AtlasGeometryB', primitives: [{ ...basePrimitive }] },
      {
        name: 'NeedsAutomaticUvPacking',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 3, material: 0 }]
      }
    ],
    materials: [{
      name: 'FixtureSourceMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [0.55, 0.58, 0.62, 1],
        metallicFactor: 0,
        roughnessFactor: 0.5
      }
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [-0.65, -0.55, 0],
        max: [0.65, 0.55, 0]
      },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, ...positions, target: 34962 },
      { buffer: 0, ...normals, target: 34962 },
      { buffer: 0, ...uvs, target: 34962 },
      { buffer: 0, ...indices, target: 34963 }
    ],
    buffers: [{ byteLength: binary.length }]
  };

  await writeFile(path, glbBuffer(json, binary));
}

function namedNode(json, name) {
  const node = (json.nodes ?? []).find((candidate) => candidate?.name === name);
  if (node === undefined) throw new Error(`Production export is missing node ${name}.`);
  return node;
}

function primitiveForNode(json, name) {
  const node = namedNode(json, name);
  const primitive = json.meshes?.[node.mesh]?.primitives?.[0];
  if (primitive === undefined) throw new Error(`Production export node ${name} has no mesh primitive.`);
  return primitive;
}

export function assertProductionExport(json) {
  const primitives = PRODUCTION_MESH_NAMES.map((name) => primitiveForNode(json, name));
  const materialIndices = new Set(primitives.map((primitive) => primitive.material));
  if (materialIndices.size !== 1) throw new Error('Assigned meshes did not share one baked atlas material.');
  const materialIndex = primitives[0]?.material;
  const material = json.materials?.[materialIndex];
  if (material?.name !== 'PTL export atlas') throw new Error('Shared baked atlas material is missing.');

  for (const [index, primitive] of primitives.entries()) {
    if (primitive.attributes?.TEXCOORD_0 === undefined) {
      throw new Error(`${PRODUCTION_MESH_NAMES[index]} did not receive export UV coordinates.`);
    }
    const accessor = json.accessors?.[primitive.attributes?.POSITION];
    const minZ = accessor?.min?.[2] ?? 0;
    const maxZ = accessor?.max?.[2] ?? 0;
    if (Math.abs(minZ) <= 1e-5 && Math.abs(maxZ) <= 1e-5) {
      throw new Error(`${PRODUCTION_MESH_NAMES[index]} did not preserve authored displacement in its exported silhouette.`);
    }
  }

  const pbr = material.pbrMetallicRoughness;
  if (pbr?.baseColorTexture === undefined || pbr?.metallicRoughnessTexture === undefined || material.normalTexture === undefined) {
    throw new Error('Shared atlas is missing required baked PBR texture bindings.');
  }
  const clearcoat = material.extensions?.KHR_materials_clearcoat;
  if (clearcoat?.clearcoatTexture === undefined || clearcoat.clearcoatRoughnessTexture === undefined) {
    throw new Error('Shared atlas is missing baked clearcoat texture bindings.');
  }
}
