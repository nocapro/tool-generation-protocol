/* eslint-disable no-console */
import { Kernel } from '../kernel/core.js';
import { DBBackend } from '../kernel/db.js';

/**
 * Creates the Bridge Object exposed to the Sandbox.
 * This maps secure Kernel methods to the Guest environment.
 * 
 * We expose a structured 'tgp' object to the guest.
 */
export function createSandboxBridge(kernel: Kernel, db: DBBackend) {
  const { vfs } = kernel;

  return {
    tgp: {
      // --- Filesystem Bridge (Jailed) ---
      read_file: async (path: string) => {
        return vfs.readFile(path);
      },

      write_file: async (path: string, content: string) => {
        return vfs.writeFile(path, content);
      },

      list_files: async (dir: string) => {
        return vfs.listFiles(dir, false);
      },

      // --- Network Bridge (Allowed Only) ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: async (url: string, init?: any) => {
        // Security: Parse URL and allow-list check could happen here
        const response = await fetch(url, init);
        const text = await response.text();
        return {
          status: response.status,
          text: () => text,
          json: () => JSON.parse(text),
        };
      },

      // --- Logger ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: (...args: any[]) => {
        console.log('[TGP-TOOL]', ...args);
      },

      // --- Database (Transactional) ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db_query: async (sql: string, params: any[] = []) => {
        return db.query(sql, params);
      }
    }
  };
}