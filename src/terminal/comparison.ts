import type { Comparison, ComparisonDetail, ComparisonView } from '../core/comparison.js';
import { displayPath, renderCommit, safeText } from './render.js';
import { plain } from './style.js';
import type { Style } from './style.js';
import type { RepositoryOperations, Terminal } from './session.js';
import { branchChoice } from './branches.js';

function endpoints(comparison: Comparison, style: Style): string[] {
  return [`${style.heading('A')} (reference): ${style.ref(safeText(comparison.a.ref))} ${style.hash(comparison.a.oid)}`,
    `${style.heading('B')} (inspected): ${style.ref(safeText(comparison.b.ref))} ${style.hash(comparison.b.oid)}`];
}

export function renderComparison(comparison: Comparison, style: Style = plain): string {
  const lines = [style.heading('Branch comparison'), `Location: ${safeText(comparison.root)}`, ...endpoints(comparison, style), ''];
  if (comparison.counts.kind === 'available') lines.push(`Only in A: ${style.heading(String(comparison.counts.value.a))} commits`, `Only in B: ${style.heading(String(comparison.counts.value.b))} commits`);
  else lines.push(style.warning(comparison.counts.message));
  if (comparison.bases.kind === 'unavailable') lines.push(style.warning(comparison.bases.message));
  else if (!comparison.bases.value.length) lines.push('Merge base: none (unrelated histories).');
  else if (comparison.bases.value.length === 1) lines.push(`Merge base: ${style.hash(comparison.bases.value[0]!)}`);
  else lines.push('Multiple merge bases; no single base selected:', ...comparison.bases.value.map((id) => `  ${style.hash(id)}`));
  lines.push('', style.muted('Unique commits describe reachability, not patch equivalence. File views compare committed snapshots.'),
    style.muted('No checkout, working-tree comparison, fetch, or prediction of a merge result.'));
  return lines.join('\n') + '\n';
}

export function renderComparisonDetail(comparison: Comparison, detail: ComparisonDetail, style: Style = plain): string {
  const title = detail.kind === 'commits' ? `Commits only in ${detail.side.toUpperCase()}` : detail.view === 'tips' ? 'Files: A tip → B tip' : 'Files: merge base → B tip';
  const lines = [style.heading(title), ...endpoints(comparison, style)];
  if (detail.kind === 'commits') {
    lines.push(style.muted('Reachable only from this side, including merges; patch-equivalent commits are not excluded.'), '', `Total: ${style.heading(String(detail.total))} commits`, '');
    for (const commit of detail.commits) lines.push(...renderCommit(commit, style));
    if (!detail.total) lines.push('No unique commits on this side.');
    if (detail.total > detail.commits.length) lines.push('', style.muted(`Showing ${detail.commits.length} of ${detail.total} commits.`));
  } else {
    lines.push(`Before: ${style.hash(detail.before)}`, `After: ${style.hash(detail.after)}`,
      style.muted(detail.view === 'tips' ? 'Changes to transform the A snapshot into the B snapshot.' : 'Net changes from the common ancestor snapshot to B; not a predicted merge result.'),
      '', `Changed paths: ${style.heading(String(detail.total))}`, '');
    for (const file of detail.files) {
      const from = file.originalPath ? `${displayPath(file.originalPath)} -> ` : '';
      lines.push(`  ${style.heading(file.status)} ${from}${displayPath(file.path)}${file.similarity !== undefined ? style.muted(` (${file.similarity}% similarity)`) : ''}${file.submodule ? style.muted(' [submodule pointer]') : ''}`);
    }
    if (!detail.total) lines.push('No committed file differences between these endpoints.');
    if (detail.total > detail.files.length) lines.push('', style.muted(`Showing ${detail.files.length} of ${detail.total} changed paths.`));
    lines.push('', style.muted('A added · M modified · D deleted · R renamed · T type changed.'),
      style.muted('Renames: Git similarity ≥50%, exhaustive search limited to 1000 candidates.'));
  }
  return lines.join('\n') + '\n';
}

export async function comparisonSession(terminal: Terminal, operations: RepositoryOperations, inspected: string, signal?: AbortSignal): Promise<void> {
  const style = terminal.style ?? plain;
  try {
    const list = await operations.branches();
    const candidates = list.branches.filter((branch) => branch.name !== inspected);
    if (!candidates.length) { terminal.write('No other local branch is available for comparison.\n'); return; }
    const choice = await terminal.choose('Reference branch A', [{ name: 'Back', value: 'back' }, ...candidates.map((branch) => ({ name: branchChoice(branch), short: safeText(branch.name), value: branch.ref }))], candidates.find((branch) => branch.current)?.ref ?? 'back');
    if (choice === 'back') return;
    let a = candidates.find((branch) => branch.ref === choice)!.name;
    let b = inspected;
    let comparison: Comparison | undefined;
    let reload = true;
    while (!signal?.aborted) {
      if (reload) {
        comparison = undefined;
        try { comparison = await operations.compare(a, b); terminal.write('\n' + renderComparison(comparison, style)); }
        catch (error) {
          if (signal?.aborted) return;
          terminal.write(style.error(safeText(error instanceof Error ? error.message : String(error))) + '\n');
        }
        reload = false;
      }
      const action = await terminal.choose('Comparison', [
        ...(comparison ? [
          { name: 'Commits only in A', value: 'commits-a' }, { name: 'Commits only in B', value: 'commits-b' },
          { name: 'Files: A tip → B tip', value: 'tips' }, { name: 'Files: merge base → B tip', value: 'since-base' },
          { name: 'Swap A and B', value: 'swap' },
        ] : []),
        { name: 'Refresh', value: 'refresh' }, { name: 'Back', value: 'back' },
      ]);
      if (action === 'back') return;
      if (action === 'swap' && comparison) {
        [a, b] = [b, a];
        comparison = { ...comparison, a: comparison.b, b: comparison.a,
          counts: comparison.counts.kind === 'available' ? { kind: 'available', value: { a: comparison.counts.value.b, b: comparison.counts.value.a } } : comparison.counts };
        terminal.write('\n' + renderComparison(comparison, style));
        continue;
      }
      if (action === 'refresh') { reload = true; continue; }
      try { terminal.write('\n' + renderComparisonDetail(comparison!, await operations.comparisonDetail(comparison!, action as ComparisonView), style)); }
      catch (error) {
        if (signal?.aborted) return;
        terminal.write(style.warning(safeText(error instanceof Error ? error.message : String(error))) + '\n');
      }
      const next = await terminal.choose('Navigation', [{ name: 'Back to comparison', value: 'back' }, { name: 'Refresh comparison', value: 'refresh' }]);
      reload = next === 'refresh';
    }
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  }
}
