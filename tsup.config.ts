import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
    // Build individual source files that test configurations need to import
    'src/config': 'src/config.ts',
    'src/types': 'src/types.ts',
    'src/tgp': 'src/tgp.ts',
    'src/kernel/core': 'src/kernel/core.ts',
    'src/kernel/registry': 'src/kernel/registry.ts',
    'src/kernel/git': 'src/kernel/git.ts',
    'src/sandbox/isolate': 'src/sandbox/isolate.ts',
    'src/sandbox/bridge': 'src/sandbox/bridge.ts',
    'src/sandbox/execute': 'src/sandbox/execute.ts',
    'src/tools/index': 'src/tools/index.ts',
    'src/tools/sql': 'src/tools/sql.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  shims: true,
  cjsInterop: true,
  splitting: false,
});