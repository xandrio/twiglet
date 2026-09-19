import { RepositoryError } from '../core/types.js';

export interface FileChange {
  status: 'A' | 'M' | 'D' | 'R' | 'T';
  path: Buffer;
  originalPath?: Buffer;
  similarity?: number;
  submodule: boolean;
  beforeOid: string;
  afterOid: string;
  beforeMode: string;
  afterMode: string;
}

/** --raw -z keeps filenames unquoted, including non-UTF8 bytes. */
export function parseDiff(data: Buffer): FileChange[] {
  const fields: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < data.length; i++) if (data[i] === 0) { fields.push(data.subarray(start, i)); start = i + 1; }
  if (start !== data.length) throw new RepositoryError('Malformed Git file comparison.');
  const result: FileChange[] = [];
  for (let i = 0; i < fields.length;) {
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([AMDRT])(\d*)$/.exec(fields[i++]!.toString('ascii'));
    const path = fields[i++];
    if (!match || !path?.length) throw new RepositoryError('Malformed Git file comparison.');
    const status = match[5] as FileChange['status'];
    const entry: FileChange = { status, path, submodule: match[1] === '160000' || match[2] === '160000', beforeMode: match[1]!, afterMode: match[2]!, beforeOid: match[3]!, afterOid: match[4]! };
    if (status === 'R') {
      const destination = fields[i++];
      const similarity = Number(match[6]);
      if (!destination?.length || !match[6] || similarity > 100) throw new RepositoryError('Malformed Git rename.');
      entry.originalPath = path;
      entry.path = destination;
      entry.similarity = similarity;
    }
    result.push(entry);
  }
  return result;
}
