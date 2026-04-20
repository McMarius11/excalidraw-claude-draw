export type DslValue = string | number | boolean | DslValue[];

export interface DslNode {
  type: string;
  attrs: Record<string, DslValue>;
  body?: string;
  children?: DslNode[];
}

export class DslParseError extends Error {
  line: number;
  col: number;
  constructor(message: string, line: number, col: number) {
    super(`[${line}:${col}] ${message}`);
    this.name = 'DslParseError';
    this.line = line;
    this.col = col;
  }
}
