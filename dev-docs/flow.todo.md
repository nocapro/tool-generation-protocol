===

You are the master architect. We are dropping the network security verification as requested and pivoting to **Self-Healing** and **Governance**.

The README writes checks that the current codebase relies on "trust me" to cash. Specifically, the **Gatekeeper Mode** (PR workflows) and the **Self-Healing Loop** (patching broken tools) are documented but not rigorously verified in the E2E suite.

Here is the battle plan to align the E2E suite with the Manifesto.

```yaml
plan:
  uuid: 'verify-readme-promises-v2'
  status: 'todo'
  title: 'Protocol Verification: Governance & Self-Healing'
  introduction: |
    We are hardening the E2E suite to back up the "Manifesto" claims in `README.md`.
    
    Current gaps:
    1. **Gatekeeper Mode**: The README promises a "Pull Request" strategy for production. The current `local` git provider in `src/kernel/git.ts` ignores `writeStrategy`, meaning this critical workflow is untested in our CI/CD pipeline.
    2. **Self-Healing**: The README touts a "Diagnose -> Patch -> Verify" loop. We currently test `apply_diff` on valid code, but we don't verify the actual recovery from a broken state (syntax/logic errors) which is the core value prop of an Agentic runtime.
  parts:
    - uuid: 'verify-governance-mode'
      status: 'todo'
      name: 'Part 1: The Gatekeeper (PR Strategy Simulation)'
      reason: |
        The "Local" git provider is too dumb. It ignores `writeStrategy: 'pr'`, making it impossible to test the "Gatekeeper Mode" without mocking GitHub. We will upgrade the Local backend to support feature branching, enabling us to verify the PR workflow locally.
      steps:
        - uuid: 'upgrade-local-git-backend'
          status: 'todo'
          name: 'Upgrade Local Git Backend'
          reason: |
            Make `src/kernel/git.ts` respect `writeStrategy: 'pr'` even for the `local` provider. It should checkout a new branch (e.g., `tgp/feat-...`) before committing, simulating the production flow.
          files:
            - src/kernel/git.ts
          operations:
            - 'Modify `createLocalGitBackend` in `src/kernel/git.ts`.'
            - 'Inject `writeStrategy` into the local backend scope.'
            - 'Implement logic: If `writeStrategy === "pr"`, generate a branch name (timestamped) and `git checkout -b` before adding/committing.'
            - 'Ensure push logic pushes the *feature branch*, not main.'
        - uuid: 'e2e-governance-test'
          status: 'todo'
          name: 'Scenario: Governance (Gatekeeper Mode)'
          reason: |
            Verify that the Agent respects the `pr` strategy and isolates changes.
          files:
            - test/e2e/scenarios.test.ts
          operations:
            - 'Add "Scenario 12: Governance (Gatekeeper Mode)" to `test/e2e/scenarios.test.ts`.'
            - 'Config: Set `git: { writeStrategy: "pr" }`.'
            - 'Action: Write a new tool `tools/feature.ts`.'
            - 'Assert: The local repo is NO LONGER on `main`.'
            - 'Assert: The local repo IS on a branch matching `tgp/feat-*`.'
            - 'Assert: The `main` branch does NOT contain `tools/feature.ts` (yet).'
      context_files:
        compact:
          - src/kernel/git.ts
          - test/e2e/scenarios.test.ts
        medium:
          - src/kernel/git.ts
          - test/e2e/scenarios.test.ts
          - src/types.ts
        extended:
          - src/kernel/git.ts
          - test/e2e/scenarios.test.ts
          - src/types.ts
          - test/e2e/utils.ts

    - uuid: 'verify-self-healing'
      status: 'todo'
      name: 'Part 2: The Self-Healing Loop'
      reason: |
        The README claims the Agent can "Patch" and "Verify". We need to prove that the Protocol handles the "Red -> Green" transition.
      steps:
        - uuid: 'e2e-self-healing-test'
          status: 'todo'
          name: 'Scenario: Self-Healing (Red-Green-Refactor)'
          reason: |
            Prove that a broken tool can be detected by `check_tool` and fixed by `apply_diff`.
          files:
            - test/e2e/scenarios.test.ts
          operations:
            - 'Add "Scenario 13: Self-Healing (The Fix Loop)" to `test/e2e/scenarios.test.ts`.'
            - 'Step A (Red): Write `tools/broken.ts` with a Syntax Error (e.g., `const x = ;`).'
            - 'Step B (Diagnose): Run `check_tool`. Assert `valid: false`.'
            - 'Step C (Patch): Run `apply_diff` to replace the broken code with valid code.'
            - 'Step D (Verify): Run `check_tool`. Assert `valid: true`.'
            - 'Step E (Execute): Run `exec_tool`. Assert `success: true`.'
      context_files:
        compact:
          - test/e2e/scenarios.test.ts
        medium:
          - test/e2e/scenarios.test.ts
          - src/tools/validation.ts
        extended:
          - test/e2e/scenarios.test.ts
          - src/tools/validation.ts
          - src/tools/fs.ts

  conclusion: |
    By implementing these scenarios, we move "Governance" and "Self-Healing" from marketing claims to tested features. The upgrade to the Local Git Backend also makes the development environment a truer simulation of production.
  context_files:
    compact:
      - src/kernel/git.ts
      - test/e2e/scenarios.test.ts
    medium:
      - src/kernel/git.ts
      - test/e2e/scenarios.test.ts
      - src/tools/validation.ts
    extended:
      - src/kernel/git.ts
      - test/e2e/scenarios.test.ts
      - src/tools/validation.ts
      - src/types.ts
      - src/tgp.ts
```
=== DONE

how do I know all test pass within docker? I just hate if the host test says pass when within docker there is single fail test 

=== DONE

implement apply-multi-diff

=== DONE

we need test cases that runs docker containers to see wether the npm published tgp version has all passed tests. because I dont want to say "it works on my machine" when npm devs user submit issues.

so my idea is;

1. create the test cases that real use docker containers and exec bash
2. inside the container, install the tgp npm version
3. copy host test/ dir to the container
4. make the copied test/ container import from published npm version 
5. run test within container, if fail detected then host test fail with knowing what fails

=== DONE

prepare for npm publication, along with tsup, but url not available, already taken by https://www.npmjs.com/package/tgp

=== DONE

we need test cases to verify end to end typesafety like tgpTools from '@tgp/core' accepted by import { generateText } from 'ai';

and many cases

=== DONE

lets ditch vitest with bun:test for performance

=== 

is the test/e2e/ cases already verify expectations of readme.md

execute all parts in single trx. also make sure to follow 5 test rules while also doing fixes without bandaids fake fixing... should has architectural paradigm

===

make sure to follow 5 test rules while also doing fixes without bandaids fake fixing... should has architectural paradigm 

===

lets implement e2e.test-plan.md to test/e2e/

=== DONE

create e2e.test-plan.md, integration.test-plan.md, unit.test-plan.md plan based on readme.md

well, I want it to be more comprehensive especially the e2e. 

also test rule codebase should be;

1. no mock, no spy
2. all real implementation to verify implementation
3. isolated
4. idempotent
5. clean even on sigterm

=== DONE

spot any unimplemented, todo, stub, placeholder etc... we need production ready codebase

analyse codebase to spot mock, unimplemented, todo, stub, placeholders.. because I want production ready

=== DONE

Lets achieve readme.md requirements compliance

Lets achieve readme.md requirements and expectations compliance and production ready codebase

=== DONE

lets bring readme.md into production ready manifestation by developing codebase. I want HOFs, no OOP or classes, no casting as any or unknown. all should follows readme.md requirements

=== DONE

give me diff patches fixing readme.md to achieve the goals and phylosohpy by eliminating inconsistencies

===

is tgp serverless friendly like cloudflare? as it rely on git so should leverege github where auto pull push right? why not asking github creds in the config

===

make the agent produce code quality:
1. abstract
2. composable
3. HOFs
4. stateless
5. reusable
6. general by params
7. no hardcoded values
8. can also orchesstrate or import from existing functions

also the agent need to has certain tools and capabilities like list_files, read, write, search_replace, etc
