import { Kernel } from '../kernel/core.js';
import { DBBackend } from '../kernel/db.js';
/**
 * Creates the Bridge Object exposed to the Sandbox.
 * This maps secure Kernel methods to the Guest environment.
 *
 * NOTE: When passing functions to isolated-vm, arguments and return values
 * must be serializable or wrapped in References.
 */
export declare function createSandboxBridge(kernel: Kernel, db: DBBackend): {
    tgp_read_file: (path: string) => Promise<string>;
    tgp_write_file: (path: string, content: string) => Promise<void>;
    tgp_list_files: (dir: string) => Promise<string[]>;
    tgp_fetch: (url: string, init?: any) => Promise<{
        status: number;
        text: () => string;
        json: () => any;
    }>;
    tgp_log: (...args: any[]) => void;
    tgp_db_query: (sql: string, params?: any[]) => Promise<any[]>;
};
