import { buildSync } from 'esbuild';

// In-memory cache to avoid redundant bundling of the same dependency within the kernel's lifetime.
const bundleCache = new Map<string, string>();

/**
 * Synchronously bundles a node module into a single CommonJS string.
 * This is used by the sandbox's 'require' shim to provide whitelisted dependencies.
 * 
 * @param dependency The name of the package to bundle (e.g., 'zod').
 * @returns The bundled JavaScript code as a string.
 */
export function bundleDependencySync(dependency: string): string {
  if (bundleCache.has(dependency)) {
    return bundleCache.get(dependency) as string;
  }

  try {
    const result = buildSync({
      entryPoints: [dependency],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      write: false, // Return the output in memory
      logLevel: 'silent', // Suppress esbuild warnings in production logs
    });

    if (result.outputFiles !== undefined && result.outputFiles.length > 0) {
      const bundledCode = result.outputFiles[0].text;
      bundleCache.set(dependency, bundledCode);
      return bundledCode;
    }

    throw new Error(`esbuild did not produce an output file for '${dependency}'.`);

  } catch (error) {
    // Re-throw with a more informative message for the host application logs
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve or bundle dependency '${dependency}': ${msg}`);
  }
}