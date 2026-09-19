import type { BranchDetails, BranchList, Overview, RecentCommits } from '../core/types.js';
import { branchChoice, renderBranchContext, renderBranchDetails } from './branches.js';
import { renderHistory, renderOverview, safeText } from './render.js';
import { plain } from './style.js';
import type { Style } from './style.js';
import type { Comparison, ComparisonDetail, ComparisonView } from '../core/comparison.js';
import type { FilePatch } from '../core/changes.js';
import { comparisonSession } from './comparison.js';

export interface Choice { name: string; value: string; short?: string }
export interface Terminal {
  style?: Style;
  choose(message: string, choices: Choice[], defaultValue?: string): Promise<string>;
  write(text: string): void;
}

export function isCancellation(error: unknown): boolean {
  return error instanceof Error && ['ExitPromptError', 'AbortPromptError', 'CancelPromptError'].includes(error.name);
}

export interface RepositoryOperations {
  overview(): Promise<Overview>;
  history(): Promise<RecentCommits>;
  branches(): Promise<BranchList>;
  branch(name: string): Promise<BranchDetails>;
  compare(a: string, b: string): Promise<Comparison>;
  comparisonPatch(comparison: Comparison, view: 'tips' | 'since-base', path: Buffer): Promise<FilePatch>;
  comparisonDetail(comparison: Comparison, view: ComparisonView): Promise<ComparisonDetail>;
}

async function branchSession(terminal: Terminal, operations: RepositoryOperations, signal?: AbortSignal): Promise<void> {
  const style = terminal.style ?? plain;
  let selected: string | undefined;
  while (!signal?.aborted) {
    let list: BranchList;
    try {
      list = await operations.branches();
      terminal.write('\n' + renderBranchContext(list, style));
    } catch (error) {
      if (signal?.aborted) return;
      terminal.write('\n' + style.error(`Unable to list branches: ${safeText(error instanceof Error ? error.message : String(error))}`) + '\n');
      if (await terminal.choose('Navigation', [{ name: 'Back', value: 'back' }, { name: 'Refresh', value: 'refresh' }]) === 'back') return;
      continue;
    }
    const choices = [{ name: 'Back', value: 'back' }, { name: 'Refresh', value: 'refresh' }, ...list.branches.map((branch) => ({ name: branchChoice(branch), short: safeText(branch.name), value: branch.ref }))];
    if (!list.branches.length) terminal.write('No local branches.\n');
    const choice = await terminal.choose('Local branches', choices, list.branches.some((b) => b.ref === selected) ? selected : list.branches[0]?.ref ?? 'back');
    if (choice === 'back') return;
    if (choice === 'refresh') continue;
    selected = choice;
    const branch = list.branches.find((b) => b.ref === choice)!;
    let action = 'refresh';
    while (action === 'refresh' && !signal?.aborted) {
      terminal.write('\n' + style.muted('Inspecting branch...') + '\n');
      try { terminal.write(renderBranchDetails(await operations.branch(branch.name), style)); }
      catch (error) {
        if (signal?.aborted) return;
        terminal.write(style.error(`Unable to inspect branch: ${safeText(error instanceof Error ? error.message : String(error))}`) + '\n');
      }
      if (signal?.aborted) return;
      action = await terminal.choose('Navigation', [{ name: 'Back', value: 'back' }, { name: 'Refresh', value: 'refresh' }, { name: 'Compare with another branch…', value: 'compare' }]);
      if (action === 'compare') {
        try { await comparisonSession(terminal, operations, branch.name, signal); }
        catch (error) {
          if (isCancellation(error)) throw error;
          if (signal?.aborted) return;
          terminal.write(style.error(safeText(error instanceof Error ? error.message : String(error))) + '\n');
        }
        action = 'refresh';
      }
    }
  }
}

export async function interactiveSession(terminal: Terminal, operations: RepositoryOperations, signal?: AbortSignal): Promise<void> {
  const style = terminal.style ?? plain;
  let selected = 'overview';
  while (!signal?.aborted) {
    const action = await terminal.choose('Twiglet', [
      { name: 'Repository overview', value: 'overview' },
      { name: 'Recent commits', value: 'history' }, { name: 'Local branches', value: 'branches' }, { name: 'Exit', value: 'exit' },
    ], selected);
    if (action === 'exit') return;
    selected = action;
    if (action === 'branches') { await branchSession(terminal, operations, signal); continue; }
    let navigation = 'refresh';
    while (navigation === 'refresh' && !signal?.aborted) {
      terminal.write('\n' + style.muted('Inspecting repository...') + '\n');
      try {
        terminal.write('\n' + (action === 'history' ? renderHistory(await operations.history(), style) : renderOverview(await operations.overview(), style)));
      } catch (error) {
        if (signal?.aborted) return;
        terminal.write('\n' + style.error(`Unable to inspect repository: ${safeText(error instanceof Error ? error.message : String(error))}`) + '\n');
      }
      if (signal?.aborted) return;
      navigation = await terminal.choose('Navigation', [{ name: 'Back', value: 'back' }, { name: 'Refresh', value: 'refresh' }]);
    }
  }
}
