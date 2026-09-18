/** A small, fixed vocabulary for terminal emphasis. Callers escape Git text first. */
export function createStyle(enabled: boolean) {
  const wrap = (open: number, close: number) => (text: string) =>
    enabled && text ? `\x1b[${open}m${text}\x1b[${close}m` : text;
  const bold = wrap(1, 22);
  const cyan = wrap(36, 39);
  return {
    heading: bold,
    branch: (text: string) => bold(cyan(text)),
    ref: cyan,
    subject: bold,
    author: wrap(35, 39),
    hash: wrap(33, 39),
    muted: wrap(2, 22),
    good: wrap(32, 39),
    warning: wrap(33, 39),
    error: wrap(31, 39),
    selection: (text: string) => bold(cyan(text)),
  };
}

export type Style = ReturnType<typeof createStyle>;
export const plain = createStyle(false);

/** Redirection and NO_COLOR take precedence, including over inherited FORCE_COLOR. */
export function outputStyle(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv = process.env): Style {
  return createStyle(Boolean(stream.isTTY) && env.TERM !== 'dumb' && !env.NO_COLOR && env.FORCE_COLOR !== '0');
}
