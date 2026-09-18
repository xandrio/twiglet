import { RepositoryError } from '../core/types.js';
import type { CommitSummary } from '../core/types.js';

export function parseHistory(data: Buffer): CommitSummary[] {
  if (!data.length) return [];
  const fields = data.toString('utf8').split('\0');
  if (fields.pop() !== '' || fields.length % 5 !== 0) throw new RepositoryError('Git returned malformed history data.');
  const commits: CommitSummary[] = [];
  for (let i = 0; i < fields.length; i += 5) {
    const [oid, parents, author, committedAt, subject] = fields.slice(i, i + 5) as [string, string, string, string, string];
    if (!/^[0-9a-f]+$/.test(oid) || (parents && !/^[0-9a-f]+(?: [0-9a-f]+)*$/.test(parents))
      || !/^\d{4}-\d{2}-\d{2}T/.test(committedAt) || !Number.isFinite(Date.parse(committedAt))) {
      throw new RepositoryError('Git returned malformed commit metadata.');
    }
    commits.push({ oid, parents: parents ? parents.split(' ') : [], author, committedAt, subject });
  }
  return commits;
}
