import { gzipSync } from 'node:zlib';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const runtimeBuild = resolve(root, 'dist-runtime');
const output = resolve(root, 'dist-runtime-package');
const metadataPath = resolve(root, 'config/runtime-package.yaml');
const readmePath = resolve(root, 'docs/runtime-package-README.md');
const rootPackagePath = resolve(root, 'package.json');

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8'));
if (rootPackage.private !== true) throw new Error('The Lab root package must remain private.');

const metadata = record(parse(await readFile(metadataPath, 'utf8')), 'Runtime package metadata');
const peerDependencies = record(metadata.peerDependencies, 'Runtime peer dependencies');
const budgets = record(metadata.budgets, 'Runtime package budgets');
const publishable = metadata.publishable === true;
const license = string(metadata.license, 'Runtime license');
if (publishable && license === 'UNLICENSED') {
  throw new Error('A publishable runtime package requires an explicit license.');
}

if (dirname(output) !== root || basename(output) !== 'dist-runtime-package') {
  throw new Error(`Refusing to replace unexpected output directory ${output}.`);
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(runtimeBuild, 'index.js'), resolve(output, 'index.js'));
await cp(resolve(runtimeBuild, 'types'), resolve(output, 'types'), { recursive: true });
await cp(readmePath, resolve(output, 'README.md'));

const declarationFiles = (await filesUnder(resolve(output, 'types'))).filter((file) => file.endsWith('.d.ts'));
const relativeDeclarationImport = /(\bfrom\s+['"]|\bimport\s*\(\s*['"])(\.\.?\/[^'"]+)(['"])/gu;
for (const file of declarationFiles) {
  const source = await readFile(file, 'utf8');
  const nodeCompatible = source.replace(
    relativeDeclarationImport,
    (match, prefix, specifier, suffix) => /\.[a-z0-9]+$/iu.test(specifier)
      ? match
      : `${prefix}${specifier}.js${suffix}`
  );
  await writeFile(file, nodeCompatible, 'utf8');
}

if (license !== 'UNLICENSED') {
  const licensePath = resolve(root, 'LICENSE');
  await cp(licensePath, resolve(output, 'LICENSE'));
}

const packageJson = {
  name: string(metadata.name, 'Runtime package name'),
  version: string(metadata.version, 'Runtime package version'),
  description: string(metadata.description, 'Runtime package description'),
  private: !publishable,
  type: 'module',
  sideEffects: false,
  license,
  repository: {
    type: 'git',
    url: string(metadata.repository, 'Runtime repository URL')
  },
  keywords: metadata.keywords,
  exports: {
    '.': {
      types: './types/runtime/index.d.ts',
      import: './index.js'
    }
  },
  peerDependencies,
  publishConfig: { access: 'public' }
};
await writeFile(resolve(output, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

const javascript = await readFile(resolve(output, 'index.js'));
const declarationContents = await Promise.all(declarationFiles.map((file) => readFile(file)));
const declarationBytes = declarationContents.reduce((size, contents) => size + contents.byteLength, 0);
const gzipBytes = gzipSync(javascript).byteLength;
const dependencyCount = Object.keys(peerDependencies).length;
const forbidden = /\b(?:ProjectState|TextureBaker|GlbExporter|TileLab)\b|\?raw|config\/(?:lab|grass-pattern|renderer-safety|structured-pattern)\.yaml|from\s+['"]yaml['"]/u;

for (const file of [resolve(output, 'index.js'), ...declarationFiles]) {
  const contents = await readFile(file, 'utf8');
  const match = contents.match(forbidden);
  if (match !== null) {
    throw new Error(`${relative(root, file)} contains forbidden Lab marker ${JSON.stringify(match[0])}.`);
  }
}

const measurements = {
  javascriptBytes: javascript.byteLength,
  gzipBytes,
  declarationBytes,
  dependencyCount
};
for (const [name, value] of Object.entries(measurements)) {
  const budget = integer(budgets[name], `Runtime ${name} budget`);
  if (value > budget) throw new Error(`Runtime ${name} is ${value}; budget is ${budget}.`);
}

console.log('Runtime package staged:');
console.log(`  JavaScript:   ${measurements.javascriptBytes} bytes`);
console.log(`  gzip:         ${measurements.gzipBytes} bytes`);
console.log(`  declarations: ${measurements.declarationBytes} bytes`);
console.log(`  dependencies: ${measurements.dependencyCount} peer`);
console.log(`  publishable:  ${publishable ? 'yes' : 'no (license/name decision pending)'}`);
