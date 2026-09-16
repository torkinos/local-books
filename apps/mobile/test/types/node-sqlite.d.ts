/**
 * Minimal typing for node:sqlite, used only by the test suite (Node 24 ships the
 * module; the app itself never imports it). Declared by hand instead of pulling in
 * @types/node so Node globals cannot leak into the React Native app's typecheck.
 */
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: ReadonlyArray<string | number | null>): unknown;
      all(...params: ReadonlyArray<string | number | null>): Array<Record<string, unknown>>;
    };
    close(): void;
  }
}

declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}
