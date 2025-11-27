import { TGPConfig } from './types.js';
/**
 * Identity function to provide type inference for configuration files.
 * usage: export default defineTGPConfig({ ... })
 */
export declare function defineTGPConfig(config: TGPConfig): TGPConfig;
/**
 * Dynamically loads a TGP configuration file, validates it against the schema,
 * and returns the typed configuration object.
 *
 * @param configPath - Absolute or relative path to the config file (e.g., ./tgp.config.ts)
 */
export declare function loadTGPConfig(configPath: string): Promise<TGPConfig>;
