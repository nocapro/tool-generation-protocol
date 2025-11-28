import { z } from 'zod';
import { applyStandardDiff, applySearchReplace } from 'apply-multi-diff';
import { Kernel } from '../kernel/core.js';
import { AgentTool } from './types.js';

export const ListFilesParams = z.object({
  dir: z.string().describe('The relative directory path to list (e.g., "tools" or "tools/analytics")'),
});

export const ReadFileParams = z.object({
  path: z.string().describe('The relative path to the file to read'),
});

export const WriteFileParams = z.object({
  path: z.string().describe('The relative path where the file should be written'),
  content: z.string().describe('The full content of the file'),
});

export const ApplyDiffParams = z.object({
  path: z.string().describe('The relative path to the file to modify'),
  diff: z.string().describe('The patch content. Either a standard Unified Diff or a Search/Replace block (<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE).'),
  start_line: z.number().optional().describe('The 1-based line number to start searching from (for Search/Replace disambiguation).'),
  end_line: z.number().optional().describe('The 1-based line number to stop searching at (for Search/Replace disambiguation).'),
});

export function createFsTools(kernel: Kernel) {
  return {
    list_files: {
      description: 'Recursively list available tools or definitions in the VFS.',
      parameters: ListFilesParams,
      inputSchema: ListFilesParams,
      execute: async ({ dir }) => {
        return kernel.vfs.listFiles(dir, true);
      },
    } as AgentTool<typeof ListFilesParams, string[]>,

    read_file: {
      description: 'Read the content of an existing tool or file.',
      parameters: ReadFileParams,
      inputSchema: ReadFileParams,
      execute: async ({ path }) => {
        return kernel.vfs.readFile(path);
      },
    } as AgentTool<typeof ReadFileParams, string>,

    write_file: {
      description: 'Create a new tool or overwrite a draft. Ensures parent directories exist.',
      parameters: WriteFileParams,
      inputSchema: WriteFileParams,
      execute: async ({ path, content }) => {
        await kernel.vfs.writeFile(path, content);

        // Register the new tool in the Registry (updates meta.json)
        await kernel.registry.register(path, content);

        // Persist to Git (Tool + meta.json)
        await kernel.git.persist(`Forge: ${path}`, [path]);

        return { success: true, path, persisted: true };
      },
    } as AgentTool<typeof WriteFileParams, { success: boolean; path: string }>,

    apply_diff: {
      description: 'Apply a patch to a file using either Unified Diff format or Search/Replace blocks.',
      parameters: ApplyDiffParams,
      inputSchema: ApplyDiffParams,
      execute: async ({ path, diff, start_line, end_line }) => {
        const content = await kernel.vfs.readFile(path);
        
        let result;

        // Use Search-Replace strategy if the marker is present, otherwise fallback to Standard Diff
        if (diff.includes('<<<<<<< SEARCH')) {
          result = applySearchReplace(content, diff, { start_line, end_line });
        } else {
          result = applyStandardDiff(content, diff);
        }

        if (!result.success) {
          throw new Error(`Failed to apply diff to '${path}': ${result.error?.message ?? 'Unknown error'}`);
        }

        const newContent = result.content;
        await kernel.vfs.writeFile(path, newContent);

        // Update registry in case descriptions changed
        await kernel.registry.register(path, newContent);

        await kernel.git.persist(`Refactor: ${path}`, [path]);

        return { success: true, path, persisted: true };
      },
    } as AgentTool<typeof ApplyDiffParams, { success: boolean; path: string }>,
  };
}