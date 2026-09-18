import select from '@inquirer/select';
import type { Terminal } from './session.js';
import { outputStyle } from './style.js';

export function createTerminal(signal: AbortSignal): Terminal {
  const style = outputStyle(process.stdout);
  return {
    style,
    write: (text) => { process.stdout.write(text); },
    choose: (message, choices, defaultValue) => select({
      message, choices, loop: false,
      ...(defaultValue ? { default: defaultValue } : {}),
      // Keep choice names plain for Inquirer's prefix matching; emphasize the
      // active row at render time rather than injecting ANSI into searchable data.
      theme: { prefix: '?', icon: { cursor: '>' }, style: {
        message: style.heading, answer: style.ref, highlight: style.selection,
        error: style.error, help: style.muted, description: style.muted,
        keysHelpTip: (keys: [string, string][]) => keys.map(([key, action]) => `${style.heading(key)} ${style.muted(action)}`).join(' • '),
      } },
    }, { signal }),
  };
}
