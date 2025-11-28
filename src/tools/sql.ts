import { z } from 'zod';
import { AgentTool, ToolSet } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DBExecutor = (sql: string, params: any[]) => Promise<any>;

export const ExecSqlParams = z.object({
  sql: z.string().describe('The raw SQL query to execute.'),
  params: z.array(z.any()).optional().describe('An array of parameters to substitute into the query.'),
});

/**
 * Creates a ToolSet containing the `exec_sql` tool.
 * This function allows the host application to inject its own database connection
 * and execution logic into the TGP agent.
 *
 * @param executor A function that takes a SQL string and parameters and returns the result.
 * @returns A ToolSet containing the `exec_sql` tool.
 */
export function createSqlTools(executor: DBExecutor): ToolSet {
  return {
    exec_sql: {
      description: 'Executes a raw SQL query against the database. Returns an array of rows.',
      parameters: ExecSqlParams,
      execute: async ({ sql, params }) => {
        return executor(sql, params ?? []);
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as AgentTool<typeof ExecSqlParams, any>,
  };
}