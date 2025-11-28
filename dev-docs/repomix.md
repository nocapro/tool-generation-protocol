# Directory Structure
```
test-docs/
  e2e.test-plan.md
  integration.test-plan.md
  unit.test-plan.md
README.md
```

# Files

## File: test-docs/e2e.test-plan.md
````markdown
# End-to-End Test Plan (Real Implementation)

**Rules:**
1.  **Full Stack**: Tests run against the built `bin/tgp.js` or the public API entry point.
2.  **Persistence**: Verification involves killing the process and starting a new one to ensure state matches.

## 1. The "Cold Start" Agent Scenario
**Story**: An agent wakes up in a serverless environment, connects to a repo, builds a tool, uses it, and shuts down.

1.  **Setup Environment**:
    -   Create `bare-repo.git` (The Remote).
    -   Create `config.ts` pointing to `bare-repo.git`.
2.  **Agent Boot**:
    -   Initialize TGP Kernel.
    -   **Assert**: Local filesystem is clean (except for `.git` hydration).
3.  **Task**: "Create a fibonacci tool".
    -   Agent calls `write_file('tools/math/fib.ts', ...)` (Real TS code).
    -   Agent calls `check_tool('tools/math/fib.ts')`. **Assert**: Valid.
4.  **Execution**:
    -   Agent calls `exec_tool('tools/math/fib.ts', { n: 10 })`.
    -   **Assert**: Result is `55`.
5.  **Shutdown & Persist**:
    -   Kernel calls `sync()`.
    -   Process exits.
6.  **Verification (The "Next" Agent)**:
    -   Clone `bare-repo.git` to a **new** directory.
    -   Check file existence: `tools/math/fib.ts`.
    -   **Assert**: File content matches exactly.

## 2. The "Refactor" Scenario (Search & Replace)
**Story**: An existing tool is broken/outdated. Agent must patch it.

1.  **Pre-condition**: `tools/legacy.ts` exists with `console.log("old")`.
2.  **Agent Action**:
    -   Agent reads file.
    -   Agent calls `patch_file('tools/legacy.ts', ...)` to replace `console.log` with `return`.
3.  **Verification**:
    -   Run `exec_tool`.
    -   **Assert**: Output is returned value, not undefined.
    -   Read file from disk. **Assert**: Content is updated.

## 3. The "Infinite Loop" Self-Defense
**Story**: Agent generates malicious/buggy code that freezes.

1.  **Action**: Agent creates `tools/freeze.ts` (`while(true){}`).
2.  **Execution**: Agent calls `exec_tool('tools/freeze.ts')`.
3.  **Observation**:
    -   Function call throws exception.
    -   Exception is caught.
    -   **Assert**: Main process (The Agent) remains alive and responsive.
    -   **Assert**: Memory usage of Main process is stable (V8 isolate disposed).

## 4. The "SIGTERM" Cleanliness Test
**Story**: Deployment platform kills the pod while tool is running.

1.  **Setup**:
    -   Start TGP process that writes to a database loop.
2.  **Action**:
    -   Send `SIGTERM` to process.
3.  **Verification**:
    -   Check Database locks. **Assert**: Released.
    -   Check Temporary Files (`/tmp/tgp-*`). **Assert**: Deleted/Cleaned up.
    -   Check Git Lock files (`index.lock`). **Assert**: Cleared.

## 5. CLI Bootstrap Test
**Story**: Developer initializes project.

1.  **Action**: Exec `node bin/tgp.js init` in empty dir.
2.  **Assert**:
    -   `tgp.config.ts` created.
    -   `.tgp` folder structure created.
    -   `package.json` updated (if applicable).
````

## File: test-docs/integration.test-plan.md
````markdown
# Integration Test Plan (Real Implementation)

**Rules:**
1.  **Git**: Use local "bare" repositories to simulate remotes.
2.  **Database**: Use local SQLite file or ephemeral Docker container for SQL tests.

## 1. GitOps & Persistence
**Target**: `src/kernel/git.ts`
**Setup**:
1.  Create `REMOTE_DIR` (init bare repo).
2.  Create `AGENT_DIR` (configured as TGP root).

- [ ] **Hydration (Clone/Pull)**
    - [ ] Commit a tool `tools/hello.ts` to `REMOTE_DIR` using standard `git` CLI commands.
    - [ ] Initialize `TGP Kernel` in `AGENT_DIR`.
    - [ ] **Assert**: `tools/hello.ts` exists in `AGENT_DIR` and is readable.
- [ ] **Fabrication (Commit/Push)**
    - [ ] Use Kernel to write `tools/new.ts` in `AGENT_DIR`.
    - [ ] Trigger Kernel persistence (sync).
    - [ ] Verify in `REMOTE_DIR` (using `git log`) that a new commit exists with the expected message.
- [ ] **Concurrency (Locking)**
    - [ ] Instantiate **two** Kernels pointing to the same `REMOTE_DIR` but different local dirs.
    - [ ] Agent A writes `toolA.ts`. Agent B writes `toolB.ts`.
    - [ ] Both sync simultaneously.
    - [ ] **Assert**: `REMOTE_DIR` contains both files. No merge conflicts (assuming distinct files).

## 2. Kernel <-> Sandbox Bridge
**Target**: `src/sandbox/bridge.ts`

- [ ] **Host Filesystem Access**
    - [ ] Create file `data.json` in Host VFS.
    - [ ] Create tool that uses `tgp.read_file('data.json')`.
    - [ ] Execute tool.
    - [ ] **Assert**: Tool returns parsed JSON.
- [ ] **Recursive Tool Execution**
    - [ ] Create `tools/multiplier.ts` (returns `a * b`).
    - [ ] Create `tools/calculator.ts` that imports/calls `multiplier`.
    - [ ] Execute `calculator`.
    - [ ] **Assert**: Returns correct result. Verifies internal module resolution works in V8.

## 3. SQL Adapter (Real SQLite)
**Target**: `src/tools/sql.ts`
**Setup**: Create `test.db` (SQLite). Run migration to create table `users`.

- [ ] **Query Execution**
    - [ ] Tool executes `SELECT * FROM users`.
    - [ ] **Assert**: Returns real rows.
- [ ] **Transaction Rollback**
    - [ ] Tool executes:
        1. `INSERT INTO users ...`
        2. `throw new Error('Boom')`
    - [ ] Catch error in test.
    - [ ] Query `users` table.
    - [ ] **Assert**: Count is 0 (Rollback successful).
````

## File: test-docs/unit.test-plan.md
````markdown
# Unit Test Plan (Real Implementation)

**Rules:**
1.  **No Mocks**: Use real file systems, real V8 isolates.
2.  **Isolation**: Each test suite creates a unique temporary directory (`/tmp/tgp-test-{uuid}`).
3.  **Cleanup**: Register `process.on('SIGTERM')` handlers to wipe temp dirs.

## 1. VFS (Virtual Filesystem) - Node Adapter
**Target**: `src/vfs/node.ts`
**Setup**: Create a temporary directory `TEST_ROOT`.

- [ ] **Real I/O Operations**
    - [ ] `write('deep/nested/file.txt')`: Verify it creates physical directories on disk.
    - [ ] `read('deep/nested/file.txt')`: Verify it returns exact byte content written.
    - [ ] `list('deep')`: Verify it returns structure matching OS `ls -R`.
- [ ] **Path Security (Jail)**
    - [ ] Attempt `write('../outside.txt')`. **Assert**: Throws specific `SecurityViolation` error. File **must not** exist outside `TEST_ROOT`.
    - [ ] Attempt symlink traversal. Create a symlink in `TEST_ROOT` pointing to `/etc/passwd`. Attempt `read()`. **Assert**: Throws or resolves to empty/null (depending on config).

## 2. Sandbox Execution (V8)
**Target**: `src/sandbox/isolate.ts`, `src/sandbox/bundler.ts`
**Setup**: Instantiate real `isolated-vm`.

- [ ] **Compilation**
    - [ ] Feed raw TypeScript: `export default (a: number) => a * 2;`.
    - [ ] **Assert**: Returns a callable function handle.
    - [ ] Feed Syntax Error: `const x = ;`.
    - [ ] **Assert**: Throws `CompilationError` with line number.
- [ ] **Runtime constraints**
    - [ ] **Memory**: Execute script that allocates 100MB buffer. **Assert**: Throws `ERR_ISOLATE_MEMORY`.
    - [ ] **Timeout**: Execute `while(true){}`. **Assert**: Throws `ERR_ISOLATE_TIMEOUT` after 50ms (or configured limit).
- [ ] **Determinism**
    - [ ] Run `Math.random()`. **Assert**: If seed is configurable, output is constant. (If not, verify output format).

## 3. Tool Validation logic
**Target**: `src/tools/validation.ts`

- [ ] **Static Analysis**
    - [ ] Input source code with `process.exit()`.
    - [ ] **Assert**: Validation fails with "Global 'process' is forbidden".
    - [ ] Input source code with `import fs from 'fs'`.
    - [ ] **Assert**: Validation fails if import is not in whitelist.
````

## File: README.md
````markdown
# Tool Generation Protocol (TGP)

> **The Self-Assembling Backend.**
> **MCP is dead.** Stop streaming context. Start compiling tools.

# 1. Manifesto

**The Problem:** You spend 80% of your time writing "glue code"—RPCs, CRUD wrappers, and slightly different "Export to CSV" endpoints.
**The Trap (MCP):** Model Context Protocol (MCP) is just better glue. It requires you to pre-build tools. If you didn't write the endpoint, the Agent fails.
**The Solution (TGP):** Give the Agent a compiler.

TGP is a **JIT Runtime for Business Logic**. The Agent forges its own tools, validates them, and persists them to Git. It builds a personalized standard library for your application.

*   **MCP**: "I can't do that. I don't have a tool."
*   **TGP**: "I wrote a tool. It's running."

## 1.1 Use Cases (The Long Tail)

99% of features are never built because they are too specific. TGP solves the "I wish the app could do X" problem.

*   **Reporting**: "List users who downgraded in June, pipe-delimited." -> Forges `tools/reports/downgrade.ts`. Time: 4s.
*   **Cleanup**: "Fix typo in 'Ohiio' for active users." -> Forges `tools/maintenance/fix_typo.ts`. Atomic SQL update.
*   **Logic**: "Calculate dimensional weight `(L*W*H)/139`." -> Forges `tools/shipping/dim_weight.ts`. Deterministic V8 execution.

## 1.2 Anti-Patterns

TGP is a **JIT Compiler**, not a Daemon.
*   **Not a Server**: No `express.listen()`. Tools are ephemeral (Lambda-style).
*   **Not a Browser**: No DOM. No Puppeteer.
*   **Not an ORM**: No object mutation. Use raw, atomic SQL.

# 2. Architecture (The Stack)

TGP drops into your existing Node/Next.js/Nest apps. It is **just TypeScript**.

## 2.1 The Developer View

The agent views `./.tgp` as its root directory. This is a standard Git repository.

```bash
./.tgp/
├── .git/                  # MEMORY: Version history of TOOL SOURCE CODE.
├── bin/                   # KERNEL: The compiled 'tgp' binary.
├── tools/                 # USER SPACE: Generated capabilities.
│   ├── analytics/         # e.g., "churn-prediction.ts"
│   └── reports/           # e.g., "revenue-csv.ts"
└── meta.json              # REGISTRY: Fast lookup index.
```

## 2.2 GitOps & Serverless Harmony

**Is TGP Serverless Friendly?** Yes.

In a Serverless environment (Cloudflare Workers, AWS Lambda, Vercel), the runtime filesystem is ephemeral. TGP handles this by treating **Git as the Backend**.

1.  **Hydration**: On boot, TGP checks if the local cache matches the remote `HEAD`. If not, it pulls the latest tools from GitHub/GitLab.
2.  **Execution**: Tools run in the local V8 Isolate (milliseconds).
3.  **Persistence**: When an Agent forges a new tool, it commits and pushes to the remote repository.
4.  **Concurrency**: TGP uses standard Git locking to handle concurrent writes from multiple agents.

*Configuring GitHub credentials enables the "Infinite Memory" feature.*

## 2.3 The VFS (Virtual Filesystem)

TGP enforces a strict separation between **The Editor (Host)** and **The Runtime (Sandbox)**.

1.  **The Editor (Agent Context)**: The Agent accesses `./.tgp` directly via the Kernel Tools. It works just like a human dev using VS Code.
2.  **The Runtime (Sandbox Context)**: When code *executes*, it runs inside the V8 Isolate with a restricted VFS:
    *   **`/lib`**: Read-Only mount of Host's `./.tgp/tools`.
    *   **`/tmp`**: Read-Write ephemeral scratchpad (wiped on exit).

## 2.4 The Kernel Tools (Agent Capabilities)

The Agent is provided with a specific set of primitives to interact with the environment. It does not have generic shell access.

| Tool | Signature | Description |
| :--- | :--- | :--- |
| **`list_files`** | `(dir: string) => string[]` | Recursively list available tools or definitions. |
| **`read_file`** | `(path: string) => string` | Read the content of an existing tool or schema. |
| **`write_file`** | `(path: string, content: string) => void` | Create a new tool or overwrite a draft. |
| **`patch_file`** | `(path: string, search: string, replace: string) => void` | Surgical search-and-replace for refactoring. |
| **`check_tool`** | `(path: string) => { valid: boolean, errors: string[] }` | Run the JIT compiler and linter. |
| **`exec_tool`** | `(path: string, args: object) => any` | Execute a tool inside the secure Sandbox. |
| **`exec_sql`**   | `(sql: string, params: object) => any` | Executes a raw SQL query against the host database. |

---

# 3. The Protocol

This is the algorithm the Agent must follow. It is the "software" running on the Agent's "CPU".

## 3.1 The Prime Directive: "Reuse or Forge"

The Agent is forbidden from executing one-off scripts for repetitive tasks.

1.  **Lookup**: Query registry. If a tool exists (Score > 0.85), **Reuse**.
2.  **Forge**: If no tool exists, **Create**.
3.  **Persist**: Commit to Git.

## 3.2 The 8 Standards of Code Quality

To ensure the ecosystem remains clean, the Agent must adhere to strict code quality guidelines. The Linter/Reviewer will reject tools that violate these principles.

1.  **Abstract**: Logic must be separated from specific data instances.
    *   *Bad*: `const tax = 0.05`
    *   *Good*: `const tax = args.taxRate`
2.  **Composable**: Functions should do one thing and return a result usable by other functions.
3.  **HOFs (Higher Order Functions)**: Use map/reduce/filter patterns rather than imperative loops where possible.
4.  **Stateless**: Tools must not rely on variables outside their scope or previous executions.
5.  **Reusable**: The code should be generic enough to serve multiple use cases.
6.  **General by Params**: Behavior is controlled by arguments, not hardcoded strings.
7.  **No Hardcoded Values**: No magic numbers, no specific IDs, no emails in source code.
8.  **Orchestrator Capable**: Tools should be able to import and invoke other TGP tools (via the `require` bridge).

## 3.3 The Feedback Loop (Self-Healing)

If a tool fails during execution:
1.  **Capture**: Agent reads STDERR.
2.  **Diagnose**: Agent identifies the logic error or schema mismatch.
3.  **Patch**: Agent uses `patch_file` to fix the code in place.
4.  **Verify**: Agent runs `check_tool`.

---

# 4. Security (The Sandbox)

**TL;DR:**
1.  **Zero-Trust**: Tools run in a stripped V8 context. No `process`, no `fs`, no `eval`.
2.  **Resource Caps**: 64MB RAM, 50ms CPU time. Infinite loops die instantly.
3.  **Transaction Safety**: All DB writes run inside a transaction. If the tool throws, the DB rolls back.

## 4.1 The Great Wall (isolated-vm)
TGP uses `isolated-vm` to create a boundary between the Host (Agent) and the Guest (Tool).
*   **Memory**: Separate Heaps.
*   **Syscalls**: Bridged via specific `tgp` global object.
*   **Network**: Blocked by default. Allowed only via whitelisted `fetch` bridge.

---

# 5. The Ecosystem (Join the Hive)

We are building the **`libc` of the AI Age**.

## 5.1 The Logic/State Split
In TGP, **Tools are Stateless**.
*   **Logic (Public)**: The TypeScript code (`tools/analytics/retention.ts`).
*   **State (Private)**: The Database Connection (`DATABASE_URL`).

## 5.2 Hub & Spoke Topology (Git Backed)
Because TGP relies on Git, your tools are portable.
*   **Upstream**: A private repo (e.g., `github.com/org/tgp-global`).
*   **Downstream**: The ephemeral serverless instances pull from Upstream.

---

# 6. Governance Modes

## 6.1 God Mode (Development)
*   **Behavior**: `Forge -> Compile -> Execute`.
*   **Target**: Local `.tgp/` folder or direct push to `main`.

## 6.2 Gatekeeper Mode (Production)
*   **Behavior**: `Forge -> Compile -> Pull Request`.
*   **Target**: Agent creates a branch `feat/tool-name` and opens a PR.
*   **Approval**: A human or a Senior Agent reviews the diff before merging to `main`.

---

# 7. Integration Spec

## 7.1 The Bootstrap
```bash
npx tgp@latest init
```

## 7.2 Configuration (`tgp.config.ts`)

The configuration defines the Sandbox boundaries and the Git backend.

```typescript
import { defineTGPConfig } from '@tgp/core';

export default defineTGPConfig({
  // The Root of the Agent's filesystem (Ephemeral in serverless)
  rootDir: './.tgp',

  // 1. BACKEND (GitOps)
  // Essential for Serverless/Ephemeral environments.
  // The Agent pulls state from here and pushes new tools here.
  git: {
    provider: 'github', // or 'gitlab', 'bitbucket'
    repo: 'my-org/tgp-tools',
    branch: 'main',
    auth: {
      // Why not in config? Because we read from ENV for security.
      token: process.env.TGP_GITHUB_TOKEN,
      user: 'tgp-bot[bot]',
      email: 'tgp-bot@users.noreply.github.com'
    },
    // Strategy: 'direct' (push) or 'pr' (pull request)
    writeStrategy: process.env.NODE_ENV === 'production' ? 'pr' : 'direct'
  },

  // 2. FILESYSTEM JAIL
  fs: {
    allowedDirs: ['./public/exports', './tmp'],
    blockUpwardTraversal: true
  },

  // 3. RUNTIME
  allowedImports: ['@tgp/std', 'zod', 'date-fns'],

  // 4. NETWORKING
  // Whitelist of URL prefixes the sandbox fetch can access.
  allowedFetchUrls: ['https://api.stripe.com']
});
```

## 7.3 Runtime Usage (The SDK)

```typescript
// src/app/api/agent/route.ts
import { TGP, tgpTools, createSqlTools } from '@tgp/core';
import { generateText } from 'ai';
import { myDbExecutor } from '@/lib/db'; // Your DB connection

const kernel = new TGP({ configFile: './tgp.config.ts' });

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Injects: list_files, read_file, write_file, exec_tool
  const systemTools = tgpTools(kernel);
  // Injects the `exec_sql` tool, powered by your database
  const dataTools = createSqlTools(myDbExecutor);

  const result = await generateText({
    model: openai('gpt-4-turbo'),
    tools: { ...systemTools, ...dataTools },
    messages,
    // The System Prompt enforces the "8 Standards"
    system: kernel.getSystemPrompt() 
  });

  return result.response;
}
```

---

# 8. Roadmap & Contributing

We are hacking on the future of backend development.

*   **[P0] The LSP**: IDE extension for real-time tool visibility.
*   **[P1] Vector Memory**: Semantic search for tool reuse.
*   **[P2] Multi-Lang**: Python support via WebAssembly.

**Get Involved:**
`git clone` -> `npm install` -> `npm run forge`.
```
````
