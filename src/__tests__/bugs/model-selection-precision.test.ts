import { describe, it, expect } from 'vitest';
import { getCuratedModel, CURATED_MODELS } from '../../core/curated-models';

describe('Bug: Model Selection Precision', () => {
  it('should match kimi-k2.5 exactly, not kimi-k2-instruct', () => {
    const k2Instruct = CURATED_MODELS.find(m => m.id === 'moonshotai/kimi-k2-instruct');
    const k25 = CURATED_MODELS.find(m => m.id === 'moonshotai/kimi-k2.5');
    
    expect(k2Instruct).toBeDefined();
    expect(k25).toBeDefined();
    expect(k25!.swe_score).toBeGreaterThan(k2Instruct!.swe_score);

    const result = getCuratedModel('moonshotai/kimi-k2.5');
    
    expect(result?.id).toBe('moonshotai/kimi-k2.5');
    expect(result?.id).not.toBe('moonshotai/kimi-k2-instruct');
  });

  it('should prefer exact match over substring match', () => {
    const result = getCuratedModel('deepseek-ai/deepseek-v3.1');
    
    expect(result?.id).toBe('deepseek-ai/deepseek-v3.1');
  });

  it('should handle normalized matching', () => {
    const result1 = getCuratedModel('deepseekai_deepseekv32');
    
    expect(result1?.id).toBe('deepseek-ai/deepseek-v3.2');
  });

  it('should return longest match when multiple substring matches', () => {
    const result = getCuratedModel('minimaxai/minimax-m2.5-latest');
    
    expect(result).toBeDefined();
    expect(result?.id).toBe('minimaxai/minimax-m2.5');
  });
});
