export { parseDsl } from './dsl/parser.ts';
export type { DslNode, DslValue } from './dsl/types.ts';
export { DslParseError } from './dsl/types.ts';

export {
  compile,
  compileFromSource,
  builtinComponents,
  DEFAULT_ROOT_BOX,
} from './dsl/compiler.ts';
export type { Handler, CompileOptions } from './dsl/compiler.ts';

export { shrink, splitMain } from './dsl/layout.ts';
export type { Box } from './dsl/layout.ts';

export { rect, ellipse, txt, arrow, resetIds } from './dsl/primitives.ts';

export {
  generateScene,
  checkServerHealth,
  summarizeUsage,
  SceneClientError,
  DEFAULT_API_URL,
  DEFAULT_HEALTH_URL,
} from './dsl/client.ts';
export type {
  GenerateSceneOptions,
  GenerateSceneResult,
  UsageSummary,
  SceneClientErrorKind,
} from './dsl/client.ts';

export { COMPONENT_CATALOG } from './dsl/catalog.ts';

export { callClaude, ClaudeShimError } from './server/shim.ts';
export type { CallClaudeOptions, ClaudeResult } from './server/shim.ts';
