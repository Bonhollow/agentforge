import type { UniversalSchema, SupportedTarget } from "../core/schema.js";

export interface Adapter {
  readonly name: string;
  readonly target: SupportedTarget;
  detect(cwd: string): boolean;
  read(cwd: string): UniversalSchema;
  write(schema: UniversalSchema, cwd: string): void;
}
