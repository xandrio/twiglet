import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readHead } from '../src/core/discovery.js';
import { readOverview } from '../src/core/repository.js';
import { parseDivergence, readUpstream } from '../src/core/upstream.js';
import { runGit } from '../src/git/run.js';
import { renderOverview, renderUpstream } from '../src/terminal/render.js';
import type { Upstream } from '../src/core/types.js';
import { fixtureGit, repository, snapshot, temp } from './helpers.js';

function assertUnavailable(result: Upstream, reason: string) {
  assert.equal(result.kind, 'unavailable');
  assert.equal(result.kind === 'unavailable' && result.reason, reason);
  assert(!('ahead' in result));
  assert(!('behind' in result));
}

test('exact equal/ahead/behind/diverged counts against a local branch', async (t) => {
  const root = await repository(t);
  const base = fixtureGit(root, 'rev-parse', 'HEAD');
  const tree = fixtureGit(root, 'rev-parse', 'HEAD^{tree}');
  const left = fixtureGit(root, 'commit-tree', tree, '-p', base, '-m', 'Left');
  const right = fixtureGit(root, 'commit-tree', tree, '-p', base, '-m', 'Right');
  fixtureGit(root, 'branch', 'upstream-local');
  fixtureGit(root, 'branch', '--set-upstream-to=upstream-local');
  for (const [head, upstream, ahead, behind] of [[base, base, 0, 0], [left, base, 1, 0], [base, right, 0, 1], [left, right, 1, 1]] as const) {
    fixtureGit(root, 'update-ref', 'refs/heads/topic', head);
    fixtureGit(root, 'update-ref', 'refs/heads/upstream-local', upstream);
    const before = await snapshot(root);
    const result = (await readOverview(root)).upstream;
    assert.deepEqual(result, { kind: 'compared', target: { ref: 'refs/heads/upstream-local', source: 'local-branch' }, headOid: head, upstreamOid: upstream, ahead, behind });
    assert.deepEqual(await snapshot(root), before);
    const text = renderUpstream(result).join('\n');
    assert(!text.includes('Remote freshness'));
    if (head === upstream) assert.match(text, /Matches the local upstream reference/);
  }
  const merge = fixtureGit(root, 'commit-tree', tree, '-p', left, '-p', right, '-m', 'Merge');
  fixtureGit(root, 'update-ref', 'refs/heads/topic', merge);
  const result = (await readOverview(root)).upstream;
  assert.equal(result.kind === 'compared' && result.ahead, 2); // left + merge, not just first-parent count
  assert.equal(result.kind === 'compared' && result.behind, 0);
});

test('non-default remote and custom fetch mapping use Git-resolved references', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'remote', 'add', 'team', 'ext::twiglet-transport-must-not-run');
  fixtureGit(root, 'config', 'remote.team.fetch', '+refs/heads/*:refs/cache/team/*');
  fixtureGit(root, 'config', 'branch.topic.remote', 'team');
  fixtureGit(root, 'config', 'branch.topic.merge', 'refs/heads/trunk');
  fixtureGit(root, 'update-ref', 'refs/cache/team/trunk', 'HEAD');
  const before = await snapshot(root);
  const result = (await readOverview(root)).upstream;
  assert.equal(result.kind, 'compared');
  assert.equal(result.kind === 'compared' && result.target.ref, 'refs/cache/team/trunk');
  assert.match(renderUpstream(result).join('\n'), /Remote freshness unknown; no fetch performed/);
  assert.deepEqual(await snapshot(root), before);
});

test('advancing the remote does not change locally reported divergence until explicit fixture fetch', async (t) => {
  const source = await repository(t);
  const parent = await temp(t);
  const local = path.join(parent, 'clone');
  fixtureGit(parent, 'clone', '--no-hardlinks', source, local);
  fixtureGit(source, 'commit', '--allow-empty', '-m', 'Remote-only commit');
  const localBefore = await snapshot(local);
  const remoteBefore = await snapshot(source);
  const stale = (await readOverview(local)).upstream;
  assert.equal(stale.kind === 'compared' && stale.behind, 0);
  assert.match(renderUpstream(stale).join('\n'), /freshness unknown/);
  assert.deepEqual(await snapshot(local), localBefore);
  assert.deepEqual(await snapshot(source), remoteBefore);
  // Test setup explicitly fetches from a local directory; Twiglet never does.
  fixtureGit(local, 'fetch', 'origin');
  const fresh = (await readOverview(local)).upstream;
  assert.equal(fresh.kind === 'compared' && fresh.behind, 1);
  assert.match(renderUpstream(fresh).join('\n'), /freshness unknown/);
});

test('no configuration, missing reference, and unmappable configuration are distinct', async (t) => {
  const root = await repository(t);
  assert.deepEqual((await readOverview(root)).upstream, { kind: 'none' });
  fixtureGit(root, 'remote', 'add', 'team', 'ext::twiglet-transport-must-not-run');
  fixtureGit(root, 'config', 'branch.topic.remote', 'team');
  fixtureGit(root, 'config', 'branch.topic.merge', 'refs/heads/topic');
  assertUnavailable((await readOverview(root)).upstream, 'missing-ref');
  fixtureGit(root, 'config', '--unset-all', 'remote.team.fetch');
  assertUnavailable((await readOverview(root)).upstream, 'unresolved');
  fixtureGit(root, 'config', '--add', 'branch.topic.merge', 'refs/heads/another');
  assertUnavailable((await readOverview(root)).upstream, 'unresolved');
});

test('unborn, detached and shallow histories never pretend to have zero divergence', async (t) => {
  const empty = await repository(t, false);
  fixtureGit(empty, 'config', 'branch.topic.remote', 'team');
  fixtureGit(empty, 'config', 'branch.topic.merge', 'refs/heads/topic');
  const unborn = (await readOverview(empty)).upstream;
  assertUnavailable(unborn, 'unborn');
  assert.equal(unborn.kind === 'unavailable' && unborn.configured, 'team:refs/heads/topic');
  const root = await repository(t);
  fixtureGit(root, 'branch', 'other');
  fixtureGit(root, 'branch', '--set-upstream-to=other');
  await writeFile(path.join(root, '.git', 'shallow'), fixtureGit(root, 'rev-parse', 'HEAD') + '\n');
  assertUnavailable((await readOverview(root)).upstream, 'shallow');
  fixtureGit(root, 'checkout', '--detach');
  assertUnavailable((await readOverview(root)).upstream, 'detached');
});

test('operational comparison errors preserve target identity and do not become counts', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'other');
  fixtureGit(root, 'branch', '--set-upstream-to=other');
  const head = await readHead(root);
  const result = await readUpstream(root, head, false, undefined, async (cwd, args, signal) => {
    if (args[0] === 'rev-list') throw new Error('Git inspection timed out after 15 seconds.');
    return runGit(cwd, args, signal);
  });
  assertUnavailable(result, 'error');
  assert.equal(result.kind === 'unavailable' && result.target?.ref, 'refs/heads/other');
  const text = renderOverview({ ...(await readOverview(root)), upstream: result });
  assert.match(text, /Working tree: clean/);
  assert.match(text, /timed out/);
});

test('HEAD switching during a comparison is detected instead of labelling the wrong branch', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'other');
  fixtureGit(root, 'branch', '--set-upstream-to=other');
  const head = await readHead(root);
  const result = await readUpstream(root, head, false, undefined, async (cwd, args, signal) => {
    const value = await runGit(cwd, args, signal);
    if (args[0] === 'rev-list') fixtureGit(root, 'checkout', 'other');
    return value;
  });
  assertUnavailable(result, 'changed-head');
});

test('cancellation is not swallowed as optional comparison information', async (t) => {
  const root = await repository(t);
  const head = await readHead(root);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(readUpstream(root, head, false, abort.signal), /cancelled/);
});

test('divergence parser rejects malformed or unsafe counts', () => {
  assert.deepEqual(parseDivergence(Buffer.from('2\t3\n')), { ahead: 2, behind: 3 });
  for (const value of ['', 'error', '-1 0', '1 2 3', '9007199254740992 0']) assert.throws(() => parseDivergence(Buffer.from(value)));
});
