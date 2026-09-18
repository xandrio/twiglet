import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import test from 'node:test';
import { createStyle, outputStyle } from '../src/terminal/style.js';
import { renderHistory, renderOverview } from '../src/terminal/render.js';
import { renderBranchDetails, renderBranches } from '../src/terminal/branches.js';
import type { BranchDetails, BranchList, Overview, RecentCommits } from '../src/core/types.js';

test('styling preserves all text and escapes Git-controlled terminal sequences', () => {
  const tip = { oid: 'abc123456789abcdef', parents: [], subject: 'Subject\x1b[2J', author: 'Zoë\x1b[31m', committedAt: '2024-01-01T00:00:00Z' };
  const head = { kind: 'branch' as const, name: 'feature/é', oid: tip.oid };
  const upstream = { kind: 'compared' as const, target: { ref: 'refs/remotes/team/feature/é', source: 'remote-tracking' as const }, headOid: tip.oid, upstreamOid: tip.oid, ahead: 2, behind: 1 };
  const overview: Overview = { root: '/repo', head, upstream, changes: [], shallow: true, filtersDisabled: true };
  const history: RecentCommits = { root: '/repo', head, commits: [tip], shallow: false, hasMore: false, limit: 20 };
  const branch = { ref: 'refs/heads/feature/é', name: head.name, current: true, tip, tracking: { kind: 'configured' as const, target: upstream.target, available: false } };
  const list: BranchList = { root: '/repo', head, branches: [branch] };
  const details: BranchDetails = { root: '/repo', branch, shallow: false, upstream, history: { kind: 'available', commits: [tip], hasMore: false } };
  const color = createStyle(true);
  for (const [plain, styled] of [
    [renderOverview(overview), renderOverview(overview, color)],
    [renderHistory(history), renderHistory(history, color)],
    [renderBranches(list), renderBranches(list, color)],
    [renderBranchDetails(details), renderBranchDetails(details, color)],
    [renderBranchDetails({ ...details, history: { kind: 'unavailable', message: 'Failed\x1b[2J' } }), renderBranchDetails({ ...details, history: { kind: 'unavailable', message: 'Failed\x1b[2J' } }, color)],
  ]) {
    assert.equal(stripVTControlCharacters(styled!), plain);
    assert(!plain!.includes('\x1b'));
    assert(styled!.includes('\x1b['));
    assert(!styled!.includes('\x1b[2J'));
  }
  assert.match(renderOverview(overview, color), /refs\/remotes\/team\/feature\/é/);
  assert.match(renderBranches(list, color), /refs\/remotes\/team\/feature\/é/);
});

test('output styling obeys destination, NO_COLOR, dumb terminals and explicit disabling', () => {
  const env = { TERM: 'xterm' };
  assert.notEqual(outputStyle({ isTTY: true }, env).branch('topic'), 'topic');
  for (const [stream, settings] of [
    [{ isTTY: false }, { ...env, FORCE_COLOR: '1' }],
    [{ isTTY: true }, { ...env, NO_COLOR: '1', FORCE_COLOR: '1' }],
    [{ isTTY: true }, { TERM: 'dumb', FORCE_COLOR: '1' }],
    [{ isTTY: true }, { ...env, FORCE_COLOR: '0' }],
  ] as const) assert.equal(outputStyle(stream, settings).branch('topic'), 'topic');
});
