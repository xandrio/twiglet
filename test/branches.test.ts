import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { listLocalBranches, readBranchDetails } from '../src/core/branches.js';
import { parseBranches } from '../src/git/branches.js';
import { runGit } from '../src/git/run.js';
import { branchChoice, renderBranchDetails } from '../src/terminal/branches.js';
import { assertSameDirectory, directoryAlias, fixtureGit, repository, snapshot, temp } from './helpers.js';

test('local branch list sorts current first then tip activity/name; details inspect without checkout', async (t) => {
  const root = await repository(t);
  const initial = fixtureGit(root, 'rev-parse', 'HEAD');
  fixtureGit(root, 'branch', 'zeta');
  fixtureGit(root, 'branch', 'alpha');
  fixtureGit(root, 'checkout', '-b', 'feature/é');
  fixtureGit(root, 'commit', '--allow-empty', '-m', 'Selected branch subject');
  const tip = fixtureGit(root, 'rev-parse', 'HEAD');
  const objectFile = path.join(await temp(t), 'commit');
  // Give the selected tip a later committer date without relying on wall-clock time.
  await writeFile(objectFile, fixtureGit(root, 'cat-file', 'commit', tip).replaceAll('1704067200', '1735689600') + '\n');
  const newer = fixtureGit(root, 'hash-object', '-t', 'commit', '-w', objectFile);
  fixtureGit(root, 'update-ref', 'refs/heads/feature/é', newer);
  fixtureGit(root, 'checkout', 'topic');
  fixtureGit(root, 'branch', '--set-upstream-to=topic', 'feature/é');
  await writeFile(path.join(root, 'tracked.txt'), 'dirty\n');
  const before = await snapshot(root);
  const list = await listLocalBranches(root);
  assert.deepEqual(list.branches.map((b) => b.name), ['topic', 'feature/é', 'alpha', 'zeta']);
  assert.equal(list.branches.filter((b) => b.current).length, 1);
  const detail = await readBranchDetails(root, 'feature/é');
  assert.equal(detail.branch.current, false);
  assert.equal(detail.branch.tip?.oid, newer);
  assert.equal(detail.upstream.kind === 'compared' && detail.upstream.ahead, 1);
  assert.equal(detail.history.kind, 'available');
  assert.deepEqual(detail.history.kind === 'available' && detail.history.commits.map((c) => c.oid), [newer, initial]);
  assert(!renderBranchDetails(detail).includes('Working tree:'));
  assert.deepEqual(await snapshot(root), before);
});

test('tracking distinguishes none, custom mappings, local targets, missing and unresolved', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'local');
  fixtureGit(root, 'branch', '--set-upstream-to=topic', 'local');
  fixtureGit(root, 'branch', 'mapped');
  fixtureGit(root, 'remote', 'add', 'team', 'ext::must-not-run');
  fixtureGit(root, 'config', 'remote.team.fetch', '+refs/heads/*:refs/cache/team/*');
  fixtureGit(root, 'config', 'branch.mapped.remote', 'team');
  fixtureGit(root, 'config', 'branch.mapped.merge', 'refs/heads/trunk');
  let list = await listLocalBranches(root);
  const tracking = (name: string) => list.branches.find((b) => b.name === name)!.tracking;
  assert.deepEqual(tracking('topic'), { kind: 'none' });
  assert.deepEqual(tracking('local'), { kind: 'configured', target: { ref: 'refs/heads/topic', source: 'local-branch' }, available: true });
  assert.deepEqual(tracking('mapped'), { kind: 'configured', target: { ref: 'refs/cache/team/trunk', source: 'remote-tracking' }, available: false });
  fixtureGit(root, 'update-ref', 'refs/cache/team/trunk', 'HEAD');
  list = await listLocalBranches(root);
  assert.equal(tracking('mapped').kind === 'configured' && (tracking('mapped') as { available: boolean }).available, true);
  fixtureGit(root, 'config', '--add', 'branch.mapped.merge', 'refs/heads/second');
  list = await listLocalBranches(root);
  assert.equal(tracking('mapped').kind, 'unavailable');
});

test('unborn and detached branches, nested aliases, linked worktrees and exact names', async (t) => {
  const empty = await repository(t, false);
  assert.equal((await listLocalBranches(empty)).branches[0]?.tip, null);
  assert.equal((await readBranchDetails(empty, 'topic')).history.kind, 'available');
  const root = await repository(t);
  fixtureGit(root, 'branch', 'HEAD-like');
  fixtureGit(root, 'checkout', '--detach');
  assert((await listLocalBranches(root)).branches.every((b) => !b.current));
  for (const name of ['HEAD', 'topic~1', 'refs/heads/topic', '--help', 'missing']) await assert.rejects(readBranchDetails(root, name), /Local branch not found/);
  const alias = await directoryAlias(t, root);
  await mkdir(path.join(alias, 'nested'));
  await assertSameDirectory((await listLocalBranches(path.join(alias, 'nested'))).root, root);
  const linked = path.join(await temp(t), 'linked');
  fixtureGit(root, 'worktree', 'add', linked, 'topic');
  assert.equal((await listLocalBranches(linked)).branches.find((b) => b.current)?.name, 'topic');
  assert.equal((await readBranchDetails(linked, 'HEAD-like')).branch.current, false);
});

test('branch inspection avoids the index and preserves partial upstream information', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'remote', 'add', 'team', 'ext::must-not-run');
  fixtureGit(root, 'config', 'branch.topic.remote', 'team');
  fixtureGit(root, 'config', 'branch.topic.merge', 'refs/heads/topic');
  fixtureGit(root, 'update-ref', 'refs/remotes/team/topic', fixtureGit(root, 'rev-parse', 'HEAD:tracked.txt'));
  await writeFile(path.join(root, '.git', 'index'), 'broken index');
  const before = await snapshot(root);
  const detail = await readBranchDetails(root, 'topic');
  assert.equal(detail.upstream.kind, 'unavailable');
  assert.equal(detail.history.kind, 'available');
  assert.deepEqual(await snapshot(root), before);
  await writeFile(path.join(root, '.git', 'shallow'), fixtureGit(root, 'rev-parse', 'HEAD') + '\n');
  assert.equal((await readBranchDetails(root, 'topic')).shallow, true);
  fixtureGit(root, 'config', 'remote.team.promisor', 'true');
  await assert.rejects(listLocalBranches(root), /Partial-clone/);
});

test('branch parser rejects malformed records and selectors escape terminal controls', () => {
  for (const data of ['bad', 'refs/heads/x\0abc\0']) assert.throws(() => parseBranches(Buffer.from(data)));
  const label = branchChoice({ ref: 'refs/heads/x', name: 'é', current: true, tip: { oid: 'abc', parents: [], author: '', committedAt: '2024-01-01T00:00:00Z', subject: '\x1b[2J' + 'x'.repeat(80) }, tracking: { kind: 'none' } });
  assert(!label.includes('\x1b'));
  assert.match(label, /\.\.\./);
});

test('branch changes/deletion during history inspection are detected; history failures are partial', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'selected');
  const partial = await readBranchDetails(root, 'selected', undefined, async (cwd, args, signal) => {
    if (args[0] === 'log') throw new Error('History timed out');
    return runGit(cwd, args, signal);
  });
  assert.equal(partial.branch.name, 'selected');
  assert.deepEqual(partial.history, { kind: 'unavailable', message: 'History timed out' });
  assert.match(renderBranchDetails(partial), /History unavailable: History timed out/);
  const next = fixtureGit(root, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Next');
  for (const remove of [false, true]) {
    await assert.rejects(readBranchDetails(root, 'selected', undefined, async (cwd, args, signal) => {
      const result = await runGit(cwd, args, signal);
      if (args[0] === 'log') {
        if (remove) fixtureGit(root, 'update-ref', '-d', 'refs/heads/selected');
        else fixtureGit(root, 'update-ref', 'refs/heads/selected', next);
      }
      return result;
    }), /Selected branch changed or disappeared/);
  }
});
