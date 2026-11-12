export interface ToolDescriptor { name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false }; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean } }
export const MCP_INSTRUCTIONS: string;
export const WRITE_TOOL_ACTIONS: Record<string, string>;
export const MAX_WRITE_ACTIONS: number;
export const MAX_BATCH_TEXT: number;
export function toolCatalog(): ToolDescriptor[];
export function validateToolArguments(name: string, raw: unknown): Record<string, unknown>;
export function toolResult(value: unknown): { isError?: boolean; content: { type: 'text'; text: string }[] };
