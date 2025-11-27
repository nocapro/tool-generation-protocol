  # 1. Manifesto
  
  # Table of Contents
  
  1. [Manifesto](#1-manifesto)
    - [Use Cases](#11-the-long-tail-problem-use-cases)
  2. [Architecture](#2-architecture)
  3. [The Protocol](#3-the-protocol)
  4. [Security (The Sandbox)](#4-security-the-sandbox)
  5. [The Ecosystem (Join the Hive)](#5-the-ecosystem-join-the-hive)
  6. [Governance Modes](#6-governance-modes)
  7. [Integration Spec](#7-integration-spec)
8. [Roadmap & Contributing](#8-roadmap--contributing)
  
  **The Self-Assembling Backend.**
  
  Your users want features faster than you can build endpoints. TGP (Tool Generation Protocol) allows your AI to write its own API on the fly, safely.

**The Problem:** You are exhausted. You spend 80% of your time writing "glue code"—RPCs, CRUD wrappers, and slightly different versions of the same "Export to CSV" function.
**The Solution:** Stop writing glue. Give the Agent a compiler.

TGP is not just a protocol; it's a **JIT Runtime for Business Logic**. The Agent builds its own tools, caches them, and builds a personalized standard library for your application.
  
  **MCP is just a legacy pattern.** It is rigid, server-heavy, and fragile. If you didn't write an endpoint for "Export to PDF centered on the Y-axis," the agent fails.
  
  **TGP (Tool Generation Protocol)** inverts this.
  We do not give the agent a fish; we give it a compiler.
  
  ## 1.1 The "Long Tail" Problem (Use Cases)
  
  Why treat the Agent as a developer? Because **99% of software features are never built** because they are too specific to a single user. TGP solves the "I wish the app could do X" problem.
  
  ### Scenario A: The "Impossible" Report
  *   **User**: "I need a list of users who bought 'Pro' in May but downgraded in June, formatted as a pipe-delimited list for my legacy ERP."
  *   **Standard AI**: "I cannot do that. I can only call `getUsers()` or `getBillingHistory()` separately. I cannot join them or format pipes."
  *   **TGP Agent**: Forges `tools/reports/downgrade_pipe.ts`. It writes a raw SQL JOIN, iterates the stream, formats the string, and outputs the file. **Time: 4 seconds.**
  
  ### Scenario B: The Bulk Janitor
  *   **User**: "Fix the typo in 'Ohiio' for all shipping addresses, but only for active subscriptions."
  *   **Standard AI**: "I can't iterate 50,000 records via chat. It would cost $500 in tokens and timeout."
  *   **TGP Agent**: Forges `tools/maintenance/fix_ohio.ts`. It executes a single `UPDATE ... WHERE` statement inside a transaction. **Cost: $0.01. Data Risk: Zero (Rollback on error).**
  
  ### Scenario C: The Feature Request Killer
  *   **User**: "Can we calculate 'User Karma' based on (Comments * 2) + Likes?"
  *   **Standard AI**: "That logic doesn't exist. Ask the developers to add it to the Q3 Roadmap."
  *   **TGP Agent**: Forges `tools/scoring/calc_karma.ts`. You have the feature **now**. It calculates it on-the-fly using the database.
  
  ### Scenario D: The API Chain-Reaction (Integration)
  *   **User**: "Check our Stripe disputes. If any are > $500, fetch the customer's phone number from Salesforce and post it to the #risk-team Slack."
  *   **Standard AI**: "I can't hold context across three different API docs and authentications safely."
  *   **TGP Agent**: Forges `tools/risk/escalate.ts`. Marks tool as `sideEffect: true`. Chains API calls synchronously via the `fetch` bridge. Note: External API calls cannot be rolled back; logic must be defensive.
  
  ### Scenario E: The "Math Safeguard" (Pure Logic)
  *   **User**: "Calculate the volumetric weight for these 10,000 SKUs using the FedEx formula `(L*W*H)/139`, but cap it if `L > 48`."
  *   **Standard AI**: (Hallucinates the math) "The answer is 42." (LLMs are bad at arithmetic).
  *   **TGP Agent**: Forges `tools/shipping/calc_dim.ts`. It compiles the formula using `BigInt` for currency. The V8 engine ensures **Deterministic Execution** (it will never hallucinate a different answer for the same input).
  
  1.  **Just-in-Time Compilation**: The agent is not limited to your API endpoints. If a user needs a specific data transformation, the agent **writes the code**, validates it, and runs it.
  2.  **Zero-Gen Execution**: Once forged, the tool is compiled and stored in an in-memory **LRU Cache** (Least Recently Used). Hot tools run instantly; cold tools incur a <5ms recompilation penalty. Invoking it costs **0 generation tokens**.
  3.  **Agent as OS**: The SaaS application is not a GUI; it is a kernel. The Agent is the Operating System. The Tools are the coreutils. The User is the Admin.
  4.  **SQL as Assembly**: ORMs are abstraction taxes for humans. LLMs speak native SQL. We strip the VM to the metal (~1MB), inject a raw SQL bridge, and rely on host-level transaction rollbacks for safety. The Agent is the Query Builder.
  
  We are building a self-extending runtime where the software writes itself in response to user intent. **Stop building endpoints. Start building sandboxes.**
  
  
  ## 1.2 Anti-Patterns (What TGP is NOT)

TGP is a **Just-In-Time Compiler**, not a Daemon. If you try to do these, you are fighting the architecture.

*   **Not a Server**: Tools cannot run `express.listen()` or keep sockets open. They are ephemeral (Lambda-style). They boot, calculate, flush, and die in milliseconds.
*   **Not a Browser**: Isolates have no DOM. You cannot run Puppeteer or Playwright here. If you need to scrape, the Agent must forge a tool that calls an external scraping API (e.g., Firecrawl).
*   **Not a UI Generator**: TGP generates *logic*, not *pixels*. It returns JSON, CSV, or Text. It does not write React components or CSS.
*   **Not a GPU**: Do not try to run PyTorch or video rendering inside the V8 Isolate. The "Math Safeguard" is for invoicing logic, not matrix multiplication.
*   **Not an ORM**: Do not fetch data, modify it in JS, and save it back (`user.balance += 10`). This causes race conditions.
    *   **Bad**: `const u = sql(get); u.bal++; sql(update, u.bal)`
    *   **Good**: `sql('UPDATE users SET balance = balance + 1 WHERE id = ?')` (Atomic SQL).


# 2. Architecture (The Stack)
  
  TGP drops into your existing Node/Next.js/Nest apps. It is **just TypeScript**. If you can write a serverless function, you can debug a TGP tool.
  
  ## 2.1 The Developer View
  
  The agent views `./.tgp` as its root directory (Git Repo).
  
  ```bash
  ./.tgp/
  ├── .git/                  # MEMORY: Version history of TOOL SOURCE CODE only.
  ├── bin/                   # KERNEL: The compiled 'tgp' binary
  ├── tools/                 # USER SPACE: Generated capabilities (Read-Write)
  │   ├── analytics/         # e.g., "churn-prediction.ts"
  │   └── reports/           # e.g., "revenue-csv.ts"
  └── meta.json              # REGISTRY: Fast lookup index
  ```
  
  ## 2.2 The VFS (Virtual Filesystem)
  TGP enforces a strict separation between **The Editor (Host)** and **The Runtime (Sandbox)**.

  1.  **The Editor (Agent Context)**: The Agent accesses `./.tgp` directly via `tgpTools`. It works just like a human dev using VS Code. It can read, write, and patch source files on the Host disk.
  2.  **The Runtime (Sandbox Context)**: When code *executes*, it runs inside the V8 Isolate. The Isolate sees a restricted VFS:
      *   **`/lib`**: Read-Only mount of Host's `./.tgp/tools`.
      *   **`/tmp`**: Read-Write ephemeral scratchpad (wiped on exit).
      *   **`require()`**: Custom syscall. Loads local tools only.
  
  ## 2.3 The Kernel (Library vs CLI)

  TGP operates in two contexts:

  1.  **Runtime (`@tgp/core`)**: In production, the Host imports the Kernel library. It manages a **Worker Thread Pool**. Each tool runs inside a Worker to allow `Atomics.wait` bridging without blocking the Host's main event loop.
  2.  **Dev Tools (`tgp` CLI)**: A wrapper around the core for humans to debug, lint, and manage the registry manually.

  *   **Execution Flow**:
      1.  **JIT Lint**: Kernel parses AST for forbidden nodes (e.g., `process.exit`).
      2.  **Transpile**: Compiles TS to JS in <5ms using embedded `swc` (cached in memory).
      3.  **Isolate Pool**: Reuses warmed-up V8 contexts from the pool (Zero-startup).
      4.  **Injection**: Injects `TGP_CONFIG` and bridged syscalls.
  *   **`tgp check <script>`**:
      *   Explicit dry-run verification (used during the "Forge" phase) without executing logic.
  *   **`tgp fs <cmd> [args]`**:
      *   **Introspection Tools** for the Agent to understand existing capabilities:
      *   `ls <path>`: List available tools in `.tgp/`.
      *   `cat <path>`: Read source code (to learn patterns or import signatures).
      *   `grep <pattern>`: Search for reusable logic.
      *   `patch <file> <diff>`: Apply surgical edits (Search/Replace).
  
  ## 2.4 The Interface Layer (Headless)
  The Agent does not require a TTY. TGP provides **Native Bindings** for the Host Application.
  *   **Human Interface**: `bash` terminal -> `tgp` CLI.
  *   **Agent Interface**: JSON Tool Calls -> `TGP SDK` -> `tgp` CLI.
  
  The SDK acts as the **shell adapter**. When the Agent invokes `function: forge_tool`, the SDK executes `tgp check` in the background and returns the `stderr` output as the tool result.
  
  ## 2.3 Configuration Injection (`TGP_CONFIG`)
  
  The Host Application injects a read-only configuration object acting as the **Hardware Abstraction Layer (HAL)**.
  
  Instead of hardcoding paths or connection strings, the Agent reads from this injected state to understand its environment (Database dialect, allowed read/write paths, and whitelisted libraries).
  
  *See [Configuration](#72-configuration-tgpconfigts) for the full schema.*
  
  # 3. The Protocol
  
  This is the algorithm the Agent must follow. It is the "software" running on the Agent's "CPU". The goal is to minimize token usage while maximizing capability evolution.
  
  ## 3.1 The Prime Directive: "Reuse or Forge"
  
  The Agent is forbidden from executing one-off scripts for repetitive tasks. It must decide between **Reusing** an existing tool or **Forging** a new one.
  
  ### Phase 1: Lookup (Zero Token Cost)
  Before acting, the Agent queries its tool registry.
  ```bash
  tgp search "revenue report excluding churned users"
  # Output: Rank 1: tools/analytics/net_revenue.ts (Score: 0.89)
  # Output: tools/analytics/revenue-report.ts (v0.2 - "Generates monthly CSV")
  ```
  *   **Hit**: If Score > 0.85, Proceed to **Phase 4 (Execution)**.
  *   **Miss**: Proceed to **Phase 2 (Forge)**.
  
  ### Phase 2: Forge (High Token Cost)
  The Agent writes a new tool to fill the gap.
  1.  **Discovery**: `tgp_inspect_schema(...)`.
  2.  **Draft**: Agent calls `tgp_fs_write('tools/analytics/churn.ts', content)`.
      *   **Constraint**: The Agent writes directly to the Host repo.
  3.  **Verify**: Agent calls `tgp_check('tools/analytics/churn.ts')`.
      *   **Static**: Kernel runs JIT Lint/Compiler.
      *   **Runtime**: Kernel runs dry-run execution in the Sandbox.
      *   **Feedback**: If verification fails, the Agent receives `stderr` and uses `tgp_fs_patch` to fix the code in place.
  
  ### Phase 3: Persistence (Temporal Memory)
  Once verified, the Agent commits the work.
  *   **Action**: `tgp_git_commit('feat: add churn metric')`
  *   **Effect**: The tool is now immutable history in `.tgp/.git`.
  
  ### Phase 4: Execution (Native Speed)
  The Agent invokes `tgp_exec`.
  *   **Input**: `{ "script": "tools/analytics/revenue.ts", "args": { "month": "2023-10" } }`
  *   **Action**: SDK runs `tgp run ...` inside the V8 Isolate.
  
  ## 3.2 The Feedback Loop (Self-Healing)
  
  If a tool fails during [Phase 4](#phase-4-execution-native-speed):
  1.  **Capture**: Agent reads STDERR.
  2.  **Sanitize**: The Kernel redacts PII from the error trace, providing only the **Type Shape** of the failing row (e.g., `{ email: <Redacted String>, age: <Null> }`).
  3.  **Diagnose**: Agent identifies that `age` was null but code didn't handle it.
  4.  **Refactor**:
      *   Agent creates `fix/revenue-report` branch.
      *   Patches code.
      *   Runs `tgp check`.
  4.  **Patch**: `tgp publish ... --message "fix: handle null values"`
  
  ## 3.3 Documentation Strategy
  
  The Agent treats external documentation as a **Level 2 Resource**.
  1.  **Level 0 (Internal)**: Logic derived from training data.
  2.  **Level 1 (Codebase)**: Logic derived from reading `git show` of existing tools.
  3.  **Level 2 (External)**: Logic derived from MCP/Context7 (e.g., "Latest Drizzle docs").
  
  *The Protocol dictates that Level 2 is only accessed if Level 0 and 1 fail validation.*
  
  ## 3.4 Schema Entropy
  Tools are compiled against a specific DB schema snapshot.
  *   **Dependency Graph**: During compilation, TGP maps tools to tables (e.g., `revenue.ts` -> `[orders, users]`).
  *   **Surgical Invalidation**: When the schema changes, TGP only marks tools touching altered tables as `dirty`.
  *   **Lazy Re-Forge**: Dirty tools are not rebuilt immediately. They are rebuilt JIT upon their next specific invocation, spreading the compute load.
  
  # 4. Security (The Sandbox)
  
  *Detailed security specs (V8 Isolates, syscall bridging, and memory pointers) are available in [ARCHITECTURE.md](ARCHITECTURE.md).*

**TL;DR:**
1.  **Zero-Trust**: Tools run in a stripped V8 context. No `process`, no `fs`, no `eval`.
2.  **Resource Caps**: 64MB RAM, 50ms CPU time. Infinite loops die instantly.
3.  **Transaction Safety**: All DB writes run inside a transaction. If the tool throws, the DB rolls back.
  
  ## 2.2 The VFS (Virtual Filesystem)
  
  The Agent sees a restricted VFS.
*   **`/lib`**: Read-Only mount of Host's `./.tgp/tools` (Standard Library).
*   **`/tmp`**: Ephemeral scratchpad.
*   **`require()`**: Custom syscall. Loads local tools only. `require('tools/math')` works. `require('lodash')` triggers SIGKILL.

**The Great Wall**:
  *   **The Agent (Host)**: Can write to `./.tgp/tools` via `tgpTools` (IDE Mode).
  *   **The Tool (Guest)**: Can **NEVER** write to `./.tgp/tools`. The Sandbox filesystem is read-only.
  *   **Result**: A compromised tool cannot rewrite itself or other tools. Only the Agent (acting as Admin) can modify the codebase.
  
  TGP uses **`isolated-vm`**, which is **The Vault**.
  
  ### Why `isolated-vm` Over Alternatives
  
  **Not Child Processes**: Node.js provides no true isolation. Processes inherit OS privileges, leak environment variables, and spawn in 100ms+ with MBs of overhead. `isolated-vm` creates true V8 contexts with <5ms startup and baked-in resource quotas.
  
  **Not Docker**: Containers weigh 100s of MB and take seconds to boot—unacceptable for JIT tool execution. They can't share V8 heap snapshots or provide the fine-grained syscall bridge TGP's ABI requires.
  
  **Not External (e.g., E2B)**: Outsourcing execution adds 100ms+ network latency per call, violates data sovereignty, and introduces vendor lock-in. TGP runs inside your infrastructure; tool execution cost is fixed, not per-call.
  
  | Metric | isolated-vm | Child Process | Docker | External |
  |--------|-------------|---------------|--------|----------|
  | Startup | <5ms | 100ms+ | Seconds | 100ms+ |
  | Memory/isolate | ~1MB | ~10MB | ~100MB | External |
  | Resource Limits | V8 heap | OS cgroups | OS cgroups | Vendor |
  | Network | None | None | None | Required |
  | Sovereignty | 100% local | 100% local | 100% local | External trust |
  
  The `tgp` binary is a hypervisor: it loads a shared V8 snapshot, spawns isolates, injects the HAL config, and bridges syscalls. This makes tool execution cheaper than a function call and safer than a network request.
  
  1.  **Separate Heaps**: The Agent cannot access Host memory, even by accident.
  2.  **Separate GC**: Garbage collection in a tool does not pause the Host.
  3.  **Sync-within-Async**: The Agent writes synchronous code (`const rows = sql(q)`).
    *   **Mechanism**: The Tool runs in a dedicated **Worker Thread**.
    *   **Bridge**: The Isolate uses `Atomics.wait` on a `SharedArrayBuffer` to pause the Worker (cheap) while the Main Thread handles the async I/O (DB/Fetch), preventing Event Loop starvation.
  
  *   **True Isolation**: Tools cannot access the host `process` object, `require`, or the filesystem.
  *   **The Syscall Bridge**: Tools interact with the world ONLY through the injected `tgp` global object (the stable ABI).
  *   **The SQL Bridge**: We do not load ORMs (Drizzle/Prisma) into the isolate.
      *   **Host**: Exposes `jail.setSync('sql', (query) => tx.execute(query))`
      *   **Guest**: Agent calls `const rows = sql(query)`. No `await`, no callbacks.
      *   **Safety**: The Host leases a DB Client, starts a Transaction, and holds it open for the duration of the tool (max 30s).
      *   **Constraint**: High-latency tools (e.g., waiting on external APIs) will block a DB connection. TGP enforces aggressive timeouts to prevent pool exhaustion.
  *   **Zero-Dependency**: The VM starts empty (~1MB RAM). Startup time is **< 2ms**.
  
  ## 4.2 The Serialization Wall
  `isolated-vm` prevents direct object passing. You cannot pass a Host Object to the Guest.

**The Reference Protocol (Cursors):**
For large datasets, we do not serialize the whole array.
1.  **Host**: Returns a `ReferenceID` (Pointer) to the DB Cursor.
2.  **Guest**: Calls `cursor_next(refID)`.
3.  **Bridge**: Passes only one row at a time across the boundary.

*This prevents the 64MB memory limit from killing large reports.*
  
  **The Marshalling Protocol:**
  1.  **Guest**: Serializes arguments to string (`JSON.stringify([email])`).
  2.  **Bridge**: Passes string across the C++ boundary.
  3.  **Host**: Parses string, executes SQL, serializes result.
  4.  **Guest**: Parses result.
  
  *This overhead is negligible compared to the safety guarantees.*
  
  ## 4.2.1 The Module Resolution (Cycle Detection)
  The Kernel maintains a `moduleMap` per Isolate.
  *   **Cache**: `require('x')` returns the memoized exports if previously loaded.
  *   **Cycles**: Circular dependencies throw a `RUNTIME_ERROR` immediately to prevent stack overflow in the bridge.

  ## 4.3 Resource Quotas
  To prevent infinite loops (`while(true)`) or memory leaks from crashing the tenant pod, the Kernel applies V8 and OS-level limits per execution.
  
  | Resource | Limit | Mechanism | Violation Result |
  | :--- | :--- | :--- | :--- |
  | **Wall Time** | 30 Seconds | `setTimeout(kill, 30000)` | `SIGTERM` + "TIMEOUT_EXCEEDED" |
  | **Memory** | 64 MB | `new ivm.Isolate({ memoryLimit: 64 })` | `SIGABRT` + "OOM" |
  | **CPU** | Low Priority | `nice` level 10 | Execution throttled if host busy |
  | **Processes** | 0 Children | Disallow `fork`/`spawn` inside tools | `EPERM` (via AST Linter) |
  
  ## 4.3 Filesystem Jail
  The Kernel intercepts all I/O operations.
  *   **Read-Only**: Default state for the entire project.
  *   **Write-Allow**: Only paths explicitly listed in `fs.allowedDirs` (defined in setup).
  *   **Path Traversal**: Any argument containing `../` that resolves outside the jail triggers an immediate `SECURITY_VIOLATION` before code execution starts.
  
  ## 4.4 Environment Sanitization (Scorched Earth)
  Tools do **not** inherit the Host environment.
  1.  **Strip**: The `env` object starts empty.
  2.  **Inject**: The Kernel injects *only* the specific keys defined in the config (e.g., `DATABASE_URL`).
  3.  **Block**: Sensitive keys (`AWS_SECRET_ACCESS_KEY`, `SSH_AUTH_SOCK`) are aggressively filtered out unless a specific "Integration Tool" is authorized to use them.
  
  ## 4.5 Network Firewall
  *   **Default**: Block all outbound HTTP/TCP.
  *   **Allowlist**: If a tool requires API access (e.g., Stripe), the specific domain must be whitelisted in `meta.json` and the tool must use the project's pre-approved Axios/Fetch instance, not a raw socket.
  *   **Implementation**: `global.fetch` is injected by the bridge. It is a synchronous wrapper around the Host's `fetch`.
  *   **Safety**: To prevent Worker Starvation, the bridge enforces a **5000ms Hard Timeout** on all network calls. If Stripe hangs, the Tool dies instantly, freeing the thread.
  
  # 5. The Ecosystem (Join the Hive)
  
  We are building the **`libc` of the AI Age**.

Every TGP Agent starts with a blank slate, but it shouldn't have to relearn how to calculate "Net Promoter Score" or "Stripe MRR."

### 5.1 The `tgp-std` Library
We are crowdsourcing verified, stateless tool definitions.
*   **Host Installation**: You (the Dev) run `npm install @tgp/std-saas`.
*   **Guest Injection**: In `tgp.config.ts`, you whitelist these libs. The Kernel snapshots them into the V8 context at boot.
*   **Agent Usage**: The Agent uses `require('@tgp/std/v1')`. We enforce **Immutable Exports**. New features go to `v2`, ensuring legacy tools generated months ago never break.

**Module System**: The V8 Isolate uses a synthetic CommonJS loader. Agents use `require()` for imports and `export default function` for the entry point. The Kernel handles the interoperability.
  
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
  *   **Downstream (`./.tgp`)**: The Tenant's localized toolkit. It clones `tgp-global` at boot.
  
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
  
  1.  **Argument Enforced State**:
    *   *Violation*: `const target = "Ohiio"` (Hardcoded state).
    *   *Allowed*: `const target = args.typoString` (Abstract logic).
    *   *Linter*: Warns on string literals that resemble emails, UUIDs, or Credit Cards.
  2.  **Export Required**: The AST must contain a default export.
  3.  **Arity Check**: The exported function must accept exactly two arguments: `(params, context)`.
      *   **Time Injection**: `context.now` (Date) is provided by the Kernel.
      *   **Violation**: `const today = new Date()` (Impure, hard to test).
      *   **Allowed**: `const today = context.now`.
      *   *Violation*: `const user = "admin@tesla.com"`
      *   *Allowed*: `const user = args.email`
  2.  **No Side Effects**: Enforced by [Security Kernel](#4-security-kernel).
  
  **The result:** A tool forged by Tenant A is mathematically incapable of leaking Tenant A's data, because the code cannot contain state, only logic.
  
  # 6. Governance Modes
  
  TGP operates in two distinct modes controlled by `TGP_MODE`.
  
  ## 6.1 God Mode (Development)
  *   **Behavior**: `Forge -> Compile -> Execute`.
  *   **Latency**: Real-time.
  *   **Use Case**: Hackathons, rapid prototyping, dev environments.
  
  ## 6.2 Gatekeeper Mode (Production)
  *   **Behavior**: `Forge -> Compile -> Pull Request`.
  *   **Heuristic Governance**:
      *   **Read-Only Tools**: (e.g., Reports) AST verifies 0 side-effects. **Auto-Approved** for immediate execution. PR opened in background for persistence.
      *   **Mutating Tools**: (e.g., Bulk Updates) **Blocked**. Agent requests approval.
  *   **Workflow**:
      1.  User asks: "Fix typos."
      2.  Agent: "I have drafted `fix_typos.ts` (Risk: High). Sent to Slack for approval."
      3.  Admin clicks "Approve" (Webhook).
      4.  Agent: "Approval received. Executing."
  
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
  3.  **Memory Init**: Runs `git init` inside `.tgp/` and adds `.tgp/` to your root `.gitignore`. This ensures the Agent's self-modifying history doesn't pollute your main branch.
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
      // STRATEGY: RAG or Introspection.
      // Agent calls `tgp_get_schema({ tables: ['users'] })` to reduce token tax.
      // Accepts file path OR command string.
      ddlSource: process.env.CI ? './schema.sql' : 'drizzle-kit generate --print',
    },
  
    // 2. FILESYSTEM: Where the Agent can write
    fs: {
      allowedDirs: ['./public/exports', './tmp'],
      blockUpwardTraversal: true
    },
  
    // 3. RUNTIME: Zero Dependencies.
    // The Agent uses native JS and the injected `sql()` function only.
    allowedImports: [],
  
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
  
  The installer generates a system prompt file (e.g., `.cursorrules`) that enforces the [Protocol](#3-the-protocol).
  
  **File**: `.cursorrules` (or `TGP_SYSTEM_PROMPT.md`)
  
  ```markdown
  # YOU ARE THE TGP KERNEL
  
  You are not a generic coding assistant. You are an implementation of the TGP Architecture.
  
  ## 1. WHAT IS TGP?
  TGP is an architecture where you build your own standard library. instead of writing one-off scripts, you forge reusable CLI tools, verify them, and save them to `.tgp/tools`.
  
  ## 2. WHEN TO ACT
  - **Reuse**: If the user asks for "User Churn", run `tgp list` first. If `tools/analytics/churn.ts` exists, EXECUTE it. Do not rewrite it.
  - **Forge**: If (and only if) no tool exists, create a new one.
  
  ## 3. HOW TO FORGE (The Protocol)
  1.  **Draft**: Create `temp/draft.ts`.
      - **NO NPM INSTALL**: You cannot access the internet.
      - **WHITELIST IMPORTS**: Use `require()` only for `tools/*` or libraries explicitly listed in your config context (e.g., `@tgp/std`).
      - **RAW SQL**: Use the global `sql(query, params)` function. IT IS SYNCHRONOUS. DO NOT AWAIT.
      - **SCHEMA**: Refer to the `CREATE TABLE` definitions provided in context.
      - **OUTPUT**: Print final result as JSON to STDOUT.
      - **STYLE**: Functional, Stateless, Abstract.
  
      ## CODE SKELETON
      ```typescript
      // BAD: Top level execution
      // const res = sql(...)
      // console.log(res)
  
      // GOOD: Higher Order Function
      export default function run({ userId, dateRange }: Props, { sql, fetch }: Context) {
        // 1. Validation
        if (!userId) throw new Error("Abstract params required");
  
        // 2. Execution
        const rows = sql("SELECT * FROM events WHERE u = $1", [userId]);
  
        // 3. Pure Transformation
        return rows.map(r => normalize(r));
      }
      ```
  2.  **Verify**: Run `tgp check temp/draft.ts`.
      - If lint fails, FIX IT. Do not complain.
  3.  **Commit**: Move to `.tgp/tools/<category>/<name>.ts` and run `git add . && git commit`.
  
  ## 4. CONSTRAINTS
  - NO `npm install` or `require`.
  - NO ORMs. You are the Query Builder.
  - NO transactions (BEGIN/COMMIT). The Host handles the transaction scope.
  ```
  
  ## 7.4 Runtime Usage (The SDK & Tool Bridge)
  
  Once initialized, your application interacts with the Agent via the SDK.
  
  ```typescript
  // src/app/api/agent/route.ts
  import { TGP, tgpTools } from '@tgp/core';
  import { generateText } from 'ai';
  import { openai } from '@ai-sdk/openai';
  
  // 1. Initialize Kernel
  const kernel = new TGP({
    configFile: './tgp.config.ts',
    userContext: { role: 'admin' }
  });
  
  export async function POST(req: Request) {
    const { messages } = await req.json();
  
    // 2. Inject Capabilities
    // TGP automatically generates the JSON Schema for:
    // - tgp_fs_list      (ls)
    // - tgp_fs_read      (cat)
    // - tgp_fs_write     (write file to .tgp/)
    // - tgp_fs_patch     (search/replace)
    // - tgp_check        (compile & dry-run)
    // - tgp_exec_tool    (run inside sandbox)
    const result = await generateText({
      model: openai('gpt-4-turbo'),
      tools: tgpTools(kernel), // <--- THE BRIDGE
      maxSteps: 5, // Allow Agent to "Reason -> Forge -> Fix -> Run"
      messages,
      system: TGP_SYSTEM_PROMPT // From Section 7.3
    });
  
    return result.response;
  }
  
  // INTERNAL: The Guest Bootstrap (Injected by Kernel)
  // This runs inside the Isolate before the Agent's code.
  const bootstrap = `
    // The Bridge is a raw Reference function injected by Host
    // It only accepts strings. We wrap it to look like a normal object.
    global.sql = function(query, params) {
      const paramsStr = JSON.stringify(params || []);
      // applySync blocks the Guest, allowing Host to run async DB call
      const resultStr = bridge.applySync(undefined, [query, paramsStr]);
      return JSON.parse(resultStr);
    };
  
    // Network Bridge (Whitelist enforced by Host)
    global.fetch = function(url, options) {
      const resStr = bridge.applySync(undefined, ['fetch', url, JSON.stringify(options)]);
      return JSON.parse(resStr);
    };
  
    // The Orchestration Bridge
    global.require = (path) => {
      // Calls back to Host -> reads file -> compiles TS -> executes in this Context -> returns exports
      const moduleStr = bridge.applySync(undefined, ['require', path]);
      return evalModule(moduleStr); // TGP internal eval wrapper
    };
  
    // Creating the illusion of a standard environment
    global.console = { log: (msg) => logBridge.applyIgnored(undefined, [String(msg)]) };
  `;
  ```
# 8. Roadmap & Contributing

We are hacking on the future of backend development. We need **Rustaceans**, **TypeScript Wizards**, and **Prompt Engineers**.

*   **[P0] The LSP**: An IDE extension so you can see the tools the Agent is forging in real-time.
*   **[P1] Vector Memory**: Moving from `git grep` to vector-based tool retrieval.
*   **[P2] Multi-Lang**: Support Python (via WebAssembly) for data-science heavy tools.

**Get Involved:**
`git clone` -> `npm install` -> `npm run forge`.