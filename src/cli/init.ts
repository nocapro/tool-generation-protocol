/* eslint-disable no-console */
import * as fs from 'fs/promises';
import * as path from 'path';

export async function initCommand() {
  const cwd = process.cwd();
  console.log(`[TGP] Initializing in ${cwd}...`);

  const configPath = path.join(cwd, 'tgp.config.ts');
  const gitIgnorePath = path.join(cwd, '.gitignore');
  const tgpDir = path.join(cwd, '.tgp');
  const toolsDir = path.join(tgpDir, 'tools');
  const binDir = path.join(tgpDir, 'bin');
  const metaPath = path.join(tgpDir, 'meta.json');

  // 1. Create tgp.config.ts
  if (await exists(configPath)) {
    console.log(`[TGP] tgp.config.ts already exists. Skipping.`);
  } else {
    await fs.writeFile(configPath, CONFIG_TEMPLATE.trim());
    console.log(`[TGP] Created tgp.config.ts`);
  }

  // 2. Update .gitignore
  if (await exists(gitIgnorePath)) {
    const content = await fs.readFile(gitIgnorePath, 'utf-8');
    if (!content.includes('.tgp')) {
      await fs.appendFile(gitIgnorePath, '\n# TGP\n.tgp\n');
      console.log(`[TGP] Added .tgp to .gitignore`);
    }
  } else {
    await fs.writeFile(gitIgnorePath, '# TGP\n.tgp\n');
    console.log(`[TGP] Created .gitignore`);
  }

  // 3. Create .tgp directory (just to be nice)
  await fs.mkdir(tgpDir, { recursive: true });

  // 4. Scaffold Tools directory
  await fs.mkdir(toolsDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  console.log(`[TGP] Created .tgp/tools and .tgp/bin directories`);

  // 5. Initialize Registry (meta.json)
  if (!await exists(metaPath)) {
    await fs.writeFile(metaPath, JSON.stringify({ tools: {} }, null, 2));
    console.log(`[TGP] Created .tgp/meta.json`);
  }

  console.log(`[TGP] Initialization complete. Run 'npx tgp' to start hacking.`);
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const CONFIG_TEMPLATE = `
import { defineTGPConfig } from '@tgp/core';

export default defineTGPConfig({
  // The Root of the Agent's filesystem
  // In serverless environments, this is ephemeral.
  rootDir: './.tgp',

  // 1. DATA: Database Configuration
  db: {
    dialect: 'postgres',
    ddlSource: 'drizzle-kit generate --print',
  },

  // 2. BACKEND (GitOps)
  // The Agent pulls state from here and pushes new tools here.
  git: {
    provider: 'github',
    repo: 'my-org/tgp-tools',
    branch: 'main',
    auth: {
      // Use ENV variables for security
      token: process.env.TGP_GITHUB_TOKEN || '',
      user: 'tgp-bot[bot]',
      email: 'tgp-bot@users.noreply.github.com'
    },
    writeStrategy: process.env.NODE_ENV === 'production' ? 'pr' : 'direct'
  },

  // 3. FILESYSTEM JAIL (Sandbox Security)
  fs: {
    allowedDirs: ['./public/exports', './tmp'],
    blockUpwardTraversal: true
  },

  // 4. RUNTIME
  allowedImports: ['@tgp/std', 'zod', 'date-fns']
});
`;