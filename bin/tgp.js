#!/usr/bin/env node

import { cli } from '../dist/cli.js';

cli().catch((err) => {
  console.error('TGP CLI Error:', err);
  process.exit(1);
});