import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

export async function temp(t: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twiglet-test-'));
  t.after(async () => {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('twiglet-test-')) throw new Error('Invalid cleanup target');
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  return directory;
}

export function fixtureGit(cwd: string, ...args: string[]): string {
  return execFileSync('git', [
    '-c', 'user.name=Twiglet Test', '-c', 'user.email=twiglet@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', '-c', 'core.autocrlf=false', ...args,
  ], {
    cwd, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export async function repository(t: TestContext, commit = true): Promise<string> {
  const directory = path.join(await temp(t), 'repo space é');
  await mkdir(directory);
  fixtureGit(directory, 'init', '--initial-branch=topic');
  if (commit) {
    await writeFile(path.join(directory, 'tracked.txt'), 'initial\n');
    fixtureGit(directory, 'add', '.');
    fixtureGit(directory, 'commit', '-m', 'Initial');
  }
  return directory;
}
