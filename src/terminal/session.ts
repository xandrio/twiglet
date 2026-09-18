import type { Overview, RecentCommits } from '../core/types.js';
import { renderHistory, renderOverview, safeText } from './render.js';

export interface Choice { name: string; value: string }
export interface Terminal {
  choose(message: string, choices: Choice[], defaultValue?: string): Promise<string>;
  write(text: string): void;
}

export function isCancellation(error: unknown): boolean {
  return error instanceof Error && ['ExitPromptError', 'AbortPromptError', 'CancelPromptError'].includes(error.name);
}

export interface RepositoryOperations {
  overview(): Promise<Overview>;
  history(): Promise<RecentCommits>;
}

export async function interactiveSession(terminal: Terminal, operations: RepositoryOperations, signal?: AbortSignal): Promise<void> {
  let selected = 'overview';
  while (!signal?.aborted) {
    const action = await terminal.choose('Twiglet', [
      { name: 'Repository overview', value: 'overview' },
      { name: 'Recent commits', value: 'history' }, { name: 'Exit', value: 'exit' },
    ], selected);
    if (action === 'exit') return;
    selected = action;
    let navigation = 'refresh';
    while (navigation === 'refresh' && !signal?.aborted) {
      terminal.write('\nInspecting repository...\n');
      try {
        terminal.write('\n' + (action === 'history' ? renderHistory(await operations.history()) : renderOverview(await operations.overview())));
      } catch (error) {
        if (signal?.aborted) return;
        terminal.write(`\nUnable to inspect repository: ${safeText(error instanceof Error ? error.message : String(error))}\n`);
      }
      if (signal?.aborted) return;
      navigation = await terminal.choose('Navigation', [{ name: 'Back', value: 'back' }, { name: 'Refresh', value: 'refresh' }]);
    }
  }
}
