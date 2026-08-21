import { describe, expect, it } from 'vitest';
import {
  canonicalResourcePath,
  collectExternalUris,
  createBundleIndex,
  primaryBundlePath,
  resolveBundleFile
} from '../src/engine/GltfBundleResolver';

function bundleFile(name: string, path: string): File {
  const result = new File(['x'], name, { type: 'application/octet-stream', lastModified: 1 });
  Object.defineProperty(result, 'webkitRelativePath', { value: path, configurable: true });
  return result;
}

describe('GLTF bundle resolver', () => {
  it('canonicalizes encoded resource paths without applying URI query suffixes', () => {
    expect(canonicalResourcePath('../textures/skin%20a.png?v=2#asset')).toBe('../textures/skin a.png');
  });

  it('resolves parent-relative paths from the primary GLTF directory', () => {
    const primary = bundleFile('scene.gltf', 'models/scene.gltf');
    const texture = bundleFile('skin a.png', 'textures/skin a.png');
    const index = createBundleIndex([primary, texture]);
    expect(resolveBundleFile('../textures/skin%20a.png?v=2', index, primaryBundlePath(primary, index))).toBe(texture);
  });

  it('rejects ambiguous basename fallback', () => {
    const primary = bundleFile('scene.gltf', 'models/scene.gltf');
    const first = bundleFile('albedo.png', 'a/albedo.png');
    const second = bundleFile('albedo.png', 'b/albedo.png');
    const index = createBundleIndex([primary, first, second]);
    expect(() => resolveBundleFile('albedo.png', index, primaryBundlePath(primary, index))).toThrow(/ambiguous/i);
  });

  it('rejects remote resources while collecting nested URIs', () => {
    expect(() => collectExternalUris({ images: [{ uri: 'https://example.com/a.png' }] })).toThrow(/remote/i);
  });
});
