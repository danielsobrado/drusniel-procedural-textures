import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const RELEASE_BRANCH = 'main';
const root = resolve(import.meta.dirname, '..');
const stagedPackage = resolve(root, 'dist-runtime-package');
const metadata = parse(await readFile(resolve(root, 'config/runtime-package.yaml'), 'utf8'));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: options.inherit ? undefined : 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    shell: process.platform === 'win32' && command === 'npm'
  })?.toString().trim() ?? '';
}

if (metadata.publishable !== true) {
  throw new Error('Runtime publication is disabled in config/runtime-package.yaml. Confirm the npm name and license first.');
}
if (metadata.license === 'UNLICENSED') throw new Error('Choose a runtime license before publication.');
await access(resolve(root, 'LICENSE'));

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== RELEASE_BRANCH) {
  throw new Error(`Runtime publication must run from ${RELEASE_BRANCH}; current branch is ${branch}.`);
}
if (run('git', ['status', '--porcelain']) !== '') {
  throw new Error('Runtime publication requires a clean working tree. Commit or stash local changes first.');
}

run('git', ['fetch', '--quiet', 'origin', RELEASE_BRANCH]);
if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', `origin/${RELEASE_BRANCH}`])) {
  throw new Error(`Local ${RELEASE_BRANCH} must match origin/${RELEASE_BRANCH}. Pull or push first.`);
}

const account = run('npm', ['whoami']);
console.log(`Publishing as npm account ${account}.`);
run('npm', ['run', 'ci'], { inherit: true });
run('npm', ['pack', stagedPackage, '--dry-run'], { inherit: true });

const tag = String(metadata.version).includes('-') ? 'next' : 'latest';
run('npm', ['publish', stagedPackage, '--access', 'public', '--tag', tag], { inherit: true });
console.log(`Published ${metadata.name}@${metadata.version} with dist-tag ${tag}.`);
