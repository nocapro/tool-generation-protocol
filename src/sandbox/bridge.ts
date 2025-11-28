/* eslint-disable no-console */
import { Kernel } from '../kernel/core.js';
import * as path from 'path';
import { TGPConfig } from '../types.js';

export interface SandboxBridgeOptions {
  kernel: {
    vfs: Kernel['vfs'];
    config: TGPConfig;
    sandboxAPI: Kernel['sandboxAPI'];
  };
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
  const { allowedFetchUrls } = config;

  const isAllowedWrite = (target: string): boolean => {
    // Normalize target to ensure clean comparison (remove leading ./, etc)
    const normalizedTarget = path.normalize(target).replace(/^(\.\/)/, '');

    return allowedDirs.some(dir => {
      const normalizedDir = path.normalize(dir).replace(/^(\.\/)/, '');
      // Check if target is inside the allowed dir
      return normalizedTarget.startsWith(normalizedDir);
    });
  };

  // Build the tgp bridge object with explicit handling of sandboxAPI functions
  const tgpBridge: Record<string, any> = {
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
      // Security: Enforce URL allow-list
      if (!allowedFetchUrls || allowedFetchUrls.length === 0) {
        throw new Error(`Security Violation: Network access is disabled. No URLs are whitelisted in tgp.config.ts.`);
      }
      const isAllowed = allowedFetchUrls.some(prefix => url.startsWith(prefix));
      if (!isAllowed) {
        throw new Error(`Security Violation: URL "${url}" is not in the allowed list.`);
      }

      const response = await fetch(url, init);

      // Return a serializable, safe subset of the Response object.
      // The methods must be wrapped to be transferred correctly.
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        text: () => response.text(),
        json: () => response.json(),
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
    },
  };

  // Explicitly add sandboxAPI functions to preserve their function nature
  if (kernel.sandboxAPI) {
    for (const [key, value] of Object.entries(kernel.sandboxAPI)) {
      tgpBridge[key] = value;
    }
  }

  return {
    tgp: tgpBridge
  };
}