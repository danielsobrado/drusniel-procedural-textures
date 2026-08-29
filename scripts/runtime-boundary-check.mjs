import { access, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'src');
const entry = resolve(sourceRoot, 'runtime/index.ts');
const allowedTrees = [resolve(sourceRoot, 'runtime'), resolve(sourceRoot, 'core')];
const allowedFiles = new Set([
  'engine/MaterialComputeEngine.ts',
  'engine/SimulationAtlas.ts',
  'materials/BiologicalScattering.ts',
  'materials/MaterialGraph.ts',
  'materials/PatternShader.ts',
  'materials/PhysicalMaterial.ts',
  'materials/PortableProceduralShader.ts',
  'materials/ProceduralShader.ts',
  'materials/SurfaceGraphCompiler.ts',
  'materials/SurfaceMaterialCompiler.ts',
  'materials/WebGpuMaterialCompiler.ts',
  'materials/WebGpuMaterialUniforms.ts',
  'materials/WebGpuPatternNodes.ts',
  'materials/WebGpuProceduralNodes.ts',
  'materials/WebGpuSurfaceDesignerNodes.ts'
].map((path) => resolve(sourceRoot, path)));
const allowedPackages = new Set(['three', 'three/tsl', 'three/webgpu']);
const forbiddenText = /\b(?:ProjectState|TextureBaker|GlbExporter|TileLab)\b|\?raw|from\s+['"]yaml['"]/u;

function within(file, directory) {
  const path = relative(directory, file);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

function display(file) {
  return relative(root, file).replaceAll('\\', '/');
}

async function existing(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next TypeScript resolution candidate.
    }
  }
  return null;
}

async function resolveImport(importer, specifier) {
  const raw = resolve(dirname(importer), specifier);
  const extension = extname(raw);
  const base = extension === '.js' || extension === '.mjs' ? raw.slice(0, -extension.length) : raw;
  const resolved = await existing([
    raw,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(raw, 'index.ts'),
    resolve(raw, 'index.tsx')
  ]);
  if (resolved === null) throw new Error(`${display(importer)} imports unresolved module ${specifier}.`);
  return resolved;
}

function assertOwned(file, chain) {
  const allowed = allowedTrees.some((tree) => within(file, tree)) || allowedFiles.has(file);
  if (!within(file, sourceRoot) || !allowed) {
    throw new Error(`Runtime import leaves the portable seam:\n${[...chain, file].map(display).join(' -> ')}`);
  }
  if (within(file, resolve(sourceRoot, 'runtime/shims'))) {
    throw new Error(`Runtime compatibility shims are forbidden: ${display(file)}.`);
  }
}

const visited = new Set();

function importedSpecifiers(source) {
  const result = new Set();
  const staticImport = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu;
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const match of source.matchAll(staticImport)) result.add(match[1]);
  for (const match of source.matchAll(dynamicImport)) result.add(match[1]);
  return result;
}

async function visit(file, chain = []) {
  if (visited.has(file)) return;
  assertOwned(file, chain);
  visited.add(file);
  const source = await readFile(file, 'utf8');
  const forbidden = source.match(forbiddenText);
  if (forbidden !== null) {
    throw new Error(`${display(file)} contains forbidden runtime dependency marker ${JSON.stringify(forbidden[0])}.`);
  }

  for (const specifier of importedSpecifiers(source)) {
    if (!specifier.startsWith('.')) {
      if (!allowedPackages.has(specifier)) {
        throw new Error(`${display(file)} imports forbidden package ${specifier}.`);
      }
      continue;
    }
    const dependency = await resolveImport(file, specifier);
    await visit(dependency, [...chain, file]);
  }
}

await visit(entry);
console.log(`Runtime seam check passed (${visited.size} source modules).`);
