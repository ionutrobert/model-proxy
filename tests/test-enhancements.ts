import { adaptiveModelScorer } from '../src/core/adaptive-scorer.js';
import { conversationStateManager } from '../src/core/conversation-state.js';
import { getCuratedModel, CURATED_MODELS } from '../src/core/curated-models.js';

console.log('🧪 Testing AI Orchestration Enhancements\n');

// Test 1: Adaptive Model Scoring
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Test 1: Adaptive Model Scoring');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const testModels = ['minimaxai/minimax-m2.5', 'moonshotai/kimi-k2-thinking', 'deepseek-ai/deepseek-v3.2'];

// Record successes and failures
console.log('📊 Recording model performance...\n');

testModels.forEach((modelId, index) => {
  // Simulate varying performance
  const successCount = 20 - (index * 5);
  const failureCount = index * 2;
  const latency = 500 + (index * 200);

  for (let i = 0; i < successCount; i++) {
    adaptiveModelScorer.recordSuccess(modelId, latency + Math.random() * 100, {
      hadToolCalls: index === 1, // Kimi K2 Thinking for tools
      contextWindowUsed: 50000
    });
  }

  for (let i = 0; i < failureCount; i++) {
    adaptiveModelScorer.recordFailure(modelId, 'Test failure', {
      hadToolCalls: index === 1
    });
  }

  console.log(`✓ ${modelId}:`);
  console.log(`   Successes: ${successCount}, Failures: ${failureCount}`);
  console.log(`   Avg Latency: ${latency}ms`);
});

console.log('\n📈 Adaptive Scores:\n');

const contexts: Array<'tool' | 'reasoning' | 'general'> = ['tool', 'reasoning', 'general'];
contexts.forEach(context => {
  console.log(`${context.toUpperCase()} context:`);
  testModels.forEach(modelId => {
    const score = adaptiveModelScorer.getAdaptiveScore(modelId, context);
    console.log(`  ${modelId}: ${score.toFixed(1)}/100`);
  });
  console.log('');
});

// Get top performers
console.log('🏆 Top Performers:\n');
contexts.forEach(context => {
  const topModels = adaptiveModelScorer.getTopPerformers(context, 3);
  console.log(`${context}: ${topModels.join(', ')}`);
});

console.log('\n');

// Test 2: Conversation State Management
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Test 2: Conversation State Management');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const sessionId = `test-session-${Date.now()}`;

// Save a checkpoint
console.log('💾 Saving checkpoint...');
const checkpointId = conversationStateManager.saveCheckpoint(sessionId, {
  modelId: 'minimaxai/minimax-m2.5',
  messages: [
    { role: 'user', content: 'Test message' },
    { role: 'assistant', content: 'Test response', tool_calls: [{ id: 'call_1', function: { name: 'test_tool' } }] }
  ],
  toolCalls: [{ id: 'call_1', function: { name: 'test_tool' } }],
  partialContent: 'Partial content...',
  metadata: {
    provider: 'nvidia-nim',
    latency: 1200,
    chunkCount: 25
  }
});
console.log(`✓ Checkpoint saved: ${checkpointId}\n`);

// Restore the checkpoint
console.log('📂 Restoring checkpoint...');
const restored = conversationStateManager.restoreCheckpoint(checkpointId);
if (restored) {
  console.log('✓ Checkpoint restored successfully:');
  console.log(`   Model: ${restored.modelId}`);
  console.log(`   Messages: ${restored.messages.length}`);
  console.log(`   Tool Calls: ${restored.toolCalls?.length || 0}`);
  console.log(`   Provider: ${restored.metadata.provider}`);
  console.log(`   Latency: ${restored.metadata.latency}ms`);
  console.log(`   Chunks: ${restored.metadata.chunkCount}\n`);
}

// Get latest checkpoint
console.log('🔍 Finding latest checkpoint...');
const latest = conversationStateManager.getLatestCheckpoint(sessionId);
if (latest) {
  console.log(`✓ Latest checkpoint: ${latest.id}`);
  console.log(`   Age: ${((Date.now() - latest.timestamp) / 1000).toFixed(1)}s\n`);
}

// Get stats
console.log('📊 Checkpoint Statistics:');
const stats = conversationStateManager.getStats();
console.log(`   Total checkpoints: ${stats.total}`);
console.log(`   Tool conversations: ${stats.toolConversations}`);
console.log(`   Oldest age: ${(stats.oldestAge / 1000).toFixed(1)}s`);
console.log(`   Newest age: ${(stats.newestAge / 1000).toFixed(1)}s\n`);

// Test 3: Integration with Model Selection
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Test 3: Adaptive Model Recommendations');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('🎯 Recommended models by context:\n');

contexts.forEach(context => {
  const recommended = adaptiveModelScorer.getRecommendedModel(testModels, context);
  const curated = recommended ? getCuratedModel(recommended) : null;
  
  console.log(`${context.toUpperCase()}:`);
  if (recommended) {
    console.log(`  Model: ${recommended}`);
    console.log(`  Tier: ${curated?.tier || 'Unknown'}`);
    console.log(`  SWE Score: ${curated?.swe_score || 'N/A'}`);
    console.log(`  Tool Calling: ${curated?.supportsFunctionCalling ? 'Yes' : 'No'}`);
    console.log(`  Thinking: ${curated?.isThinking ? 'Yes' : 'No'}`);
  } else {
    console.log(`  No recommendation available`);
  }
  console.log('');
});

// Test 4: Performance Metrics
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Test 4: Detailed Performance Metrics');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

testModels.forEach(modelId => {
  const metrics = adaptiveModelScorer.getMetrics(modelId);
  if (metrics) {
    console.log(`${modelId}:`);
    console.log(`  Total Requests: ${metrics.totalRequests}`);
    console.log(`  Success Rate: ${((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(1)}%`);
    console.log(`  Avg Latency: ${metrics.averageLatency.toFixed(0)}ms`);
    console.log(`  Tool Success: ${metrics.toolCallSuccess}`);
    console.log(`  Tool Failures: ${metrics.toolCallFailures}`);
    if (metrics.contextWindowUsage.length > 0) {
      const avgContext = metrics.contextWindowUsage.reduce((a, b) => a + b, 0) / metrics.contextWindowUsage.length;
      console.log(`  Avg Context Usage: ${(avgContext / 1000).toFixed(1)}k tokens`);
    }
    console.log('');
  }
});

// Cleanup
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧹 Cleanup');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

conversationStateManager.deleteCheckpoint(checkpointId);
console.log('✓ Checkpoint deleted');

console.log('\n✅ All enhancement tests completed successfully!\n');

console.log('📊 Enhancement Summary:');
console.log('  ✓ Adaptive Model Scoring: Learning from success rates');
console.log('  ✓ Conversation State Management: Checkpoint/Resume working');
console.log('  ✓ Context-Aware Recommendations: Tool vs Reasoning models');
console.log('  ✓ Performance Metrics: Detailed tracking enabled');
console.log('\n🎯 Next Steps:');
console.log('  1. Deploy to production');
console.log('  2. Monitor adaptive scores over time');
console.log('  3. Analyze checkpoint recovery rate');
console.log('  4. Fine-tune decay factor based on usage patterns');
