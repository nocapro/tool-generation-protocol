import { z } from 'zod';
import { Kernel } from '../kernel/core.js';
import { AgentTool } from './types.js';
export declare const ListFilesParams: z.ZodObject<{
    dir: z.ZodString;
}, "strip", z.ZodTypeAny, {
    dir: string;
}, {
    dir: string;
}>;
export declare const ReadFileParams: z.ZodObject<{
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
}, {
    path: string;
}>;
export declare const WriteFileParams: z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    content: string;
}, {
    path: string;
    content: string;
}>;
export declare const PatchFileParams: z.ZodObject<{
    path: z.ZodString;
    search: z.ZodString;
    replace: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    search: string;
    replace: string;
}, {
    path: string;
    search: string;
    replace: string;
}>;
export declare function createFsTools(kernel: Kernel): {
    list_files: AgentTool<typeof ListFilesParams, string[]>;
    read_file: AgentTool<typeof ReadFileParams, string>;
    write_file: AgentTool<typeof WriteFileParams, {
        success: boolean;
        path: string;
    }>;
    patch_file: AgentTool<typeof PatchFileParams, {
        success: boolean;
        path: string;
    }>;
};
