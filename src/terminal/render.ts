import type { Change, Overview } from '../core/types.js';

/** Repository text is data, never terminal escape sequences. */
export function safeText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function displayPath(path: Buffer): string {
  const text = path.toString('utf8');
  // Invalid UTF-8 must remain distinguishable instead of becoming replacement glyphs.
  if (!Buffer.from(text).equals(path)) return `[path bytes: ${path.toString('hex')}]`;
  return safeText(text);
}

export function renderOverview(overview: Overview): string {
  const { head, changes } = overview;
  const label = head.kind === 'detached' ? `Detached HEAD (${head.oid.slice(0, 12)})`
    : head.kind === 'unborn' ? `${safeText(head.name)} (no commits yet)`
    : `${safeText(head.name)} (${head.oid.slice(0, 12)})`;
  const lines = [
    'Repository overview', `Location: ${safeText(overview.root)}`, `HEAD: ${label}`,
    `Upstream: ${overview.upstream ? safeText(overview.upstream) + ' (local configuration; not refreshed)' : 'not configured'}`,
  ];
  if (overview.shallow) lines.push('History: shallow clone; history is incomplete.');
  if (overview.filtersDisabled) lines.push('External clean filters disabled; filtered paths may appear modified.');
  lines.push('');
  const groups: [string, Change[]][] = [
    ['Conflicts', changes.filter((c) => c.kind === 'conflict')],
    ['Staged', changes.filter((c) => c.kind !== 'conflict' && c.kind !== 'untracked' && c.index !== '.')],
    ['Unstaged', changes.filter((c) => c.kind !== 'conflict' && c.kind !== 'untracked' && c.worktree !== '.')],
    ['Untracked', changes.filter((c) => c.kind === 'untracked')],
  ];
  if (!changes.length) lines.push('Working tree: clean (excluding submodule contents).');
  for (const [title, entries] of groups) {
    if (!entries.length) continue;
    lines.push(`${title}: ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`);
    for (const entry of entries.slice(0, 30)) {
      const from = entry.originalPath ? `${displayPath(entry.originalPath)} -> ` : '';
      lines.push(`  ${entry.index}${entry.worktree} ${from}${displayPath(entry.path)}`);
    }
    if (entries.length > 30) lines.push(`  ... ${entries.length - 30} more entries`);
  }
  lines.push('', 'Untracked directories are grouped. A path can be both staged and unstaged.',
    'Submodule worktrees are not inspected. No fetch is performed.');
  return lines.join('\n') + '\n';
}
