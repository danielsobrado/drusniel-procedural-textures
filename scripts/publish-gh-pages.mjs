import { execSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ghpages from 'gh-pages';

const DEPLOY_BRANCH = 'main';
const PAGES_BRANCH = 'gh-pages';

function git(root, command) {
  return execSync(command, { cwd: root, encoding: 'utf8' }).trim();
}

function requireCleanWorktree(root, phase) {
  if (git(root, 'git status --porcelain').length > 0) {
    throw new Error(`Publish requires a clean working tree ${phase}. Commit or stash generated changes first.`);
  }
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const distDir = join(root, 'dist');
  const branch = git(root, 'git rev-parse --abbrev-ref HEAD');

  if (branch !== DEPLOY_BRANCH) {
    throw new Error(`Publish must run from ${DEPLOY_BRANCH}; current branch is ${branch}.`);
  }
  requireCleanWorktree(root, 'before release checks');

  git(root, `git fetch --quiet origin ${DEPLOY_BRANCH}`);
  const localCommit = git(root, 'git rev-parse HEAD');
  const remoteCommit = git(root, `git rev-parse origin/${DEPLOY_BRANCH}`);
  if (localCommit !== remoteCommit) {
    throw new Error(`Publish requires local ${DEPLOY_BRANCH} to match origin/${DEPLOY_BRANCH}. Pull or push first.`);
  }

  const commit = git(root, 'git rev-parse --short HEAD');
  const remoteUrl = git(root, 'git config --get remote.origin.url');
  console.log(`\nRunning release checks for Procedural Texture Lab from ${branch} (${commit})...\n`);
  execSync('npm run release:check', { cwd: root, stdio: 'inherit' });
  requireCleanWorktree(root, 'after release checks');
  await writeFile(join(distDir, '.nojekyll'), '', 'utf8');

  const commitMessage = `Deploy ${commit} [${new Date().toISOString()}]`;
  console.log(`\nPublishing dist/ to ${PAGES_BRANCH}...`);

  await new Promise((resolvePublish, rejectPublish) => {
    ghpages.publish(
      distDir,
      {
        branch: PAGES_BRANCH,
        dotfiles: true,
        message: commitMessage
      },
      (error) => error ? rejectPublish(error) : resolvePublish()
    );
  });

  console.log(`\nPublished ${commit} to ${PAGES_BRANCH}.`);
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i);
  if (match) {
    const [, user, repo] = match;
    console.log(`Live URL: https://${user}.github.io/${repo}/\n`);
  }
}

main().catch((error) => {
  console.error('\nDeployment failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
