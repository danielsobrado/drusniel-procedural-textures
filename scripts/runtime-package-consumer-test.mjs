import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fixture = resolve(root, 'tests/runtime-consumer');
const stagedPackage = resolve(root, 'dist-runtime-package');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'ptl-runtime-consumer-'));
const consumer = join(temporaryRoot, 'consumer');
const packageJson = JSON.parse(await readFile(resolve(stagedPackage, 'package.json'), 'utf8'));

function npm(...args) {
  execFileSync('npm', args, {
    cwd: consumer,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
}

try {
  await cp(fixture, consumer, { recursive: true });
  const packResult = execFileSync('npm', [
    'pack', stagedPackage, '--pack-destination', temporaryRoot, '--json'
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  const packed = JSON.parse(packResult)[0];
  for (const file of packed.files) {
    if (!/^(?:index\.js|package\.json|README\.md|LICENSE|types\/)/u.test(file.path)) {
      throw new Error(`Packed runtime contains unexpected file ${file.path}.`);
    }
  }
  console.log(`Packed ${packed.entryCount} runtime-only files (${packed.size} bytes).`);
  const tarball = (await readdir(temporaryRoot)).find((file) => file.endsWith('.tgz'));
  if (tarball === undefined) throw new Error('npm pack did not create a tarball.');

  const fixturePackagePath = resolve(consumer, 'package.json');
  const fixturePackage = JSON.parse(await readFile(fixturePackagePath, 'utf8'));
  fixturePackage.dependencies[packageJson.name] = `file:${join(temporaryRoot, tarball)}`;
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(fixturePackagePath, `${JSON.stringify(fixturePackage, null, 2)}\n`, 'utf8')
  );

  npm('install', '--ignore-scripts', '--no-audit', '--no-fund');
  npm('run', 'build');
  npm('test');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
