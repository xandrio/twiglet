import select from '@inquirer/select';
import type { Terminal } from './session.js';

export function createTerminal(signal: AbortSignal): Terminal {
  return {
    write: (text) => { process.stdout.write(text); },
    choose: (message, choices) => select({
      message, choices, loop: false,
      theme: { prefix: '?', icon: { cursor: '>' } },
    }, { signal }),
  };
}
