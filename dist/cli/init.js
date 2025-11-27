import * as fs from 'fs/promises';
import * as path from 'path';
export async function initCommand() {
    const cwd = process.cwd();
    console.log(`[TGP] Initializing in ${cwd}...`);
    const configPath = path.join(cwd, 'tgp.config.ts');
    const gitIgnorePath = path.join(cwd, '.gitignore');
    const tgpDir = path.join(cwd, '.tgp');
    // 1. Create tgp.config.ts
    if (await exists(configPath)) {
        console.log(`[TGP] tgp.config.ts already exists. Skipping.`);
    }
    else {
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
    }
    else {
        await fs.writeFile(gitIgnorePath, '# TGP\n.tgp\n');
        console.log(`[TGP] Created .gitignore`);
    }
    // 3. Create .tgp directory (just to be nice)
    await fs.mkdir(tgpDir, { recursive: true });
    console.log(`[TGP] Initialization complete. Run 'npx tgp' to start hacking.`);
}
async function exists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
const CONFIG_TEMPLATE = `
import { defineTGPConfig } from '@tgp/core';

export default defineTGPConfig({
  // The Root of the Agent's filesystem
  rootDir: './.tgp',

  // Database Configuration (Optional)
  // db: {
  //   dialect: 'postgres',
  //   ddlSource: 'drizzle-kit generate --print',
  // },

  // Git Backend (Required for Persistence)
  git: {
    provider: 'github',
    repo: 'my-org/tgp-tools',
    branch: 'main',
    auth: {
      token: process.env.GITHUB_TOKEN || '',
      user: 'tgp-bot',
      email: 'bot@tgp.dev'
    },
    writeStrategy: 'direct' // or 'pr'
  },

  // Sandbox Security
  fs: {
    allowedDirs: ['./tmp'],
    blockUpwardTraversal: true
  },

  allowedImports: ['@tgp/std', 'zod', 'date-fns']
});
`;
