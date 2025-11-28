/**
 * A deterministic Mock LLM that implements the Vercel AI SDK LanguageModelV2 interface.
 * Used to verify tool execution without network calls or spies.
 */
export class MockLanguageModelV2 {
  readonly specificationVersion = 'v2';
  readonly provider = 'tgp-mock';
  readonly modelId = 'mock-v2';
  readonly defaultObjectGenerationMode = 'json';
  
  constructor(private queue: Array<(args: any) => any>) {}

  async doGenerate(options: any): Promise<any> {
    const next = this.queue.shift();
    if (!next) {
      const history = options && options.prompt ? JSON.stringify(options.prompt, null, 2) : 'unknown';
      throw new Error(`MockLanguageModelV2: Unexpected call to doGenerate. History: ${history}`);
    }
    return next(options);
  }

  async doStream(): Promise<any> {
    throw new Error('MockLanguageModelV2: doStream is not implemented for this test.');
  }
}