/* eslint-disable no-console */
import { VFSAdapter } from '../vfs/types.js';
import { RegistryState, ToolMetadata } from '../types.js';
import * as path from 'path';

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
    
    // Simple JSDoc Regex: /** ... */
    const jsDocMatch = code.match(/\/\*\*([\s\S]*?)\*\//);
    let description = "No description provided.";
    
    if (jsDocMatch) {
      const content = jsDocMatch[1];
      // Clean up stars and whitespace
      description = content
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trim())
        .filter(line => !line.startsWith('@') && line.length > 0) // Remove param tags and empty lines
        .join(' ');
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
      
      // We don't sync on every register to avoid IO storm if called in loop, 
      // but for write_file it is fine.
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