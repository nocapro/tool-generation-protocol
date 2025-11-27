import { Kernel } from '../kernel/core.js';
import { DBBackend } from '../kernel/db.js';
/**
 * Creates the Bridge Object exposed to the Sandbox.
 * This maps secure Kernel methods to the Guest environment.
 *
 * We expose a structured 'tgp' object to the guest.
 */
export declare function createSandboxBridge(kernel: Kernel, db: DBBackend): {
    tgp: {
        read_file: (path: string) => Promise<string>;
        write_file: (path: string, content: string) => Promise<void>;
        list_files: (dir: string) => Promise<string[]>;
        fetch: (url: string, init?: any) => Promise<{
            status: number;
            text: () => string;
            json: () => any;
        }>;
        log: (...args: any[]) => void;
        db_query: (sql: string, params?: any[]) => Promise<any[]>;
    };
};
