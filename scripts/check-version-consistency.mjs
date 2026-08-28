import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const runtime = parse(await readFile(resolve(root, 'config/runtime-package.yaml'), 'utf8'));

if (packageJson.private !== true) {
  throw new Error('The Procedural Texture Lab root package must remain private.');
}
if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
  throw new Error('The Procedural Texture Lab root package requires a version.');
}
if (typeof runtime?.version !== 'string' || runtime.version.length === 0) {
  throw new Error('The PTL runtime package requires a version.');
}
if (packageJson.version !== runtime.version) {
  throw new Error(`V0.3 release metadata is inconsistent: Lab=${packageJson.version}, runtime=${runtime.version}.`);
}

console.log(`V0.3 release metadata is consistent: ${packageJson.version}`);
