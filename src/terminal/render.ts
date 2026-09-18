import type { Change, CommitSummary, Head, Overview, RecentCommits, Upstream } from '../core/types.js';
import { plain } from './style.js';
import type { Style } from './style.js';

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

function headLabel(head: Head, style: Style): string {
  return head.kind === 'detached' ? `${style.warning('Detached HEAD')} (${style.hash(head.oid.slice(0, 12))})`
    : head.kind === 'unborn' ? `${style.branch(safeText(head.name))} (no commits yet)`
    : `${style.branch(safeText(head.name))} (${style.hash(head.oid.slice(0, 12))})`;
}

export function renderUpstream(upstream: Upstream, style: Style = plain): string[] {
  if (upstream.kind === 'none') return [`Upstream: ${style.muted('not configured')}`];
  const target = upstream.target;
  const name = target ? safeText(target.ref)
    : upstream.kind === 'unavailable' && upstream.configured ? safeText(upstream.configured) : 'unavailable';
  const lines = [`Upstream: ${style.ref(name)}${target?.source === 'local-branch' ? ' (local branch)' : ''}`];
  if (upstream.kind === 'compared') {
    lines.push(upstream.ahead === 0 && upstream.behind === 0 ? style.good('Matches the local upstream reference.')
      : `Ahead: ${style.heading(String(upstream.ahead))} commits   Behind: ${style.heading(String(upstream.behind))} commits`);
  } else lines.push(style.warning(`Comparison unavailable: ${safeText(upstream.message)}`));
  if (target?.source === 'remote-tracking') {
    lines.push('Remote-tracking information is local. Remote freshness unknown; no fetch performed.');
  }
  return lines;
}

export function renderOverview(overview: Overview, style: Style = plain): string {
  const { head, changes } = overview;
  const lines = [
    style.heading('Repository overview'), `Location: ${safeText(overview.root)}`, `HEAD: ${headLabel(head, style)}`,
    ...renderUpstream(overview.upstream, style),
  ];
  if (overview.shallow) lines.push(style.warning('History: shallow clone; history is incomplete.'));
  if (overview.filtersDisabled) lines.push(style.warning('External clean filters disabled; filtered paths may appear modified.'));
  lines.push('');
  const groups: [string, Change[]][] = [
    ['Conflicts', changes.filter((c) => c.kind === 'conflict')],
    ['Staged', changes.filter((c) => c.kind !== 'conflict' && c.kind !== 'untracked' && c.index !== '.')],
    ['Unstaged', changes.filter((c) => c.kind !== 'conflict' && c.kind !== 'untracked' && c.worktree !== '.')],
    ['Untracked', changes.filter((c) => c.kind === 'untracked')],
  ];
  if (!changes.length) lines.push(`Working tree: ${style.good('clean')} (excluding submodule contents).`);
  for (const [title, entries] of groups) {
    if (!entries.length) continue;
    const emphasize = title === 'Conflicts' ? style.error : title === 'Staged' ? style.good : style.warning;
    lines.push(emphasize(`${title}: ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`));
    for (const entry of entries.slice(0, 30)) {
      const from = entry.originalPath ? `${displayPath(entry.originalPath)} -> ` : '';
      lines.push(`  ${emphasize(entry.index + entry.worktree)} ${from}${displayPath(entry.path)}`);
    }
    if (entries.length > 30) lines.push(`  ... ${entries.length - 30} more entries`);
  }
  lines.push('', 'Untracked directories are grouped. A path can be both staged and unstaged.',
    'Submodule worktrees are not inspected. No fetch is performed.');
  return lines.join('\n') + '\n';
}

export function renderCommit(commit: CommitSummary, style: Style = plain): string[] {
  return [`${style.hash(commit.oid.slice(0, 12))} ${style.subject(safeText(commit.subject) || '(no subject)')}`,
    `  ${style.author(safeText(commit.author))} | ${style.muted(safeText(commit.committedAt))}${commit.parents.length > 1 ? ' | merge' : ''}`];
}

export function renderHistory(history: RecentCommits, style: Style = plain): string {
  const lines = [style.heading('Recent commits'), `Location: ${safeText(history.root)}`, `HEAD: ${headLabel(history.head, style)}`,
    'History reachable from this HEAD, including merges. Dates are commit dates.', ''];
  if (history.head.kind === 'unborn') lines.push('No commits yet.');
  for (const commit of history.commits) {
    lines.push(...renderCommit(commit, style));
  }
  if (history.hasMore) lines.push(`\nShowing ${history.limit} commits; more are available. Use tl log --limit N (up to 100).`);
  if (history.shallow) lines.push('\n' + style.warning('Shallow repository: only locally available history is shown.'));
  return lines.join('\n') + '\n';
}
