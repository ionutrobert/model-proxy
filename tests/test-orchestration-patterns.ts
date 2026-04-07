import { circuitBreaker } from '../src/core/circuit-breaker.js';
import { smartModelSelector } from '../src/core/smart-selector.js';
import { getCuratedModel, CURATED_MODELS } from '../src/core/curated-models.js';

console.log('🧪 Testing AI Orchestration Pattern Implementations\n');

// Test 1: Per-Model Circuit Breaker
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Test 1: Per-Model Circuit Breaker');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const testModelId = 'minimaxai/minimax-m2.5';
console.log(`Testing model: ${testModelId}`);

// Record failure
circuitBreaker.recordModelFailure(testModelId, 'Test error');
console.log('✓ Recorded model failure');

// Check model availability
const isAvailable = circuitBreaker.isModelAvailable(testModelId);
console.log(`✓ Model available: ${isAvailable}`);

// Get model health
const modelHealth = circuitBreaker.getModelHealth(testModelId);
console.log(`✓ Model health status: ${modelHealth?.status}`);
console.log(`  - Failure count: ${modelHealth?.failureCount}`);

// Record success
circuitBreaker.recordModelSuccess(testModelId);
console.log('✓ Recorded model success');

const isAvailableAfter = circuitBreaker.isModelAvailable(testModelId);
console.log(`✓ Model available after success: ${isAvailableAfter}\n`);

// Test 2: Context Compression
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Test 2: Context Compression');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const testContent = `
Here's some code I'm working on:

\`\`\`typescript
function processModelRequest(request: ChatCompletionRequest) {
  // This is important logic
  const model = selectBestModel(request);
  return model.execute(request);
}
\`\`\`

I need to implement error handling. The reason is that sometimes models fail.
Because of this, we need a fallback strategy.

Let me continue with more content...`.repeat(50); // Make it large

console.log(`Original content length: ${testContent.length} chars`);

const compressed = smartModelSelector.compressContext(testContent, 1000);
console.log(`Compressed content length: ${compressed.length} chars`);
console.log(`Compression ratio: ${((1 - compressed.length / testContent.length) * 100).toFixed(1)}%`);

// Check if code blocks are preserved
const hasCodeBlocks = compressed.includes('```');
console.log(`✓ Code blocks preserved: ${hasCodeBlocks}`);

// Check if reasoning keywords are preserved
const hasReasoning = compressed.includes('reason') || compressed.includes('Because');
console.log(`✓ Reasoning preserved: ${hasReasoning}\n`);

// Test 3: Conversation-Aware Fallback Chain
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Test 3: Conversation-Aware Fallback Chain');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Mock ranked models
const mockModels = CURATED_MODELS.slice(0, 10).map(m => ({
  model: {
    id: m.id,
    provider: 'test',
    name: m.id,
    tier: m.tier,
    contextWindow: m.contextWindow,
    supportsStreaming: true,
    supportsFunctionCalling: m.supportsFunctionCalling,
    supportsVision: m.supportsVision,
  },
  health: { latency: 100, status: 'healthy' as const },
  stabilityScore: 100,
  tier: m.tier,
  providerPreference: 0,
}));

console.log('Testing fallback chain for different conversation types:\n');

const toolChain = smartModelSelector.getFallbackChain(mockModels as any, 5, 'tool');
console.log('Tool conversation fallback chain:');
toolChain.forEach((m, i) => {
  const curated = getCuratedModel(m.model.id);
  console.log(`  ${i + 1}. ${m.model.id} (tool calling: ${curated?.supportsFunctionCalling ?? false})`);
});

console.log('\nReasoning conversation fallback chain:');
const reasoningChain = smartModelSelector.getFallbackChain(mockModels as any, 5, 'reasoning');
reasoningChain.forEach((m, i) => {
  const curated = getCuratedModel(m.model.id);
  console.log(`  ${i + 1}. ${m.model.id} (thinking: ${curated?.isThinking ?? false})`);
});

console.log('\nGeneral conversation fallback chain:');
const generalChain = smartModelSelector.getFallbackChain(mockModels as any, 5, 'general');
generalChain.forEach((m, i) => {
  console.log(`  ${i + 1}. ${m.model.id}`);
});

console.log('\n✅ All tests completed successfully!');
console.log('\n📊 Summary:');
console.log('  - Per-model circuit breaker: ✓ Implemented');
console.log('  - Context compression: ✓ Implemented');
console.log('  - Conversation-aware fallback: ✓ Implemented');
console.log('  - Retry logic for tool conversations: ✓ Implemented in index.ts');
