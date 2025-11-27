import { Kernel } from './kernel/core.js';
export interface TGPOptions {
    /**
     * Path to the configuration file.
     * @default "./tgp.config.ts"
     */
    configFile?: string;
}
/**
 * High-level factory to create a fully initialized TGP Kernel in a Node.js environment.
 * This handles config loading, VFS setup (Disk-based), and Git backend wiring.
 */
export declare function createTGP(opts?: TGPOptions): Promise<Kernel>;
/**
 * Generates the System Prompt enforcing the "8 Standards" and TGP protocol.
 */
export declare function getSystemPrompt(): string;
