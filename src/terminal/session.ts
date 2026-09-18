import type { Overview } from '../core/types.js';
import { renderOverview, safeText } from './render.js';

export interface Choice { name: string; value: string }
export interface Terminal {
  choose(message: string, choices: Choice[]): Promise<string>;
  write(text: string): void;
}

export function isCancellation(error: unknown): boolean {
  return error instanceof Error && ['ExitPromptError', 'AbortPromptError', 'CancelPromptError'].includes(error.name);
}

export async function interactiveSession(terminal: Terminal, inspect: () => Promise<Overview>, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    const action = await terminal.choose('Twiglet', [
      { name: 'Repository overview', value: 'overview' }, { name: 'Exit', value: 'exit' },
    ]);
    if (action === 'exit') return;
    terminal.write('\nInspecting repository...\n');
    try { terminal.write('\n' + renderOverview(await inspect())); }
    catch (error) {
      if (signal?.aborted) return;
      terminal.write(`\nUnable to inspect repository: ${safeText(error instanceof Error ? error.message : String(error))}\n`);
    }
    if (signal?.aborted) return;
    await terminal.choose('Navigation', [{ name: 'Back', value: 'back' }]);
  }
}
