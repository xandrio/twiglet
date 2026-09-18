import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readOverview } from '../src/core/repository.js';
import { runGit } from '../src/git/run.js';
import { assertSameDirectory, directoryAlias, fixtureGit, repository, temp } from './helpers.js';

async function snapshot(root: string, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(files, await snapshot(root, name));
    else files[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  }
  return files;
}

test('real Git: clean repository, nested directory, and no content mutations', async (t) => {
  const root = await repository(t);
  await mkdir(path.join(root, 'nested'));
  const before = await snapshot(root);
  const result = await readOverview(path.join(root, 'nested'));
  await assertSameDirectory(result.root, root);
  assert.equal(result.head.kind, 'branch');
  assert.deepEqual(result.changes, []);
  assert.deepEqual(await snapshot(root), before);
});
test('discovers the worktree root through an alias and nested directory', async (t) => {
  const root = await repository(t);
  const alias = await directoryAlias(t, root);
  const nested = path.join(alias, 'nested');
  await mkdir(nested);
  const before = await snapshot(root);
  const result = await readOverview(nested);
  await assertSameDirectory(result.root, alias);
  await assertSameDirectory(result.root, root);
  // A real but incorrect directory (such as cwd or .git) must still fail.
  await assert.rejects(assertSameDirectory(result.root, nested), { name: 'AssertionError' });
  await assert.rejects(assertSameDirectory(result.root, path.join(root, '.git')), { name: 'AssertionError' });
  assert.equal(result.head.kind, 'branch');
  assert.deepEqual(result.changes, []);
  assert.deepEqual(await snapshot(root), before);
});
test('real Git: staged, unstaged, untracked, rename, and unchanged index', async (t) => {
  const root = await repository(t);
  await writeFile(path.join(root, 'tracked.txt'), 'staged\n');
  fixtureGit(root, 'add', 'tracked.txt');
  await writeFile(path.join(root, 'tracked.txt'), 'unstaged\n');
  await writeFile(path.join(root, 'new file é.txt'), 'new\n');
  const before = await snapshot(root);
  const result = await readOverview(root);
  assert.equal(result.changes.find((c) => c.path.toString() === 'tracked.txt')?.index, 'M');
  assert.equal(result.changes.find((c) => c.path.toString() === 'tracked.txt')?.worktree, 'M');
  assert.equal(result.changes.find((c) => c.path.toString() === 'new file é.txt')?.kind, 'untracked');
  assert.deepEqual(await snapshot(root), before);
  fixtureGit(root, 'reset', '--hard', 'HEAD');
  fixtureGit(root, 'mv', 'tracked.txt', 'renamed file.txt');
  const renamed = (await readOverview(root)).changes.find((c) => c.kind === 'renamed');
  assert.equal(renamed?.originalPath?.toString(), 'tracked.txt');
});
test('real Git: unborn and detached HEAD', async (t) => {
  const unborn = await repository(t, false);
  assert.deepEqual((await readOverview(unborn)).head, { kind: 'unborn', name: 'topic' });
  const root = await repository(t);
  fixtureGit(root, 'checkout', '--detach');
  assert.equal((await readOverview(root)).head.kind, 'detached');
});
test('real Git: conflict', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'checkout', '-b', 'side');
  await writeFile(path.join(root, 'tracked.txt'), 'side\n');
  fixtureGit(root, 'commit', '-am', 'Side');
  fixtureGit(root, 'checkout', 'topic');
  await writeFile(path.join(root, 'tracked.txt'), 'topic\n');
  fixtureGit(root, 'commit', '-am', 'Topic');
  assert.throws(() => fixtureGit(root, 'merge', 'side'));
  const before = await snapshot(root);
  assert.equal((await readOverview(root)).changes[0]?.kind, 'conflict');
  assert.deepEqual(await snapshot(root), before);
});
test('real Git: linked worktree and local upstream configuration', async (t) => {
  const root = await repository(t);
  const linked = path.join(await temp(t), 'linked');
  fixtureGit(root, 'worktree', 'add', '-b', 'linked', linked, 'topic');
  fixtureGit(linked, 'branch', '--set-upstream-to=topic');
  const result = await readOverview(linked);
  await assertSameDirectory(result.root, linked);
  assert.equal(result.upstream, 'topic');
  assert.equal(result.head.kind === 'branch' && result.head.name, 'linked');
});
test('does not contact a configured transport or execute an fsmonitor hook', async (t) => {
  const root = await repository(t);
  const marker = path.join(root, 'should-not-exist');
  const hook = path.join(root, '.git', 'monitor');
  await writeFile(hook, '#!/bin/sh\ntouch "' + marker.replaceAll('\\', '/') + '"\n', { mode: 0o755 });
  fixtureGit(root, 'config', 'core.fsmonitor', hook.replaceAll('\\', '/'));
  fixtureGit(root, 'remote', 'add', 'other', 'ext::this-transport-must-not-run');
  fixtureGit(root, 'config', 'branch.topic.remote', 'other');
  fixtureGit(root, 'config', 'branch.topic.merge', 'refs/heads/topic');
  fixtureGit(root, 'update-ref', 'refs/remotes/other/topic', 'HEAD');
  const before = await snapshot(root);
  assert.equal((await readOverview(root)).upstream, 'other/topic');
  assert.deepEqual(await snapshot(root), before);
});
test('rejects partial-clone configuration before object inspection', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'config', 'remote.other.promisor', 'true');
  const before = await snapshot(root);
  await assert.rejects(readOverview(root), /Partial-clone/);
  assert.deepEqual(await snapshot(root), before);
});
test('never executes configured clean or process filters', async (t) => {
  const root = await repository(t);
  await writeFile(path.join(root, '.gitattributes'), 'tracked.txt filter=side-effect\n');
  fixtureGit(root, 'add', '.gitattributes');
  fixtureGit(root, 'commit', '-m', 'Attributes');
  // These deliberately invalid commands would make inspection fail if executed.
  fixtureGit(root, 'config', 'filter.side-effect.clean', 'twiglet-helper-must-not-run');
  fixtureGit(root, 'config', 'filter.side-effect.process', 'twiglet-process-must-not-run');
  fixtureGit(root, 'config', 'filter.side-effect.required', 'true');
  await writeFile(path.join(root, 'tracked.txt'), 'changed\n');
  const before = await snapshot(root);
  const result = await readOverview(root);
  assert.equal(result.filtersDisabled, true);
  assert.equal(result.changes[0]?.worktree, 'M');
  assert.deepEqual(await snapshot(root), before);
});
test('shallow repositories are identified without filling history', async (t) => {
  const root = await repository(t);
  await writeFile(path.join(root, '.git', 'shallow'), fixtureGit(root, 'rev-parse', 'HEAD') + '\n');
  const before = await snapshot(root);
  assert.equal((await readOverview(root)).shallow, true);
  assert.deepEqual(await snapshot(root), before);
});
test('clear errors for missing, non-repository and bare directories', async (t) => {
  const directory = await temp(t);
  await assert.rejects(readOverview(path.join(directory, 'absent')), /does not exist/);
  await assert.rejects(readOverview(directory), /not a git repository/i);
  fixtureGit(directory, 'init', '--bare');
  await assert.rejects(readOverview(directory), /Bare repositories/);
});
test('cancels Git operations', async (t) => {
  const root = await repository(t);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(runGit(root, ['status'], abort.signal), /cancelled/);
});
