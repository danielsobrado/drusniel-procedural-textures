import { readFile, writeFile } from 'node:fs/promises';
import validator from 'gltf-validator';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const ORIGINAL_MATERIAL_NAME = 'FixtureOriginalMaterial';
const LAB_MESH_NAME = 'LabMesh';
const ORIGINAL_MESH_NAME = 'OriginalMesh';
const ROOT_NAME = 'FixtureRoot';
const MIRROR_NAME = 'MirroredParent';
const ROOT_TRANSLATION = [2, 3, 4];
const ROOT_ROTATION = [0, 0, 0.24740395925452294, 0.9689124217106447];
const ROOT_SCALE = [1.5, 0.75, 2];
const MIRROR_SCALE = [-1, 1, 1];
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
  const joints = appendSegment(chunks, typedArrayBuffer(new Uint8Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0
  ])));
  const weights = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0
  ])));
  const inverseBindMatrices = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, -1, 0, 1
  ])));
  const morph = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    0, 0, 0.08,
    0, 0, 0.08,
    0, 0, 0.16
  ])));
  const animationTimes = appendSegment(chunks, typedArrayBuffer(new Float32Array([0, 1])));
  const animationRotations = appendSegment(chunks, typedArrayBuffer(new Float32Array([
    0, 0, 0, 1,
    0, 0, 0.38268343, 0.92387953
  ])));
  const animationMorphWeights = appendSegment(chunks, typedArrayBuffer(new Float32Array([0.2, 0.8])));
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
        children: [1, 3, 4]
      },
      { name: MIRROR_NAME, scale: MIRROR_SCALE, children: [2] },
      { name: LAB_MESH_NAME, translation: [1, 0, 0], mesh: 0, skin: 0 },
      { name: ORIGINAL_MESH_NAME, translation: [-1, 0.5, 0], mesh: 1 },
      { name: 'FixtureJointRoot', children: [5] },
      { name: 'FixtureJointTip', translation: [0, 1, 0] }
    ],
    skins: [{ name: 'FixtureSkin', inverseBindMatrices: 6, skeleton: 4, joints: [4, 5] }],
    meshes: [
      {
        name: 'FixtureLabGeometry',
        weights: [0.25],
        primitives: [{
          attributes: {
            POSITION: 0,
            NORMAL: 1,
            TEXCOORD_0: 2,
            JOINTS_0: 4,
            WEIGHTS_0: 5
          },
          indices: 3,
          material: 0,
          targets: [{ POSITION: 7 }]
        }]
      },
      {
        name: 'FixtureOriginalGeometry',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 1 }]
      }
    ],
    animations: [{
      name: 'FixtureAnimation',
      samplers: [
        { input: 8, output: 9, interpolation: 'LINEAR' },
        { input: 8, output: 10, interpolation: 'LINEAR' }
      ],
      channels: [
        { sampler: 0, target: { node: 4, path: 'rotation' } },
        { sampler: 1, target: { node: 2, path: 'weights' } }
      ]
    }],
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
    images: [{ name: 'FixtureOriginalTexture', mimeType: 'image/png', bufferView: 11 }],
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
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 4, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 5, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 6, componentType: 5126, count: 2, type: 'MAT4' },
      { bufferView: 7, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0.08], max: [0, 0, 0.16] },
      { bufferView: 8, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 9, componentType: 5126, count: 2, type: 'VEC4' },
      { bufferView: 10, componentType: 5126, count: 2, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, ...positions, target: 34962 },
      { buffer: 0, ...normals, target: 34962 },
      { buffer: 0, ...uvs, target: 34962 },
      { buffer: 0, ...indices, target: 34963 },
      { buffer: 0, ...joints, target: 34962 },
      { buffer: 0, ...weights, target: 34962 },
      { buffer: 0, ...inverseBindMatrices },
      { buffer: 0, ...morph, target: 34962 },
      { buffer: 0, ...animationTimes },
      { buffer: 0, ...animationRotations },
      { buffer: 0, ...animationMorphWeights },
      { buffer: 0, ...image }
    ],
    buffers: [{ byteLength: binary.length }]
  };

  await writeFile(path, glbBuffer(json, binary));
}

async function assertKhronosValidation(data, path) {
  const report = await validator.validateBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), {
    uri: path,
    format: 'glb',
    maxIssues: 0,
    writeTimestamp: false
  });
  if ((report?.issues?.numErrors ?? 0) > 0) {
    const messages = (report.issues.messages ?? [])
      .filter((issue) => issue.severity === 0)
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join('\n');
    throw new Error(`Khronos glTF Validator reported ${report.issues.numErrors} error(s).\n${messages}`);
  }
}

export async function readGlbJson(path) {
  const data = await readFile(path);
  if (data.length < 20 || data.readUInt32LE(0) !== GLB_MAGIC || data.readUInt32LE(4) !== GLB_VERSION) {
    throw new Error('Exported fixture is not a valid GLB 2.0 container.');
  }
  if (data.readUInt32LE(8) !== data.length) throw new Error('Exported fixture GLB length header does not match the file size.');
  await assertKhronosValidation(data, path);
  const jsonLength = data.readUInt32LE(12);
  const jsonType = data.readUInt32LE(16);
  if (jsonType !== JSON_CHUNK_TYPE || 20 + jsonLength > data.length) {
    throw new Error('Exported fixture does not contain a valid first JSON chunk.');
  }
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

function assertArrayClose(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length) throw new Error(`${label} is missing or has the wrong size.`);
  for (let index = 0; index < expected.length; index += 1) {
    if (Math.abs(actual[index] - expected[index]) > 1e-5) throw new Error(`${label} changed during export.`);
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
  if (texture === undefined || image === undefined) throw new Error(`${label} does not reference an embedded image.`);
  if (image.bufferView === undefined && typeof image.uri !== 'string') throw new Error(`${label} image has no embedded bufferView or URI.`);
}

function nodeTransform(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    const m = node.matrix;
    const translation = [m[12], m[13], m[14]];
    const sx = Math.hypot(m[0], m[1], m[2]);
    const sy = Math.hypot(m[4], m[5], m[6]);
    const sz = Math.hypot(m[8], m[9], m[10]);
    const scale = [sx, sy, sz];

    const r00 = m[0] / sx, r01 = m[4] / sy, r02 = m[8] / sz;
    const r10 = m[1] / sx, r11 = m[5] / sy, r12 = m[9] / sz;
    const r20 = m[2] / sx, r21 = m[6] / sy, r22 = m[10] / sz;

    const trace = r00 + r11 + r22;
    let qx = 0, qy = 0, qz = 0, qw = 1;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      qw = 0.25 / s;
      qx = (r21 - r12) * s;
      qy = (r02 - r20) * s;
      qz = (r10 - r01) * s;
    } else if (r00 > r11 && r00 > r22) {
      const s = 2.0 * Math.sqrt(1.0 + r00 - r11 - r22);
      qw = (r21 - r12) / s;
      qx = 0.25 * s;
      qy = (r01 + r10) / s;
      qz = (r02 + r20) / s;
    } else if (r11 > r22) {
      const s = 2.0 * Math.sqrt(1.0 + r11 - r00 - r22);
      qw = (r02 - r20) / s;
      qx = (r01 + r10) / s;
      qy = 0.25 * s;
      qz = (r12 + r21) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + r22 - r00 - r11);
      qw = (r10 - r01) / s;
      qx = (r02 + r20) / s;
      qy = (r12 + r21) / s;
      qz = 0.25 * s;
    }
    return { translation, rotation: [qx, qy, qz, qw], scale };
  }
  return {
    translation: node.translation ?? [0, 0, 0],
    rotation: node.rotation ?? [0, 0, 0, 1],
    scale: node.scale ?? [1, 1, 1]
  };
}

export function assertRoundtripExport(json) {
  if (json?.asset?.version !== '2.0') throw new Error('Exported fixture is not glTF 2.0.');

  const root = requireNamedNode(json, ROOT_NAME);
  const transform = nodeTransform(root);
  assertArrayClose(transform.translation, ROOT_TRANSLATION, 'Fixture root translation');
  assertArrayClose(transform.rotation, ROOT_ROTATION, 'Fixture root rotation');
  assertArrayClose(transform.scale, ROOT_SCALE, 'Fixture root scale');
  assertArrayClose(nodeTransform(requireNamedNode(json, MIRROR_NAME)).scale, MIRROR_SCALE, 'Mirrored parent scale');

  const original = materialForNode(json, requireNamedNode(json, ORIGINAL_MESH_NAME));
  if (original.name !== ORIGINAL_MATERIAL_NAME) throw new Error('Original mesh material name was not preserved.');
  const originalPbr = original.pbrMetallicRoughness;
  if (Math.abs((originalPbr?.roughnessFactor ?? -1) - ORIGINAL_ROUGHNESS) > 1e-6) {
    throw new Error('Original mesh roughness was not preserved.');
  }
  if (Math.abs((originalPbr?.metallicFactor ?? -1) - ORIGINAL_METALNESS) > 1e-6) {
    throw new Error('Original mesh metalness was not preserved.');
  }
  assertTextureReference(json, originalPbr?.baseColorTexture, 'Original base-color texture');

  const labNode = requireNamedNode(json, LAB_MESH_NAME);
  const lab = materialForNode(json, labNode);
  if (typeof lab.name !== 'string' || !lab.name.startsWith('PTL export ')) {
    throw new Error('Lab-assigned mesh did not receive a baked PTL material.');
  }
  const labPbr = lab.pbrMetallicRoughness;
  assertTextureReference(json, labPbr?.baseColorTexture, 'Baked base-color texture');
  assertTextureReference(json, labPbr?.metallicRoughnessTexture, 'Baked roughness texture');
  assertTextureReference(json, lab.normalTexture, 'Baked normal texture');
  assertTextureReference(json, lab.occlusionTexture, 'Baked ambient occlusion texture');
  assertTextureReference(json, lab.emissiveTexture, 'Baked emissive texture');
  const clearcoat = lab.extensions?.KHR_materials_clearcoat;
  if (clearcoat === undefined) throw new Error('Baked material is missing KHR_materials_clearcoat.');
  assertTextureReference(json, clearcoat.clearcoatTexture, 'Baked clearcoat texture');
  assertTextureReference(json, clearcoat.clearcoatRoughnessTexture, 'Baked clearcoat roughness texture');

  if (labNode.skin === undefined || !Array.isArray(json.skins) || json.skins.length === 0) {
    throw new Error('Skinned mesh data was not preserved during export.');
  }
  const labMesh = json.meshes?.[labNode.mesh];
  if (!Array.isArray(labMesh?.primitives?.[0]?.targets) || labMesh.primitives[0].targets.length === 0) {
    throw new Error('Morph target data was not preserved during export.');
  }
  const animationPaths = new Set(
    (json.animations ?? []).flatMap((animation) =>
      (animation.channels ?? []).map((channel) => channel.target?.path).filter(Boolean)
    )
  );
  if (!animationPaths.has('rotation') || !animationPaths.has('weights')) {
    throw new Error('Bone or morph animation channels were not preserved during export.');
  }
}
