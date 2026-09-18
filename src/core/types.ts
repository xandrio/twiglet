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

export interface UpstreamTarget {
  ref: string;
  source: 'local-branch' | 'remote-tracking';
}

export type Upstream =
  | { kind: 'none' }
  | { kind: 'compared'; target: UpstreamTarget; headOid: string; upstreamOid: string; ahead: number; behind: number }
  | { kind: 'unavailable'; reason: 'detached' | 'unborn' | 'missing-ref' | 'unresolved' | 'shallow' | 'changed-head' | 'error'; message: string; target?: UpstreamTarget; configured?: string };

export interface Overview {
  root: string;
  head: Head;
  upstream: Upstream;
  changes: Change[];
  shallow: boolean;
  filtersDisabled: boolean;
}

export interface CommitSummary {
  oid: string;
  parents: string[];
  subject: string;
  author: string;
  committedAt: string;
}

export interface RecentCommits {
  root: string;
  head: Head;
  commits: CommitSummary[];
  shallow: boolean;
  hasMore: boolean;
  limit: number;
}

export type Tracking =
  | { kind: 'none' }
  | { kind: 'configured'; target: UpstreamTarget; available: boolean }
  | { kind: 'unavailable'; message: string };

export interface LocalBranch {
  ref: string;
  name: string;
  current: boolean;
  tip: CommitSummary | null;
  tracking: Tracking;
}

export interface BranchList { root: string; head: Head; branches: LocalBranch[] }
export interface BranchDetails {
  root: string;
  branch: LocalBranch;
  shallow: boolean;
  upstream: Upstream;
  history: { kind: 'available'; commits: CommitSummary[]; hasMore: boolean }
    | { kind: 'unavailable'; message: string };
}

export class RepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RepositoryError';
  }
}
