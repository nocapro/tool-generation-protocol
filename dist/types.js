import { z } from 'zod';
// --- Git Configuration Schema ---
export const GitConfigSchema = z.object({
    provider: z.enum(['github', 'gitlab', 'bitbucket']),
    repo: z.string().min(1, "Repository name is required"),
    branch: z.string().default('main'),
    auth: z.object({
        token: z.string().min(1, "Git auth token is required"),
        user: z.string().default('tgp-bot[bot]'),
        email: z.string().email().default('tgp-bot@users.noreply.github.com'),
    }),
    writeStrategy: z.enum(['direct', 'pr']).default('direct'),
});
// --- Database Configuration Schema ---
export const DBConfigSchema = z.object({
    dialect: z.enum(['postgres', 'mysql', 'sqlite', 'libsql']),
    ddlSource: z.string().optional().describe("Command to generate DDL, e.g., 'drizzle-kit generate'"),
});
// --- Filesystem Jail Schema ---
export const FSConfigSchema = z.object({
    allowedDirs: z.array(z.string()).default(['./tmp']),
    blockUpwardTraversal: z.boolean().default(true),
});
// --- Main TGP Configuration Schema ---
export const TGPConfigSchema = z.object({
    rootDir: z.string().default('./.tgp'),
    db: DBConfigSchema.optional(),
    git: GitConfigSchema,
    fs: FSConfigSchema.default({}),
    allowedImports: z.array(z.string()).default(['@tgp/std', 'zod', 'date-fns']),
});
/**
 * Defines the structure for a tool file persisted in the VFS.
 * This is what resides in ./.tgp/tools/
 */
export const ToolSchema = z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.unknown()), // JsonSchema
    code: z.string(), // The raw TypeScript source
});
