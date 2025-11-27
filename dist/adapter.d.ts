import { ToolSet } from './tools/types.js';
/**
 * Converts a TGP ToolSet into a format compatible with the Vercel AI SDK (Core).
 *
 * @param tools The TGP ToolSet (from tgpTools(kernel))
 * @returns An object compatible with the `tools` parameter of `generateText`
 */
export declare function formatTools(tools: ToolSet): ToolSet;
/**
 * Converts a TGP ToolSet into the standard OpenAI "functions" or "tools" JSON format.
 * Useful if using the raw OpenAI SDK.
 */
export declare function toOpenAITools(tools: ToolSet): {
    type: string;
    function: {
        name: string;
        description: string;
        parameters: import("zod-to-json-schema").JsonSchema7Type & {
            $schema?: string | undefined;
            definitions?: {
                [key: string]: import("zod-to-json-schema").JsonSchema7Type;
            } | undefined;
        };
    };
}[];
