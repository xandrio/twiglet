export type Head =
  | { kind: 'branch'; name: string; oid: string }
  | { kind: 'unborn'; name: string }
  | { kind: 'detached'; oid: string };

export interface Change {
  kind: 'tracked' | 'renamed' | 'conflict' | 'untracked';
  /** Git path bytes, relative to the worktree root. Decode only for display. */
  path: Buffer;
  originalPath?: Buffer;
  index: string;
  worktree: string;
  submodule?: string;
}

export interface Overview {
  root: string;
  head: Head;
  upstream?: string;
  changes: Change[];
  shallow: boolean;
  filtersDisabled: boolean;
}

export class RepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RepositoryError';
  }
}
