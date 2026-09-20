import assert from 'node:assert/strict';
import test from 'node:test';
import { interactiveSession } from '../src/terminal/session.js';
import type { Terminal } from '../src/terminal/session.js';
import type { Overview, RecentCommits } from '../src/core/types.js';
import { readRecentCommits } from '../src/core/history.js';
import { listLocalBranches, readBranchDetails } from '../src/core/branches.js';
import { fixtureGit, repository } from './helpers.js';
import { readComparison, readComparisonDetail } from '../src/core/comparison.js';

const unusedComparison = { prs: async () => { throw new Error('Unexpected online check'); }, comparisonPatch: async () => { throw new Error('Unexpected patch'); }, compare: async () => { throw new Error('Unexpected comparison'); }, comparisonDetail: async () => { throw new Error('Unexpected comparison detail'); } };
const unusedBranches = { ...unusedComparison, branches: async () => { throw new Error('Unexpected branch list'); }, branch: async () => { throw new Error('Unexpected branch detail'); } };

const overview: Overview = { root: '/repo', head: { kind: 'unborn', name: 'topic' }, upstream: { kind: 'none' }, changes: [], shallow: false, filtersDisabled: false };
const history: RecentCommits = { root: '/repo', head: overview.head, shallow: false, commits: [], limit: 20, hasMore: false };

test('Refresh rereads real history after a local commit', async (t) => {
  const repo = await repository(t);
  const answers = ['history', 'refresh', 'back', 'exit'];
  const views: string[] = [];
  await interactiveSession({
    choose: async () => {
      const answer = answers.shift()!;
      if (answer === 'refresh') fixtureGit(repo, 'commit', '--allow-empty', '-m', 'New local commit');
      return answer;
    },
    write: (text) => { if (text.includes('Location:')) views.push(text); },
  }, { ...unusedBranches, overview: async () => overview, history: () => readRecentCommits(repo) });
  assert.equal(views.length, 2);
  assert(!views[0]!.includes('New local commit'));
  assert.match(views[1]!, /New local commit/);
});

test('overview and history refresh independently and preserve selection', async () => {
  const answers = ['overview', 'refresh', 'back', 'history', 'refresh', 'back', 'exit'];
  const menus: string[][] = [];
  const defaults: (string | undefined)[] = [];
  let output = '';
  const calls: string[] = [];
  const terminal: Terminal = {
    choose: async (message, choices, defaultValue) => {
      menus.push(choices.map((c) => c.name));
      if (message === 'Twiglet') defaults.push(defaultValue);
      const value = answers.shift()!;
      assert(choices.some((c) => c.value === value));
      return value;
    },
    write: (text) => { output += text; },
  };
  await interactiveSession(terminal, {
    ...unusedBranches,
    overview: async () => { calls.push('overview'); return overview; },
    history: async () => { calls.push('history'); return history; },
  });
  assert.deepEqual(calls, ['overview', 'overview', 'history', 'history']);
  assert.deepEqual(defaults, ['overview', 'overview', 'history']);
  assert.deepEqual(menus[0], ['Repository overview', 'Recent commits', 'Local branches', 'Check Bitbucket PRs (online)', 'Exit']);
  assert.deepEqual(menus[1], ['Back', 'Refresh']);
  assert.match(output, /No commits yet/);
});
test('history errors allow Refresh and recovery', async () => {
  const answers = ['history', 'refresh', 'back', 'exit'];
  let output = '';
  let calls = 0;
  await interactiveSession({ choose: async () => answers.shift()!, write: (s) => { output += s; } }, {
    ...unusedBranches,
    overview: async () => { throw new Error('Unexpected overview call'); },
    history: async () => { if (!calls++) throw new Error('not a repository\x1b[2J'); return history; },
  });
  assert.match(output, /Unable to inspect/);
  assert.match(output, /No commits yet/);
  assert(!output.includes('\x1b'));
});

test('unavailable comparison leaves overview and navigation usable', async () => {
  const answers = ['overview', 'back', 'exit'];
  let output = '';
  await interactiveSession({ choose: async () => answers.shift()!, write: (s) => { output += s; } }, {
    ...unusedBranches,
    overview: async () => ({ ...overview, upstream: { kind: 'unavailable', reason: 'error', message: 'Comparison timed out.' } }),
    history: async () => history,
  });
  assert.match(output, /HEAD: topic/);
  assert.match(output, /Working tree: clean/);
  assert.match(output, /Comparison timed out/);
});

test('branch navigation refreshes real tips, retains selection and recovers after deletion', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'selected');
  const answers = ['branches', 'refs/heads/selected', 'refresh', 'back', 'refresh', 'refs/heads/selected', 'back', 'back', 'exit'];
  const defaults: (string | undefined)[] = [];
  let output = '';
  let details = 0;
  await interactiveSession({
    choose: async (message, choices, defaultValue) => {
      if (message === 'Local branches') defaults.push(defaultValue);
      const answer = answers.shift()!;
      assert(choices.some((choice) => choice.value === answer));
      if (message === 'Navigation' && answer === 'refresh') {
        const next = fixtureGit(root, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Refreshed branch');
        fixtureGit(root, 'update-ref', 'refs/heads/selected', next);
      }
      return answer;
    },
    write: (text) => { output += text; },
  }, {
    ...unusedComparison,
    overview: async () => overview, history: async () => history,
    branches: () => listLocalBranches(root),
    branch: (name) => {
      if (++details === 3) fixtureGit(root, 'branch', '-D', name);
      return readBranchDetails(root, name);
    },
  });
  assert.match(output, /Refreshed branch/);
  assert.match(output, /Local branch not found/);
  assert.deepEqual(defaults, ['refs/heads/topic', 'refs/heads/selected', 'refs/heads/selected', 'refs/heads/topic']);
  assert.equal(fixtureGit(root, 'symbolic-ref', '--short', 'HEAD'), 'topic');
});

test('comparison navigation swaps captured tips, refreshes and returns to selection', async (t) => {
  const root = await repository(t);
  fixtureGit(root, 'branch', 'selected');
  const answers = ['branches', 'refs/heads/selected', 'compare', 'refs/heads/topic', 'commits-a', 'back', 'swap', 'tips', 'refresh', 'since-base', 'back', 'back', 'back', 'back', 'exit'];
  const pairs: string[][] = [];
  let output = '';
  await interactiveSession({
    choose: async (message, choices, defaultValue) => {
      if (message === 'Reference branch A') assert.equal(defaultValue, 'refs/heads/topic');
      const answer = answers.shift()!;
      assert(choices.some((choice) => choice.value === answer), `${message}: ${answer}`);
      if (answer === 'tips') {
        const next = fixtureGit(root, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Moved tip');
        fixtureGit(root, 'update-ref', 'refs/heads/selected', next);
      }
      return answer;
    }, write: (text) => { output += text; },
  }, {
    overview: async () => overview, history: async () => history,
    branches: () => listLocalBranches(root), branch: (name) => readBranchDetails(root, name),
    compare: (a, b) => { pairs.push([a, b]); return readComparison(root, a, b); },
    prs: unusedComparison.prs,
    comparisonPatch: unusedComparison.comparisonPatch,
    comparisonDetail: (comparison, view) => readComparisonDetail(comparison, view),
  });
  assert.deepEqual(pairs, [['topic', 'selected'], ['selected', 'topic']]);
  assert.match(output, /moved or disappeared/);
  assert.match(output, /Files: merge base → B tip/);
  assert.equal(answers.length, 0);
});

test('cancellation inside comparison selection exits instead of becoming an inspection error', async (t) => {
  const root = await repository(t); fixtureGit(root, 'branch', 'other');
  const answers = ['branches', 'refs/heads/topic', 'compare'];
  await assert.rejects(interactiveSession({
    choose: async (message) => {
      if (message === 'Reference branch A') throw Object.assign(new Error('Cancelled'), { name: 'ExitPromptError' });
      return answers.shift()!;
    }, write: () => {},
  }, {
    ...unusedComparison, overview: async () => overview, history: async () => history,
    branches: () => listLocalBranches(root), branch: (name) => readBranchDetails(root, name),
  }), { name: 'ExitPromptError' });
});
