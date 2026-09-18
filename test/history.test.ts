import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readRecentCommits } from '../src/core/history.js';
import { parseHistory } from '../src/git/history.js';
import { renderHistory } from '../src/terminal/render.js';
import { assertSameDirectory, directoryAlias, fixtureGit, repository, snapshot } from './helpers.js';

test('bounded real history includes merged ancestry, ordering, and full commit metadata', async (t) => {
  const root = await repository(t);
  const initial = fixtureGit(root, 'rev-parse', 'HEAD');
  fixtureGit(root, 'checkout', '-b', 'side');
  fixtureGit(root, 'commit', '--allow-empty', '-m', 'Side é');
  const side = fixtureGit(root, 'rev-parse', 'HEAD');
  fixtureGit(root, 'checkout', 'topic');
  fixtureGit(root, 'commit', '--allow-empty', '-m', 'Topic');
  const topic = fixtureGit(root, 'rev-parse', 'HEAD');
  fixtureGit(root, 'merge', '--no-ff', '-m', 'Merge side', 'side');
  const merged = fixtureGit(root, 'rev-parse', 'HEAD');
  const before = await snapshot(root);
  const history = await readRecentCommits(root);
  assert.deepEqual(new Set(history.commits.map((c) => c.oid)), new Set([initial, side, topic, merged]));
  assert.equal(history.commits[0]?.oid, merged);
  assert.equal(history.commits.at(-1)?.oid, initial);
  assert.deepEqual(history.commits[0]?.parents, [topic, side]);
  assert.equal(history.commits[0]?.author, 'Twiglet Test');
  assert.match(history.commits[0]!.committedAt, /^2024-01-01T/);
  const limited = await readRecentCommits(root, 2);
  assert.equal(limited.commits.length, 2);
  assert.equal(limited.hasMore, true);
  assert.equal((await readRecentCommits(root, 4)).hasMore, false);
  assert.deepEqual(await snapshot(root), before);
});

test('history supports unborn, detached, shallow, aliases, and nested directories', async (t) => {
  const empty = await readRecentCommits(await repository(t, false));
  assert.equal(empty.head.kind, 'unborn');
  assert.deepEqual(empty.commits, []);
  assert.match(renderHistory(empty), /No commits yet/);
  const root = await repository(t);
  fixtureGit(root, 'checkout', '--detach');
  await writeFile(path.join(root, '.git', 'shallow'), fixtureGit(root, 'rev-parse', 'HEAD') + '\n');
  const alias = await directoryAlias(t, root);
  await mkdir(path.join(alias, 'nested'));
  const result = await readRecentCommits(path.join(alias, 'nested'));
  await assertSameDirectory(result.root, root);
  assert.equal(result.head.kind, 'detached');
  assert.equal(result.shallow, true);
  assert.equal(result.commits.length, 1);
  assert.match(renderHistory(result), /Shallow repository/);
});

test('history does not read the index, run helpers, or require upstream comparison', async (t) => {
  const root = await repository(t);
  // A status scan fails on this index; commit traversal must not need it.
  await writeFile(path.join(root, '.git', 'index'), 'not an index');
  fixtureGit(root, 'config', 'log.showSignature', 'true');
  fixtureGit(root, 'config', 'gpg.program', 'twiglet-helper-must-not-run');
  fixtureGit(root, 'config', 'core.fsmonitor', 'twiglet-helper-must-not-run');
  fixtureGit(root, 'config', 'branch.topic.remote', 'missing-remote');
  const before = await snapshot(root);
  assert.equal((await readRecentCommits(root)).commits[0]?.subject, 'Initial');
  assert.deepEqual(await snapshot(root), before);
});

test('history rejects partial clones and invalid limits without scanning', async (t) => {
  const root = await repository(t);
  for (const limit of [0, -1, 101, 1.5, NaN]) await assert.rejects(readRecentCommits(root, limit), /integer from 1 to 100/);
  fixtureGit(root, 'config', 'remote.other.promisor', 'true');
  await assert.rejects(readRecentCommits(root), /Partial-clone/);
});

test('history parser and presentation preserve Unicode and escape controls', () => {
  const commits = parseHistory(Buffer.from(['abc', 'def fed', 'Zoë\x1b[2J', '2024-01-01T00:00:00+00:00', 'Subject\t\x1b[2J', ''].join('\0')));
  assert.equal(commits[0]?.author, 'Zoë\x1b[2J');
  const output = renderHistory({ root: '/repo', head: { kind: 'detached', oid: 'abc' }, commits, shallow: false, hasMore: true, limit: 1 });
  assert(!output.includes('\x1b'));
  assert.match(output, /merge/);
  assert.match(output, /Showing 1 commits/);
  for (const malformed of ['abc', 'abc\0', ['bad-id', '', 'Author', '2024-01-01T00:00:00Z', 'Subject', ''].join('\0')]) {
    assert.throws(() => parseHistory(Buffer.from(malformed)), /malformed/);
  }
});
