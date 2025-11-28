/**
 * Creates a unique temporary directory for a test case.
 * Registers it for auto-cleanup on process exit.
 */
export declare function createTempDir(prefix?: string): Promise<string>;
/**
 * Recursively deletes a directory.
 */
export declare function cleanupDir(dir: string): Promise<void>;
/**
 * Initializes a bare Git repository at the specified path.
 * This serves as the 'Remote' for the E2E tests.
 */
export declare function initBareRepo(dir: string): Promise<void>;
/**
 * Generates a tgp.config.js file in the test directory pointing to the local bare repo.
 * Uses .js to avoid compilation dependencies and uses absolute paths for isolation.
 */
export declare function createTgpConfig(workDir: string, remoteRepo: string, fileName?: string): Promise<string>;
/**
 * Executes the TGP CLI binary in the given directory.
 */
export declare function runTgpCli(args: string[], cwd: string): Promise<{
    stdout: string;
    stderr: string;
    code: number;
}>;
