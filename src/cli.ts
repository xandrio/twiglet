import { readOverview } from './core/repository.js';
import { readRecentCommits } from './core/history.js';
import { listLocalBranches, readBranchDetails } from './core/branches.js';
import { renderBranches, renderBranchDetails } from './terminal/branches.js';
import { createTerminal } from './terminal/prompt.js';
import { interactiveSession, isCancellation } from './terminal/session.js';
import { renderHistory, renderOverview, safeText } from './terminal/render.js';
import { outputStyle } from './terminal/style.js';
import { readComparison, readComparisonDetail } from './core/comparison.js';
import type { Comparison, ComparisonView } from './core/comparison.js';
import { renderComparison, renderComparisonDetail } from './terminal/comparison.js';

const help = `Twiglet 0.4.0 - a small Git repository companion

Usage: tl [--repo <directory>] [status]
       tl [--repo <directory>] log [--limit N]
       tl [--repo <directory>] branches
       tl [--repo <directory>] branch <name>
       tl [--repo <directory>] compare <A> <B> [--view commits-a|commits-b|tips|since-base]
       tl --help
       tl --version

Run tl in a terminal for Repository overview, Recent commits, or Local branches.
Without an interactive terminal, print the overview and exit.
status always prints the overview. --repo defaults to the current directory.
log prints history reachable from HEAD, including merges (default 20, limit 1-100).
branches lists local branches. branch inspects one exact local name without checkout.
compare prints a summary. A is the reference, B the inspected local branch.
tips compares A tip to B tip; since-base compares their single merge base to B.
Unavailable upstream comparison does not fail an otherwise useful overview.
Requires Node 22+ and installed Git. No fetch or repository changes.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let directory = process.cwd();
  let command: 'status' | 'log' | 'branches' | 'branch' | 'compare' | undefined;
  let comparisonNames: [string, string] | undefined;
  let view: ComparisonView | undefined;
  let branchName: string | undefined;
  let limit: number | undefined;
  let information: 'help' | 'version' | undefined;
  let repoSet = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--repo' && !repoSet) {
      if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('--repo requires a directory.');
      directory = args[++i]!;
      repoSet = true;
    } else if ((arg === 'status' || arg === 'log' || arg === 'branches' || arg === 'branch' || arg === 'compare') && !command) {
      command = arg;
      if (arg === 'branch') {
        branchName = args[++i];
        if (!branchName) throw new Error('branch requires a local branch name.');
      }
      if (arg === 'compare') {
        const a = args[++i];
        const b = args[++i];
        if (!a || !b) throw new Error('compare requires two local branch names: A B.');
        comparisonNames = [a, b];
      }
    }
    else if (arg === '--view' && view === undefined) {
      const value = args[++i];
      if (!value || !['commits-a', 'commits-b', 'tips', 'since-base'].includes(value)) throw new Error('--view requires commits-a, commits-b, tips, or since-base.');
      view = value as ComparisonView;
    }
    else if (arg === '--limit' && limit === undefined) {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error('--limit requires an integer from 1 to 100.');
      limit = Number(value);
    }
    else if (arg === '--help' || arg === '-h') information = 'help';
    else if (arg === '--version') information = 'version';
    else throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
  }
  if (information) { process.stdout.write(information === 'help' ? help : '0.4.0\n'); return; }
  if (limit !== undefined && command !== 'log') throw new Error('--limit is only supported with log.');
  if (view !== undefined && command !== 'compare') throw new Error('--view is only supported with compare.');
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const wasRaw = process.stdin.isRaw ?? false;
  const style = outputStyle(process.stdout);
  try {
    const operations = {
      overview: () => readOverview(directory, abort.signal),
      history: () => readRecentCommits(directory, limit ?? 20, abort.signal),
      branches: () => listLocalBranches(directory, abort.signal),
      branch: (name: string) => readBranchDetails(directory, name, abort.signal),
      compare: (a: string, b: string) => readComparison(directory, a, b, abort.signal),
      comparisonDetail: (comparison: Comparison, view: ComparisonView) => readComparisonDetail(comparison, view, abort.signal),
    };
    if (command === 'compare') {
      const comparison = await operations.compare(...comparisonNames!);
      process.stdout.write(view ? renderComparisonDetail(comparison, await operations.comparisonDetail(comparison, view), style) : renderComparison(comparison, style));
    } else if (command === 'branches') {
      process.stdout.write(renderBranches(await operations.branches(), style));
    } else if (command === 'branch') {
      process.stdout.write(renderBranchDetails(await operations.branch(branchName!), style));
    } else if (command === 'log') {
      process.stdout.write(renderHistory(await operations.history(), style));
    } else if (command === 'status' || !process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === 'dumb') {
      process.stdout.write(renderOverview(await operations.overview(), style));
    } else {
      await interactiveSession(createTerminal(abort.signal), operations, abort.signal);
    }
    if (abort.signal.aborted) process.exitCode = 130;
  } catch (error) {
    if (!abort.signal.aborted && !isCancellation(error)) throw error;
    process.exitCode = 130;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(outputStyle(process.stderr).error(`Twiglet: ${safeText(error instanceof Error ? error.message : String(error))}`) + '\n');
  process.exitCode = 1;
});
