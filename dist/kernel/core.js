import { createGitBackend } from './git.js';
import { createNoOpDB } from './db.js';
/**
 * Factory to create a TGP Kernel.
 * This wires up the configuration, the filesystem, and the git backend.
 */
export function createKernel(opts) {
    const { config, vfs, fs } = opts;
    const git = createGitBackend(fs, config);
    const db = createNoOpDB(); // TODO: Connect to real DB based on config.db
    let isBooted = false;
    return {
        config,
        vfs,
        git,
        db,
        async boot() {
            if (isBooted)
                return;
            console.log(`[TGP] Kernel booting...`);
            try {
                // Hydrate the filesystem from Git
                await git.hydrate();
                isBooted = true;
                console.log(`[TGP] Kernel ready.`);
            }
            catch (error) {
                console.error(`[TGP] Boot failed:`, error);
                throw error;
            }
        },
        async shutdown() {
            console.log(`[TGP] Kernel shutting down...`);
            // Cleanup tasks (close db connections, etc) can go here
            isBooted = false;
        }
    };
}
