import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { generateText } from 'ai';
import { createTempDir, createTgpConfig, cleanupDir, initBareRepo } from '../e2e/utils.js';
import { TGP } from '../../src/tgp.js';
import { tgpTools } from '../../src/tools/index.js';
import { MockLanguageModelV2 } from '../fixtures/fake-model.js';

describe('Integration: Vercel AI SDK Compatibility', () => {
  let tempDir: string;
  let remoteRepo: string;

  beforeEach(async () => {
    tempDir = await createTempDir('tgp-int-vercel-');
    remoteRepo = await createTempDir('tgp-remote-');
    await initBareRepo(remoteRepo);
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
    await cleanupDir(remoteRepo);
  });

  it('End-to-End: generateText executes TGP tools correctly', async () => {
    // 1. Setup Kernel
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();

    // 2. Prepare Toolset
    const tools = tgpTools(kernel);

    // 3. Setup Fake Model Interaction
    // The interaction simulates:
    // Turn 1: Model receives user prompt -> Calls 'write_file'
    // Turn 2: Model receives tool result -> Returns final text
    const mockModel = new MockLanguageModelV2([
      // Response 1: Request Tool Execution
      () => ({
        rawCall: { raw: 'call' },
        finishReason: 'tool-calls',
        usage: { promptTokens: 10, completionTokens: 10 },
        toolCalls: [
          {
            toolCallType: 'function',
            toolCallId: 'call_1',
            toolName: 'write_file',
            // Vercel SDK expects args as a JSON string
            args: JSON.stringify({ path: 'tools/hello-vercel.ts', content: 'export default "compat"' }),
          }
        ]
      }),
      // Response 2: Final Summary
      (opts) => {
        // Assert that the SDK fed the tool result back to the model
        const lastMsg = opts.prompt[opts.prompt.length - 1];
        if (lastMsg.role !== 'tool' || lastMsg.content[0].type !== 'tool-result') {
          throw new Error('Expected last message to be a tool result');
        }
        
        return {
          rawCall: { raw: 'response' },
          finishReason: 'stop',
          usage: { promptTokens: 20, completionTokens: 5 },
          text: 'File created successfully.'
        };
      }
    ]);

    // 4. Execute using Vercel AI SDK
    const result = await generateText({
      model: mockModel,
      tools: tools, // Type Check: This must compile
      maxSteps: 2,  // Allow tool roundtrips
      prompt: 'Create a file named tools/hello-vercel.ts',
    });

    // 5. Verify Results
    expect(result.text).toBe('File created successfully.');
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0].toolName).toBe('write_file');

    // 6. Verify Side Effects (Real Filesystem Check)
    // The VFS root is at .tgp inside tempDir (configured by createTgpConfig)
    const targetFile = path.join(tempDir, '.tgp/tools/hello-vercel.ts');
    const exists = await fs.access(targetFile).then(() => true).catch(() => false);
    
    expect(exists).toBe(true);
    
    const content = await fs.readFile(targetFile, 'utf-8');
    expect(content).toBe('export default "compat"');
  });
});