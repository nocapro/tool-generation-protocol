# Directory Structure
```
.gitignore
README.md
```

# Files

## File: .gitignore
````
# relay state
#/.relay/
````

## File: README.md
````markdown
# 1. Manifesto

**Treat the LLM as a CPU, not a Chatbot.**

The current state of Agentic AI is trapped in **RPC Bureaucracy**. Protocols like MCP (Model Context Protocol) treat agents as dumb clients that can only push buttons pre-wired by exhausted developers. They demand massive context windows just to describe static manifests, forcing you to pay a "Token Tax" every time the model breathes. It relies on the pre-cognitive fallacy: assuming the developer can predict every tool the user will ever need.

**MCP is just SOAP for LLMs.** It is rigid, server-heavy, and fragile. If you didn't write an endpoint for "Export to PDF centered on the Y-axis," the agent fails.

**TGP (Tool Generation Protocol)** inverts this.
We do not give the agent a fish; we give it a compiler.

1.  **Just-in-Time Compilation**: The agent is not limited to your API endpoints. If a user needs a specific data transformation, the agent **writes the code**, validates it, and runs it.
2.  **Zero-Token Reuse**: Once a tool is forged, it is a static binary. Invoking it cost **0 reasoning tokens**. The agent builds its own standard library (libc) over time.
3.  **Agent as OS**: The SaaS application is not a GUI; it is a kernel. The Agent is the Operating System. The Tools are the coreutils. The User is the Admin.

We are building a self-extending runtime where the software writes itself in response to user intent. **Stop building endpoints. Start building sandboxes.**


# 2. Architecture

TGP decouples the **Runtime (Host)** from the **Intelligence (Guest)**. The agent operates within a strictly defined filesystem topology, guided by an injected configuration map.

## 2.1 The Filesystem Topology

The agent views `~/.tgp` as its root directory. This directory is a Git repository, serving as both the toolkit storage and the temporal audit log.

```bash
~/.tgp/
├── .git/                  # MEMORY: Temporal audit log & version control
├── core/                  # KERNEL: Immutable host utilities (Read-Only)
│   ├── runner.ts          # Sandboxed child_process wrapper
│   ├── linter.js          # AST validator (The Gatekeeper)
│   └── .eslintrc.json     # Strict syntax rules
├── tools/                 # USER SPACE: Generated capabilities (Read-Write)
│   ├── analytics/         # e.g., "churn-prediction.ts"
│   ├── operations/        # e.g., "bulk-update-users.ts"
│   └── reports/           # e.g., "generate-pdf.ts"
└── meta.json              # REGISTRY: Fast lookup index
```

## 2.2 Configuration Injection (`TGP_CONFIG`)

The agent does not guess paths. The Host Application injects a read-only configuration object into the agent's environment variable `TGP_CONFIG`. This acts as the **Hardware Abstraction Layer (HAL)**.

**`tgp.config.json` (Injected by Host)**
```json
{
  "app": {
    "root": "/app",
    "env": "production"
  },
  "db": {
    "dialect": "postgres",
    "schemaPath": "/app/src/db/schema.ts", // Agent imports this dynamically
    "connectionVar": "DATABASE_URL"
  },
  "filesystem": {
    "allowedDirs": ["/app/exports", "/tmp"],
    "maxWriteSizeMB": 50
  },
  "libs": {
    "whitelist": ["drizzle-orm", "date-fns", "pdfkit", "zod"]
  }
}
```

## 2.3 The Execution Boundary

The agent is **never** permitted to run `node script.js` directly. All execution flows through the **Core Runner**.

1.  **Draft**: Agent writes code to `/tmp/draft.ts`.
2.  **Lint**: Agent runs `node ~/.tgp/core/linter.js /tmp/draft.ts`.
3.  **Execute**: Agent invokes `tsx ~/.tgp/core/runner.ts /tmp/draft.ts`.

The `runner.ts` binary enforces the `TGP_CONFIG` constraints, stripping dangerous environment variables and locking the CWD (Current Working Directory) to the project root.

# 3. The Protocol

This is the algorithm the Agent must follow. It is the "software" running on the Agent's "CPU". The goal is to minimize token usage while maximizing capability evolution.

## 3.1 The Prime Directive: "Reuse or Forge"

The Agent is forbidden from executing one-off scripts for repetitive tasks. It must decide between **Reusing** an existing tool or **Forging** a new one.

### Phase 1: Lookup (Zero Token Cost)
Before acting, the Agent queries its tool registry.
```bash
tgp list --query "revenue report"
# Output: tools/analytics/revenue-report.ts (v0.2 - "Generates monthly CSV")
```
*   **Hit**: Proceed to **Phase 4 (Execution)**.
*   **Miss**: Proceed to **Phase 2 (Forge)**.

### Phase 2: Forge (High Token Cost)
The Agent writes a new tool to fill the gap.
1.  **Read Config**: Analyze `TGP_CONFIG` for schema paths and allowed libraries.
2.  **Draft**: Write a TypeScript file (e.g., `temp/draft.ts`).
    *   *Constraint*: Must import schema dynamically.
    *   *Constraint*: Must handle I/O via `process.argv` (inputs) and `STDOUT` (JSON outputs).
3.  **Verify**:
    ```bash
    tgp check temp/draft.ts
    ```
    *   *Success*: Proceed to commit.
    *   *Fail*: Agent analyzes error. If logic error -> Self-Correct. If API error -> Call `mcp_docs_lookup`.

### Phase 3: Persistence (Temporal Memory)
Once verified, the tool is committed to the repository. This transforms a "thought" into a "capability."
```bash
mv temp/draft.ts ~/.tgp/tools/analytics/revenue-report.ts
git add .
git commit -m "feat(analytics): add monthly revenue CSV exporter"
```
*Note: The commit message is the index for future Lookups.*

### Phase 4: Execution (Native Speed)
The Agent invokes the tool via the Kernel.
```bash
tgp run tools/analytics/revenue-report.ts --month "2023-10"
```

## 3.2 The Feedback Loop (Self-Healing)

If a tool fails during **Phase 4**:
1.  **Capture**: Agent reads STDERR.
2.  **Diagnose**: Is it a data error (invalid input) or a logic error (bug)?
3.  **Refactor**:
    *   Agent creates `fix/revenue-report` branch.
    *   Patches code.
    *   Runs `tgp check`.
4.  **Patch**: `git commit -m "fix(analytics): handle null values in revenue column"`.

## 3.3 Documentation Strategy

The Agent treats external documentation as a **Level 2 Resource**.
1.  **Level 0 (Internal)**: Logic derived from training data.
2.  **Level 1 (Codebase)**: Logic derived from reading `git show` of existing tools.
3.  **Level 2 (External)**: Logic derived from MCP/Context7 (e.g., "Latest Drizzle docs").

*The Protocol dictates that Level 2 is only accessed if Level 0 and 1 fail validation.*

# 4. Security Kernel

The `tgp` binary acts as a hypervisor. The Agent runs in **Untrusted User Space**. The Kernel enforces strict resource bounds and isolation boundaries to prevent "runaway intelligence" or accidental destruction.

## 4.1 Execution Sandbox (V8 Isolates)
We do not use `child_process`. Node.js is not a sandbox.
TGP uses **`isolated-vm`** to run tools in distinct V8 Contexts.

*   **True Isolation**: Tools cannot access the host `process` object, `require`, or the filesystem.
*   **The Syscall Bridge**: Tools interact with the world ONLY through the injected `tgp` global object (the stable ABI).
*   **Snapshots**: Common libraries (Lodash, Zod) are compiled into a V8 Heap Snapshot once. Tool startup time is **< 5ms**.

## 4.2 Resource Quotas (The Kill Switch)
To prevent infinite loops (`while(true)`) or memory leaks from crashing the tenant pod, the Kernel applies V8 and OS-level limits per execution.

| Resource | Limit | Mechanism | Violation Result |
| :--- | :--- | :--- | :--- |
| **Wall Time** | 30 Seconds | `setTimeout(kill, 30000)` | `SIGTERM` + "TIMEOUT_EXCEEDED" |
| **Memory** | 512 MB | V8: `--max-old-space-size=512` | `SIGABRT` + "OOM" |
| **CPU** | Low Priority | `nice` level 10 | Execution throttled if host busy |
| **Processes** | 0 Children | Disallow `fork`/`spawn` inside tools | `EPERM` (via AST Linter) |

## 4.3 Filesystem Jail
The Agent sees the entire file tree, but the Kernel intercepts all I/O operations via the Runtime Config.
*   **Read-Only**: Default state for the entire project.
*   **Write-Allow**: Only paths explicitly listed in `TGP_CONFIG.filesystem.allowedDirs` (e.g., `/tmp`, `/app/exports`).
*   **Path Traversal**: Any argument containing `../` that resolves outside the jail triggers an immediate `SECURITY_VIOLATION` before code execution starts.

## 4.4 Environment Sanitization (Scorched Earth)
Tools do **not** inherit the Agent's environment.
1.  **Strip**: The `env` object starts empty.
2.  **Inject**: The Kernel injects *only* the specific keys defined in `TGP_CONFIG` (e.g., `DATABASE_URL`).
3.  **Block**: Sensitive keys (`AWS_SECRET_ACCESS_KEY`, `SSH_AUTH_SOCK`) are aggressively filtered out unless a specific "Integration Tool" is authorized to use them.

## 4.5 Network Firewall
*   **Default**: Block all outbound HTTP/TCP.
*   **Allowlist**: If a tool requires API access (e.g., Stripe), the specific domain must be whitelisted in `meta.json` and the tool must use the project's pre-approved Axios/Fetch instance, not a raw socket.

# 5. Multi-Tenancy

We achieve **Crowdsourced Intelligence** with **Strict Data Sovereignty** via a Hub-and-Spoke git topology. This allows Tenant A's innovation (e.g., a "Cohort Retention Analysis" script) to benefit Tenant B without ever exposing Tenant A's data.

## 5.1 The Logic/State Split

In TGP, **Tools are Stateless**.
*   **Logic (Public)**: The TypeScript code (`tools/analytics/retention.ts`). It contains algorithms but zero data.
*   **State (Private)**: The Database Connection (`DATABASE_URL`). This is injected by the Host at runtime.

**The Tenant Runner**:
```typescript
// Host App (Hidden)
const tenantId = req.headers['x-tenant-id'];
const dbUrl = await getTenantDb(tenantId);

// The tool runs in a generic context, unaware of the tenant identity
spawn('tgp', ['run', 'retention.ts'], { env: { DATABASE_URL: dbUrl } });
```

## 5.2 Hub & Spoke Topology

*   **Upstream (`tgp-global`)**: The "App Store." A private repo owned by the SaaS Devs. Contains verified, safe, generic tools.
*   **Downstream (`~/.tgp`)**: The Tenant's localized toolkit. It clones `tgp-global` at boot.

```ascii
[ Tenant A Pod ]         [ SaaS Central ]          [ Tenant B Pod ]
       |                        |                         |
 (Forges Tool)                  |                         |
    local-git  ------------> [Janitor]                  local-git
       |                   (Sanitizes)                    |
       |                        |                         |
       |                   [Global Git] <----------- (Git Pull)
       |                  (Repo: /tools)                  |
       |                        |                         |
       |                        |                  (Uses Tool on B's Data)
```

## 5.3 The Collaboration Pipeline

How a local hack becomes a global feature:

1.  **Harvest**: The SaaS Host monitors usage. If Tenant A's custom tool `analyze-region.ts` is used > 10 times successfully, it is flagged for promotion.
2.  **Sanitize (The Janitor)**: A server-side process (LLM + AST parser) analyzes the script:
    *   **PII Check**: Are there hardcoded emails or IDs? (Reject if yes).
    *   **Schema Check**: Does it use standard schema columns or tenant-specific custom fields? (Reject if custom).
3.  **Pull Request**: The Janitor opens a PR to `tgp-global`.
4.  **Review**: A Human Dev (or Senior Agent) merges it.
5.  **Distribute**: Tenant B's agent pulls the latest `main` and now has the capability to analyze regional sales instantly.

## 5.4 The "Pure Function" Law (AST Enforced)

To guarantee Data Sovereignty without a human auditor, the AST Linter enforces **Logic Purity**.

1.  **No String Literals > 16 chars**: Prevents hardcoding CSVs, API keys, or specific customer emails.
    *   *Violation*: `const user = "admin@tesla.com"`
    *   *Allowed*: `const user = args.email`
2.  **No Side Effects**: The Isolation Layer blocks all Network/FS calls not routed through the `tgp` syscall bridge.

**The result:** A tool forged by Tenant A is mathematically incapable of leaking Tenant A's data, because the code cannot contain state, only logic.

# 6. Governance Modes

TGP operates in two distinct modes controlled by `TGP_MODE`.

## 6.1 God Mode (Development)
*   **Behavior**: `Forge -> Compile -> Execute`.
*   **Latency**: Real-time.
*   **Use Case**: Hackathons, rapid prototyping, dev environments.

## 6.2 Gatekeeper Mode (Production)
*   **Behavior**: `Forge -> Compile -> Pull Request`.
*   **The "Human Break"**: The Agent cannot execute a *new* tool until a human (or CI pipeline) approves the signature.
*   **Workflow**:
    1.  User asks: "Analyze cohorts."
    2.  Agent: "Tool missing. I have drafted `cohort-analysis.ts`. Requesting approval."
    3.  Admin clicks "Approve" (GitHub API merge).
    4.  Agent: "Tool merged. Executing now."

# 7. Integration Spec

TGP is designed to drop into any Node.js/TypeScript stack (Next.js, Express, NestJS) via a single CLI command. It bootstraps the "OS" and teaches your existing AI tools how to use it.

## 7.1 The Bootstrap (`npx`)

Run this in your project root. It transforms a standard repository into a TGP-enabled environment.

```bash
npx tgp@latest init
```

**The "Wizard" performs 5 atomic actions:**
1.  **Detection**: Scans `package.json` to identify your ORM (Drizzle/Prisma) and database driver.
2.  **Scaffolding**: Creates the `.tgp/` directory structure and `core/` utilities.
3.  **Memory Init**: Runs `git init` inside `.tgp/` (separate from your main repo git).
4.  **Config**: Generates a strongly-typed `tgp.config.ts`.
5.  **Instruction**: Generates `.cursorrules` (or `.windsurfrules`) to align your IDE AI.

## 7.2 Configuration (`tgp.config.ts`)

The wizard generates this file. You review it to define the Sandbox boundaries.

```typescript
import { defineTGPConfig } from '@tgp/core';

export default defineTGPConfig({
  // The Root of the Agent's filesystem
  rootDir: './.tgp',

  // 1. DATA: How the Agent sees your DB
  db: {
    dialect: 'postgres',
    // CRITICAL: Agent imports this to get type definitions
    schemaPath: './src/db/schema.ts', 
    envVar: 'DATABASE_URL'
  },

  // 2. FILESYSTEM: Where the Agent can write
  fs: {
    allowedDirs: ['./public/exports', './tmp'],
    blockUpwardTraversal: true
  },

  // 3. RUNTIME: Whitelisted libraries (No npm install allowed)
  allowedImports: [
    'drizzle-orm', 'date-fns', 'zod', 'csv-stringify'
  ],

  // 4. SYNCHRONIZATION (The Hive Mind)
  upstream: {
    // The central "App Store" repo URL
    remote: process.env.TGP_REMOTE_URL || 'https://github.com/my-org/tgp-global.git',

    // Auth: System-level PAT (Personal Access Token)
    auth: {
      token: process.env.TGP_GIT_TOKEN,
      username: 'tgp-bot' // Commits appear as this user
    },

    // Behavior: defined by the Governance Mode
    // 'direct': Agent pushes to main (God Mode)
    // 'pull-request': Agent pushes branch + opens PR (Gatekeeper Mode)
    pushStrategy: process.env.NODE_ENV === 'production' ? 'pull-request' : 'direct',

    // Frequency: How often to pull new capabilities from the Hive
    pullIntervalSeconds: 300
  }
});
```

## 7.3 The "Brain" Injection (Generated Prompts)

The installer generates a system prompt file (e.g., `.cursorrules`) that instantly upgrades your IDE's LLM into a TGP-compliant engineer.

**File**: `.cursorrules` (or `TGP_SYSTEM_PROMPT.md`)

```markdown
# YOU ARE THE TGP KERNEL

You are not a generic coding assistant. You are an implementation of the **Tool Generation Protocol (TGP)**.

## 1. WHAT IS TGP?
TGP is an architecture where you build your own standard library. instead of writing one-off scripts, you forge reusable CLI tools, verify them, and save them to `.tgp/tools`.

## 2. WHEN TO ACT
- **Reuse**: If the user asks for "User Churn", run `tgp list` first. If `tools/analytics/churn.ts` exists, EXECUTE it. Do not rewrite it.
- **Forge**: If (and only if) no tool exists, create a new one.

## 3. HOW TO FORGE (The Protocol)
1.  **Draft**: Create `temp/draft.ts`.
    - MUST import schema from `src/db/schema.ts` (Dynamic Import).
    - MUST accept inputs via flags (`--days 7`) or JSON args.
    - MUST print final result as JSON to STDOUT.
2.  **Verify**: Run `node .tgp/core/linter.js temp/draft.ts`.
    - If lint fails, FIX IT. Do not complain.
    - If you need docs, call `mcp_lookup`.
3.  **Commit**: Move to `.tgp/tools/<category>/<name>.ts` and commit with a semantic message.

## 4. CONSTRAINTS
- NO `npm install`. Use only whitelisted libs defined in `tgp.config.ts`.
- NO raw SQL strings. Use the Drizzle/Prisma Query Builder for type safety.
- NO hardcoded secrets. Use `process.env`.
```

## 7.4 Runtime Usage (The SDK)

Once initialized, your application interacts with the Agent via the SDK.

```typescript
// src/app/api/agent/route.ts
import { TGP } from '@tgp/core';

export async function POST(req: Request) {
  const { prompt } = await req.json();
  
  // 1. Boot the Kernel
  const agent = new TGP({
    configFile: './tgp.config.ts',
    userContext: { role: 'admin' }
  });

  // 2. Execute (The Agent handles the "Reuse vs Forge" logic internally)
  const response = await agent.process(prompt);

  return Response.json(response);
}
```
````
