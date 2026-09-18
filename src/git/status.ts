import { RepositoryError } from '../core/types.js';
import type { Change, Head } from '../core/types.js';

function invalid(): never { throw new RepositoryError('Git returned malformed porcelain-v2 status data.'); }

/** Split metadata by ASCII space, leaving the pathname byte-for-byte intact. */
function fields(record: Buffer, count: number): { meta: string[]; path: Buffer } {
  let start = 0;
  const meta: string[] = [];
  for (let i = 0; i < count; i++) {
    const end = record.indexOf(32, start);
    if (end < 0) invalid();
    meta.push(record.subarray(start, end).toString('ascii'));
    start = end + 1;
  }
  const path = record.subarray(start);
  if (!path.length) invalid();
  return { meta, path: Buffer.from(path) };
}

export function parseStatus(data: Buffer): { head: Head; upstream?: string; changes: Change[] } {
  const records: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) { records.push(data.subarray(start, i)); start = i + 1; }
  }
  if (start !== data.length) invalid();
  let name: string | undefined;
  let oid: string | undefined;
  let upstream: string | undefined;
  const changes: Change[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record[0] === 35) {
      const header = record.toString('utf8');
      if (header.startsWith('# branch.head ')) name = header.slice(14);
      if (header.startsWith('# branch.oid ')) oid = header.slice(13);
      if (header.startsWith('# branch.upstream ')) upstream = header.slice(18);
      continue; // Porcelain v2 permits new headers.
    }
    const kind = String.fromCharCode(record[0] ?? 0);
    if (kind === '?') {
      const { path } = fields(record, 1);
      changes.push({ kind: 'untracked', path, index: '?', worktree: '?' });
      continue;
    }
    if (!['1', '2', 'u'].includes(kind)) invalid();
    const { meta, path } = fields(record, kind === '1' ? 8 : kind === '2' ? 9 : 10);
    const xy = meta[1]!;
    if (!/^[.MADRCUT?!]{2}$/.test(xy)) invalid();
    const change: Change = {
      kind: kind === 'u' ? 'conflict' : kind === '2' ? 'renamed' : 'tracked',
      path, index: xy[0]!, worktree: xy[1]!, submodule: meta[2]!,
    };
    if (kind === '2') {
      const original = records[++i];
      if (!original?.length) invalid();
      change.originalPath = Buffer.from(original);
    }
    changes.push(change);
  }
  if (!name || !oid) invalid();
  let head: Head;
  if (oid === '(initial)' && name !== '(detached)') head = { kind: 'unborn', name };
  else if (!/^[0-9a-f]+$/.test(oid)) invalid();
  else if (name === '(detached)') head = { kind: 'detached', oid };
  else head = { kind: 'branch', name, oid };
  return { head, changes, ...(upstream ? { upstream } : {}) };
}
