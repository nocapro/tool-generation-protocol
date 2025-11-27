import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { VFSAdapter } from './types.js';

/**
 * Creates a VFS adapter backed by the physical disk.
 * Used for standard Node.js deployments and CLI tools.
 * 
 * @param rootDir The absolute or relative path to the sandbox root (e.g., ./.tgp)
 */
export function createNodeVFS(rootDir: string): VFSAdapter {
  const absoluteRoot = path.resolve(rootDir);

  // Security: Ensure the target path is inside the rootDir
  const resolvePath = (target: string): string => {
    // Normalize and resolve against root
    const resolved = path.resolve(absoluteRoot, target);
    
    // Guard: Path Traversal Attack
    if (!resolved.startsWith(absoluteRoot)) {
      throw new Error(`Security Violation: Path '${target}' is outside the sandbox root.`);
    }
    return resolved;
  };

  return {
    async readFile(target: string): Promise<string> {
      const fullPath = resolvePath(target);
      return fs.readFile(fullPath, 'utf-8');
    },

    readSync(target: string): string {
      const fullPath = resolvePath(target);
      return readFileSync(fullPath, 'utf-8');
    },

    async writeFile(target: string, content: string): Promise<void> {
      const fullPath = resolvePath(target);
      const dir = path.dirname(fullPath);
      
      // Ensure directory exists (mkdir -p)
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
    },

    async remove(target: string): Promise<void> {
      const fullPath = resolvePath(target);
      // Silent failure if not exists, matching standard rm -f behavior
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await fs.rm(fullPath, { force: true }).catch(() => {}); 
    },

    async exists(target: string): Promise<boolean> {
      const fullPath = resolvePath(target);
      try {
        await fs.access(fullPath);
        return true;
      } catch {
        return false;
      }
    },

    async listFiles(dir: string, recursive: boolean = false): Promise<string[]> {
      const fullDir = resolvePath(dir);
      
      try {
        await fs.access(fullDir);
      } catch {
        return []; // Return empty if dir doesn't exist
      }

      const results: string[] = [];

      async function walk(currentDir: string, relativeBase: string) {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = path.join(currentDir, entry.name);
          const relativePath = path.join(relativeBase, entry.name);

          if (entry.isDirectory()) {
            if (recursive) {
              await walk(entryPath, relativePath);
            }
          } else {
            results.push(relativePath);
          }
        }
      }

      await walk(fullDir, dir);
      return results;
    }
  };
}