import type { Change, Head, Overview, RecentCommits, Upstream } from '../core/types.js';

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

function headLabel(head: Head): string {
  return head.kind === 'detached' ? `Detached HEAD (${head.oid.slice(0, 12)})`
    : head.kind === 'unborn' ? `${safeText(head.name)} (no commits yet)`
    : `${safeText(head.name)} (${head.oid.slice(0, 12)})`;
}

export function renderUpstream(upstream: Upstream): string[] {
  if (upstream.kind === 'none') return ['Upstream: not configured'];
  const target = upstream.target;
  const name = target ? safeText(target.ref.replace(/^refs\/(heads|remotes)\//, ''))
    : upstream.kind === 'unavailable' && upstream.configured ? safeText(upstream.configured) : 'unavailable';
  const lines = [`Upstream: ${name}${target?.source === 'local-branch' ? ' (local branch)' : ''}`];
  if (upstream.kind === 'compared') {
    lines.push(upstream.ahead === 0 && upstream.behind === 0 ? 'Matches the local upstream reference.'
      : `Ahead: ${upstream.ahead} commits   Behind: ${upstream.behind} commits`);
  } else lines.push(`Comparison unavailable: ${safeText(upstream.message)}`);
  if (target?.source === 'remote-tracking') {
    lines.push('Remote-tracking information is local. Remote freshness unknown; no fetch performed.');
  }
  return lines;
}

export function renderOverview(overview: Overview): string {
  const { head, changes } = overview;
  const lines = [
    'Repository overview', `Location: ${safeText(overview.root)}`, `HEAD: ${headLabel(head)}`,
    ...renderUpstream(overview.upstream),
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

export function renderHistory(history: RecentCommits): string {
  const lines = ['Recent commits', `Location: ${safeText(history.root)}`, `HEAD: ${headLabel(history.head)}`,
    'History reachable from this HEAD, including merges. Dates are commit dates.', ''];
  if (history.head.kind === 'unborn') lines.push('No commits yet.');
  for (const commit of history.commits) {
    lines.push(`${commit.oid.slice(0, 12)} ${safeText(commit.subject) || '(no subject)'}`,
      `  ${safeText(commit.author)} | ${commit.committedAt}${commit.parents.length > 1 ? ' | merge' : ''}`);
  }
  if (history.hasMore) lines.push(`\nShowing ${history.limit} commits; more are available. Use tl log --limit N (up to 100).`);
  if (history.shallow) lines.push('\nShallow repository: only locally available history is shown.');
  return lines.join('\n') + '\n';
}
