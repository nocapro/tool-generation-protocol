import { z } from 'zod';
export declare const GitConfigSchema: z.ZodObject<{
    provider: z.ZodEnum<["github", "gitlab", "bitbucket"]>;
    repo: z.ZodString;
    branch: z.ZodDefault<z.ZodString>;
    auth: z.ZodObject<{
        token: z.ZodString;
        user: z.ZodDefault<z.ZodString>;
        email: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        token: string;
        user: string;
        email: string;
    }, {
        token: string;
        user?: string | undefined;
        email?: string | undefined;
    }>;
    writeStrategy: z.ZodDefault<z.ZodEnum<["direct", "pr"]>>;
}, "strip", z.ZodTypeAny, {
    provider: "github" | "gitlab" | "bitbucket";
    repo: string;
    branch: string;
    auth: {
        token: string;
        user: string;
        email: string;
    };
    writeStrategy: "direct" | "pr";
}, {
    provider: "github" | "gitlab" | "bitbucket";
    repo: string;
    auth: {
        token: string;
        user?: string | undefined;
        email?: string | undefined;
    };
    branch?: string | undefined;
    writeStrategy?: "direct" | "pr" | undefined;
}>;
export declare const DBConfigSchema: z.ZodObject<{
    dialect: z.ZodEnum<["postgres", "mysql", "sqlite", "libsql"]>;
    ddlSource: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    dialect: "postgres" | "mysql" | "sqlite" | "libsql";
    ddlSource?: string | undefined;
}, {
    dialect: "postgres" | "mysql" | "sqlite" | "libsql";
    ddlSource?: string | undefined;
}>;
export declare const FSConfigSchema: z.ZodObject<{
    allowedDirs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    blockUpwardTraversal: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    allowedDirs: string[];
    blockUpwardTraversal: boolean;
}, {
    allowedDirs?: string[] | undefined;
    blockUpwardTraversal?: boolean | undefined;
}>;
export declare const TGPConfigSchema: z.ZodObject<{
    rootDir: z.ZodDefault<z.ZodString>;
    db: z.ZodOptional<z.ZodObject<{
        dialect: z.ZodEnum<["postgres", "mysql", "sqlite", "libsql"]>;
        ddlSource: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        dialect: "postgres" | "mysql" | "sqlite" | "libsql";
        ddlSource?: string | undefined;
    }, {
        dialect: "postgres" | "mysql" | "sqlite" | "libsql";
        ddlSource?: string | undefined;
    }>>;
    git: z.ZodObject<{
        provider: z.ZodEnum<["github", "gitlab", "bitbucket"]>;
        repo: z.ZodString;
        branch: z.ZodDefault<z.ZodString>;
        auth: z.ZodObject<{
            token: z.ZodString;
            user: z.ZodDefault<z.ZodString>;
            email: z.ZodDefault<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            token: string;
            user: string;
            email: string;
        }, {
            token: string;
            user?: string | undefined;
            email?: string | undefined;
        }>;
        writeStrategy: z.ZodDefault<z.ZodEnum<["direct", "pr"]>>;
    }, "strip", z.ZodTypeAny, {
        provider: "github" | "gitlab" | "bitbucket";
        repo: string;
        branch: string;
        auth: {
            token: string;
            user: string;
            email: string;
        };
        writeStrategy: "direct" | "pr";
    }, {
        provider: "github" | "gitlab" | "bitbucket";
        repo: string;
        auth: {
            token: string;
            user?: string | undefined;
            email?: string | undefined;
        };
        branch?: string | undefined;
        writeStrategy?: "direct" | "pr" | undefined;
    }>;
    fs: z.ZodDefault<z.ZodObject<{
        allowedDirs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        blockUpwardTraversal: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        allowedDirs: string[];
        blockUpwardTraversal: boolean;
    }, {
        allowedDirs?: string[] | undefined;
        blockUpwardTraversal?: boolean | undefined;
    }>>;
    allowedImports: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    rootDir: string;
    git: {
        provider: "github" | "gitlab" | "bitbucket";
        repo: string;
        branch: string;
        auth: {
            token: string;
            user: string;
            email: string;
        };
        writeStrategy: "direct" | "pr";
    };
    fs: {
        allowedDirs: string[];
        blockUpwardTraversal: boolean;
    };
    allowedImports: string[];
    db?: {
        dialect: "postgres" | "mysql" | "sqlite" | "libsql";
        ddlSource?: string | undefined;
    } | undefined;
}, {
    git: {
        provider: "github" | "gitlab" | "bitbucket";
        repo: string;
        auth: {
            token: string;
            user?: string | undefined;
            email?: string | undefined;
        };
        branch?: string | undefined;
        writeStrategy?: "direct" | "pr" | undefined;
    };
    rootDir?: string | undefined;
    db?: {
        dialect: "postgres" | "mysql" | "sqlite" | "libsql";
        ddlSource?: string | undefined;
    } | undefined;
    fs?: {
        allowedDirs?: string[] | undefined;
        blockUpwardTraversal?: boolean | undefined;
    } | undefined;
    allowedImports?: string[] | undefined;
}>;
export type GitConfig = z.infer<typeof GitConfigSchema>;
export type DBConfig = z.infer<typeof DBConfigSchema>;
export type FSConfig = z.infer<typeof FSConfigSchema>;
export type TGPConfig = z.infer<typeof TGPConfigSchema>;
/**
 * Defines the structure for a tool file persisted in the VFS.
 * This is what resides in ./.tgp/tools/
 */
export declare const ToolSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}, {
    code: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}>;
export type ToolDefinition = z.infer<typeof ToolSchema>;
