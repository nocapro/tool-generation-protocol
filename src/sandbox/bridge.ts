import { Kernel } from '../kernel/core.js';
import { DBBackend } from '../kernel/db.js';

/**
 * Creates the Bridge Object exposed to the Sandbox.
 * This maps secure Kernel methods to the Guest environment.
 * 
 * NOTE: When passing functions to isolated-vm, arguments and return values 
 * must be serializable or wrapped in References.
 */
export function createSandboxBridge(kernel: Kernel, db: DBBackend) {
  const { vfs } = kernel;

  return {
    // --- Filesystem Bridge (Jailed) ---
    // The Guest sees these as async functions on the global scope or a 'tgp' object.
    
    // tgp_read_file('./data.txt')
    tgp_read_file: async (path: string) => {
      // VFS already enforces jail path traversal checks
      return vfs.readFile(path);
    },

    // tgp_write_file('./output.txt', 'content')
    tgp_write_file: async (path: string, content: string) => {
      return vfs.writeFile(path, content);
    },

    // tgp_list_files('./tools')
    tgp_list_files: async (dir: string) => {
      return vfs.listFiles(dir, false);
    },

    // --- Network Bridge (Allowed Only) ---
    // We can inject a restricted fetch here.
    tgp_fetch: async (url: string, init?: any) => {
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
    tgp_log: (...args: any[]) => {
      console.log('[TGP-TOOL]', ...args);
    },

    // --- Database (Transactional) ---
    tgp_db_query: async (sql: string, params: any[] = []) => {
      return db.query(sql, params);
    }
  };
}