import { RepositoryError } from '../core/types.js';
import type { CommitSummary } from '../core/types.js';

export const branchFormat = '%(refname)%00%(objectname)%00%(parent)%00%(authorname)%00%(committerdate:iso-strict)%00%(subject)%00%(upstream)%00%(upstream:remotename)%00';

export function parseBranches(data: Buffer): { ref: string; tip: CommitSummary; upstream: string; remote: string }[] {
  if (!data.length) return [];
  const fields = data.toString('utf8').split('\0');
  if (fields.pop() !== '\n' || fields.length % 8 !== 0) throw new RepositoryError('Git returned malformed branch records.');
  const rows = [];
  for (let index = 0; index < fields.length; index += 8) {
    const [rawRef, oid, parents, author, committedAt, subject, upstream, remote] = fields.slice(index, index + 8);
    const ref = rawRef!.replace(/^\n/, '');
    if (!ref.startsWith('refs/heads/') || !oid || !/^[0-9a-f]+$/.test(oid)
      || parents === undefined || (parents && !/^[0-9a-f]+(?: [0-9a-f]+)*$/.test(parents))
      || !committedAt || !Number.isFinite(Date.parse(committedAt)) || remote === undefined) {
      throw new RepositoryError('Git returned malformed branch metadata.');
    }
    rows.push({ ref, tip: { oid, parents: parents ? parents.split(' ') : [], author: author!, committedAt, subject: subject! }, upstream: upstream!, remote });
  }
  return rows;
}
