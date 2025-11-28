/* eslint-disable no-console */
import { VFSAdapter } from '../vfs/types.js';
import { RegistryState, ToolMetadata } from '../types.js';
import * as path from 'path';
import * as ts from 'typescript';

export interface Registry {
  hydrate(): Promise<void>;
  register(filePath: string, code: string): Promise<void>;
  list(): ToolMetadata[];
  sync(): Promise<void>;
}

export function createRegistry(vfs: VFSAdapter): Registry {
  let state: RegistryState = { tools: {} };
  const META_PATH = 'meta.json';

  // Helper to parse JSDoc
  function extractMetadata(filePath: string, code: string): ToolMetadata {
    const name = path.basename(filePath, path.extname(filePath));
    let description = "No description provided.";

    try {
      // Use TypeScript AST to safely locate comments (avoids matching inside strings/templates)
      const sourceFile = ts.createSourceFile(
        filePath,
        code,
        ts.ScriptTarget.ES2020,
        true
      );

      const cleanJSDoc = (comment: string) => {
        return comment
          .replace(/^\/\*\*/, '')
          .replace(/\*\/$/, '')
          .split('\n')
          .map(line => line.replace(/^\s*\*\s?/, '').trim())
          .filter(line => !line.startsWith('@') && line.length > 0)
          .join(' ');
      };

      const findComment = (pos: number) => {
        const ranges = ts.getLeadingCommentRanges(code, pos);
        if (ranges?.length) {
          const range = ranges[ranges.length - 1]; // Closest to the node
          if (range.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
            const text = code.substring(range.pos, range.end);
            if (text.startsWith('/**')) return cleanJSDoc(text);
          }
        }
        return null;
      };

      // 1. Try attached to first statement (e.g. export const...)
      if (sourceFile.statements.length > 0) {
        const extracted = findComment(sourceFile.statements[0].getFullStart());
        if (extracted) description = extracted;
      }
      
      // 2. Fallback: Try top of file (detached)
      if (description === "No description provided.") {
        const extracted = findComment(0);
        if (extracted) description = extracted;
      }

    } catch (err) {
      console.warn(`[TGP] Failed to parse AST for ${filePath}. Falling back to default.`, err);
    }

    return {
      name,
      description: description || "No description provided.",
      path: filePath
    };
  }

  return {
    async hydrate() {
      if (await vfs.exists(META_PATH)) {
        try {
          const content = await vfs.readFile(META_PATH);
          state = content.trim().length > 0 ? JSON.parse(content) : { tools: {} };
        } catch (err) {
          console.warn('[TGP] Failed to parse meta.json, starting fresh.', err);
          state = { tools: {} };
        }
      }
    },

    async register(filePath: string, code: string) {
      // Ignore non-tool files (e.g. config or hidden files)
      if (!filePath.startsWith('tools/') && !filePath.startsWith('tools\\')) return;

      const metadata = extractMetadata(filePath, code);
      state.tools[filePath] = metadata;
      
      // We sync immediately to ensure data integrity, prioritizing safety over raw IO performance
      // during tool creation.
      await this.sync();
    },

    list() {
      return Object.values(state.tools);
    },

    async sync() {
      await vfs.writeFile(META_PATH, JSON.stringify(state, null, 2));
    }
  };
}