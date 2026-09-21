import { inspect } from 'node:util';

/** Prevent accidental display; this is not a secure-memory or erasure facility. */
export class Secret {
  #value: string;
  constructor(value: string) { this.#value = value; }
  reveal(): string { return this.#value; }
  toString(): string { return '[redacted]'; }
  toJSON(): string { return '[redacted]'; }
  [inspect.custom](): string { return '[redacted]'; }
}
