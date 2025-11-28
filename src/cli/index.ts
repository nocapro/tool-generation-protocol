/* eslint-disable no-console */
import { initCommand } from './init.js';
import { fileURLToPath } from 'node:url';

export async function cli() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      await initCommand();
      break;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      console.log(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
Tool Generation Protocol (TGP) CLI

Usage:
  tgp init    Initialize a new TGP environment in the current directory.
  tgp help    Show this message.
`);
}

// Self-execution check: Run cli() if this file is the entry point.
// This enables running the CLI from source (e.g. `bun src/cli/index.ts`) for tests/dev.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}