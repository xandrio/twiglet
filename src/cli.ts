import { readOverview } from './core/repository.js';
import { readRecentCommits } from './core/history.js';
import { createTerminal } from './terminal/prompt.js';
import { interactiveSession, isCancellation } from './terminal/session.js';
import { renderHistory, renderOverview, safeText } from './terminal/render.js';

const help = `Twiglet 0.2.0 - a small Git repository companion

Usage: tl [--repo <directory>] [status]
       tl [--repo <directory>] log [--limit N]
       tl --help
       tl --version

Run tl in a terminal for Repository overview or Recent commits, with Refresh/Back.
Without an interactive terminal, print the overview and exit.
status always prints the overview. --repo defaults to the current directory.
log prints history reachable from HEAD, including merges (default 20, limit 1-100).
Unavailable upstream comparison does not fail an otherwise useful overview.
Requires Node 22+ and installed Git. No fetch or repository changes.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let directory = process.cwd();
  let command: 'status' | 'log' | undefined;
  let limit: number | undefined;
  let information: 'help' | 'version' | undefined;
  let repoSet = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--repo' && !repoSet) {
      if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('--repo requires a directory.');
      directory = args[++i]!;
      repoSet = true;
    } else if ((arg === 'status' || arg === 'log') && !command) command = arg;
    else if (arg === '--limit' && limit === undefined) {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error('--limit requires an integer from 1 to 100.');
      limit = Number(value);
    }
    else if (arg === '--help' || arg === '-h') information = 'help';
    else if (arg === '--version') information = 'version';
    else throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
  }
  if (information) { process.stdout.write(information === 'help' ? help : '0.2.0\n'); return; }
  if (limit !== undefined && command !== 'log') throw new Error('--limit is only supported with log.');
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const wasRaw = process.stdin.isRaw ?? false;
  try {
    const operations = {
      overview: () => readOverview(directory, abort.signal),
      history: () => readRecentCommits(directory, limit ?? 20, abort.signal),
    };
    if (command === 'log') {
      process.stdout.write(renderHistory(await operations.history()));
    } else if (command === 'status' || !process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === 'dumb') {
      process.stdout.write(renderOverview(await operations.overview()));
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
  process.stderr.write(`Twiglet: ${safeText(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
