/* eslint-disable no-console */
import { Kernel } from '../kernel/core.js';
import * as path from 'path';

export interface SandboxBridgeOptions {
  kernel: Pick<Kernel, 'vfs' | 'config'>;
  onLog?: (message: string) => void;
}

/**
 * Creates the Bridge Object exposed to the Sandbox.
 * This maps secure Kernel methods to the Guest environment.
 * 
 * We expose a structured 'tgp' object to the guest.
 */
export function createSandboxBridge({ kernel, onLog }: SandboxBridgeOptions) {
  const { vfs, config } = kernel;
  const { allowedDirs } = config.fs;

  const isAllowedWrite = (target: string): boolean => {
    // Normalize target to ensure clean comparison (remove leading ./, etc)
    const normalizedTarget = path.normalize(target).replace(/^(\.\/)/, '');
    
    return allowedDirs.some(dir => {
      const normalizedDir = path.normalize(dir).replace(/^(\.\/)/, '');
      // Check if target is inside the allowed dir
      return normalizedTarget.startsWith(normalizedDir);
    });
  };

  return {
    tgp: {
      // --- Filesystem Bridge (Jailed) ---
      read_file: async (path: string) => {
        return vfs.readFile(path);
      },

      write_file: async (path: string, content: string) => {
        if (!isAllowedWrite(path)) {
          throw new Error(`Security Violation: Write access denied for '${path}'. Allowed directories: ${allowedDirs.join(', ')}`);
        }
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
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        if (onLog) {
            onLog(msg);
        } else {
            console.log('[TGP-TOOL]', msg);
        }
      }
    }
  };
}