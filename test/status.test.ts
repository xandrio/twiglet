import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStatus } from '../src/git/status.js';
import { displayPath, renderOverview, safeText } from '../src/terminal/render.js';

const header = '# branch.oid abc123\0# branch.head topic\0';
test('parses rename paths including spaces/newlines and future headers', () => {
  const result = parseStatus(Buffer.from(header + '# future.header value\0# branch.upstream other/topic\0' +
    '2 RM N... 100644 100644 100644 abc def R100 new\n name\0old name\0'));
  assert.deepEqual(result.head, { kind: 'branch', name: 'topic', oid: 'abc123' });
  assert.equal(result.upstream, 'other/topic');
  assert.equal(result.changes[0]?.originalPath?.toString(), 'old name');
  assert.equal(result.changes[0]?.path.toString(), 'new\n name');
  assert.equal(result.changes[0]?.index, 'R');
  assert.equal(result.changes[0]?.worktree, 'M');
});
test('preserves non-UTF8 path bytes', () => {
  const result = parseStatus(Buffer.concat([Buffer.from(header + '? '), Buffer.from([255, 10, 97, 0])]));
  assert.deepEqual(result.changes[0]?.path, Buffer.from([255, 10, 97]));
  assert.equal(displayPath(result.changes[0]!.path), '[path bytes: ff0a61]');
});
test('parses conflict metadata separately from path', () => {
  const result = parseStatus(Buffer.from(header + 'u UU N... 100644 100644 100644 100644 aaa bbb ccc file name\0'));
  assert.equal(result.changes[0]?.kind, 'conflict');
  assert.equal(result.changes[0]?.path.toString(), 'file name');
});
for (const [label, raw] of [
  ['missing terminator', header + '? x'], ['missing header', '? x\0'],
  ['missing rename source', header + '2 R. N... 1 1 1 a b R100 dest\0'],
  ['bad fields', header + '1 M\0'], ['unknown record', header + 'x x\0'],
] as const) {
  test(`rejects malformed status: ${label}`, () => assert.throws(() => parseStatus(Buffer.from(raw)), /malformed/));
}
test('escapes terminal controls and labels overlapping counts and truncation', () => {
  assert.equal(safeText('x\x1b[2J\n'), 'x\\u001b[2J\\u000a');
  const text = renderOverview({ root: '/repo', head: { kind: 'unborn', name: 'topic' }, upstream: { kind: 'none' }, shallow: true, filtersDisabled: false,
    changes: Array.from({ length: 31 }, (_, i) => ({ kind: 'tracked' as const, path: Buffer.from(`f${i}`), index: 'M', worktree: 'M' })) });
  assert.match(text, /Staged: 31 entries/);
  assert.match(text, /Unstaged: 31 entries/);
  assert.match(text, /1 more entries/);
  assert.match(text, /no commits yet/);
  assert.match(text, /shallow/);
});
