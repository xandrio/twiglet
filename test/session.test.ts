import assert from 'node:assert/strict';
import test from 'node:test';
import { interactiveSession } from '../src/terminal/session.js';
import type { Terminal } from '../src/terminal/session.js';

test('overview -> Back -> menu -> Exit, loading Git only on selection', async () => {
  const answers = ['overview', 'back', 'exit'];
  const menus: string[][] = [];
  let output = '';
  let calls = 0;
  const terminal: Terminal = {
    choose: async (_message, choices) => {
      menus.push(choices.map((c) => c.name));
      const value = answers.shift()!;
      assert(choices.some((c) => c.value === value));
      return value;
    },
    write: (text) => { output += text; },
  };
  await interactiveSession(terminal, async () => {
    calls++;
    return { root: '/repo', head: { kind: 'unborn', name: 'topic' }, changes: [], shallow: false, filtersDisabled: false };
  });
  assert.equal(calls, 1);
  assert.deepEqual(menus, [['Repository overview', 'Exit'], ['Back'], ['Repository overview', 'Exit']]);
  assert.match(output, /no commits yet/);
});
test('inspection errors allow Back and Exit', async () => {
  const answers = ['overview', 'back', 'exit'];
  let output = '';
  await interactiveSession({ choose: async () => answers.shift()!, write: (s) => { output += s; } },
    async () => { throw new Error('not a repository\x1b[2J'); });
  assert.match(output, /Unable to inspect/);
  assert(!output.includes('\x1b'));
});
