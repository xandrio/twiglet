import assert from 'node:assert/strict';
import test from 'node:test';
import { interactiveSession } from '../src/terminal/session.js';
import type { Terminal } from '../src/terminal/session.js';
import type { Overview, RecentCommits } from '../src/core/types.js';
import { readRecentCommits } from '../src/core/history.js';
import { fixtureGit, repository } from './helpers.js';

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
  }, { overview: async () => overview, history: () => readRecentCommits(repo) });
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
    overview: async () => { calls.push('overview'); return overview; },
    history: async () => { calls.push('history'); return history; },
  });
  assert.deepEqual(calls, ['overview', 'overview', 'history', 'history']);
  assert.deepEqual(defaults, ['overview', 'overview', 'history']);
  assert.deepEqual(menus[0], ['Repository overview', 'Recent commits', 'Exit']);
  assert.deepEqual(menus[1], ['Back', 'Refresh']);
  assert.match(output, /No commits yet/);
});
test('history errors allow Refresh and recovery', async () => {
  const answers = ['history', 'refresh', 'back', 'exit'];
  let output = '';
  let calls = 0;
  await interactiveSession({ choose: async () => answers.shift()!, write: (s) => { output += s; } }, {
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
    overview: async () => ({ ...overview, upstream: { kind: 'unavailable', reason: 'error', message: 'Comparison timed out.' } }),
    history: async () => history,
  });
  assert.match(output, /HEAD: topic/);
  assert.match(output, /Working tree: clean/);
  assert.match(output, /Comparison timed out/);
});
