// Curated list of known good coding models that work well with tools
// Data sourced from free-coding-models sources.js (SWE-bench Verified scores)
// https://www.swebench.com — scores are self-reported by model providers

export interface CuratedModel {
  id: string;
  tier: 'S+' | 'S' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'C';
  contextWindow: number;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  swe_score: number;
  isThinking: boolean;
}

// S+ tier models from free-coding-models (SWE-bench Verified >= 70%)
export const CURATED_MODELS: CuratedModel[] = [
  // ── S+ tier — SWE-bench Verified >= 70% ──
  { id: 'deepseek-ai/deepseek-v3.2', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 73.1, isThinking: false },
  { id: 'moonshotai/kimi-k2.5', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 76.8, isThinking: false },
  { id: 'z-ai/glm5', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 77.8, isThinking: false },
  { id: 'z-ai/glm4.7', tier: 'S+', contextWindow: 200000, supportsFunctionCalling: true, supportsVision: false, swe_score: 73.8, isThinking: false },
  { id: 'moonshotai/kimi-k2-thinking', tier: 'S+', contextWindow: 256000, supportsFunctionCalling: true, supportsVision: false, swe_score: 71.3, isThinking: true },
  { id: 'minimaxai/minimax-m2.5', tier: 'S+', contextWindow: 200000, supportsFunctionCalling: true, supportsVision: false, swe_score: 80.2, isThinking: false },
  { id: 'minimaxai/minimax-m2.1', tier: 'S+', contextWindow: 200000, supportsFunctionCalling: true, supportsVision: false, swe_score: 74.0, isThinking: false },
  { id: 'stepfun-ai/step-3.5-flash', tier: 'S+', contextWindow: 256000, supportsFunctionCalling: true, supportsVision: false, swe_score: 74.4, isThinking: false },
  { id: 'qwen/qwen3-coder-480b-a35b-instruct', tier: 'S+', contextWindow: 256000, supportsFunctionCalling: true, supportsVision: false, swe_score: 70.6, isThinking: false },
  { id: 'qwen/qwen3-235b-a22b', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 70.0, isThinking: false },
  { id: 'mistralai/devstral-2-123b-instruct-2512', tier: 'S+', contextWindow: 256000, supportsFunctionCalling: true, supportsVision: false, swe_score: 72.2, isThinking: false },
  // ── S tier — SWE-bench Verified 60-70% ──
  { id: 'deepseek-ai/deepseek-v3.1-terminus', tier: 'S', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 68.4, isThinking: false },
  { id: 'moonshotai/kimi-k2-instruct', tier: 'S', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 65.8, isThinking: false },
  { id: 'minimaxai/minimax-m2', tier: 'S', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 69.4, isThinking: false },
  { id: 'qwen/qwen3-next-80b-a3b-thinking', tier: 'S', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 68.0, isThinking: true },
  { id: 'qwen/qwen3-next-80b-a3b-instruct', tier: 'S', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 65.0, isThinking: false },
  { id: 'qwen/qwen3.5-397b-a17b', tier: 'S', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 68.0, isThinking: false },
  { id: 'openai/gpt-oss-120b', tier: 'S', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 60.0, isThinking: false },
  { id: 'meta/llama-4-maverick-17b-128e-instruct', tier: 'S', contextWindow: 1000000, supportsFunctionCalling: true, supportsVision: false, swe_score: 62.0, isThinking: false },
  { id: 'deepseek-ai/deepseek-v3.1', tier: 'S', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 62.0, isThinking: false },
  // ── A+ tier — SWE-bench Verified 50-60% ──
  { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', tier: 'A+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 56.0, isThinking: false },
  { id: 'mistralai/mistral-large-3-675b-instruct-2512', tier: 'A+', contextWindow: 256000, supportsFunctionCalling: true, supportsVision: false, swe_score: 58.0, isThinking: false },
  { id: 'qwen/qwq-32b', tier: 'A+', contextWindow: 131000, supportsFunctionCalling: true, supportsVision: false, swe_score: 50.0, isThinking: true },
  // ── A tier — SWE-bench Verified 40-50% ──
  { id: 'mistralai/mistral-medium-3-instruct', tier: 'A', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 48.0, isThinking: false },
  { id: 'qwen/qwen2.5-coder-32b-instruct', tier: 'A', contextWindow: 32000, supportsFunctionCalling: true, supportsVision: false, swe_score: 46.0, isThinking: false },
  { id: 'meta/llama-3.1-405b-instruct', tier: 'A', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 44.0, isThinking: false },
  { id: 'deepseek-ai/deepseek-r1-distill-qwen-32b', tier: 'A', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 43.9, isThinking: true },
  // ── A- tier — SWE-bench Verified 35-40% ──
  { id: 'meta/llama-3.3-70b-instruct', tier: 'A-', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 39.5, isThinking: false },
  // ── B tier — SWE-bench Verified 20-30% ──
  { id: 'meta/llama-3.1-8b-instant', tier: 'B', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 28.8, isThinking: false },
  // ── Thinking models from other providers ──
  { id: 'deepseek-ai/deepseek-r1', tier: 'S', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 61.0, isThinking: true },
];

// Models known to work well with tools/function calling
// Based on free-coding-models verified models + known OpenAI-compatible tool support
export const TOOL_CAPABLE_MODELS = [
  'deepseek-ai/deepseek-v3',
  'deepseek-ai/deepseek-v3.1',
  'deepseek-ai/deepseek-v3.2',
  'z-ai/glm5',
  'z-ai/glm4.7',
  'qwen/qwen3',
  'qwen/qwen2.5-coder',
  'qwen/qwen3-coder',
  'qwen/qwen3-235b',
  'qwen/qwen3-32b',
  'qwen/qwen3-next',
  'qwen/qwq',
  'meta/llama-3.1',
  'meta/llama-3.3',
  'meta/llama-4',
  'llama-3.1',
  'llama-3.3',
  'llama-4',
  'minimaxai/minimax-m2',
  'minimaxai/minimax-m2.1',
  'minimaxai/minimax-m2.5',
  'stepfun-ai/step-3.5-flash',
  'mistralai/devstral',
  'mistralai/mistral-large',
  'moonshotai/kimi-k2',
  'openai/gpt-oss',
  'nvidia/llama-3.1-nemotron',
];

// Check if a model is in our curated list
export function isCuratedModel(modelId: string): boolean {
  return CURATED_MODELS.some(m => modelId.includes(m.id) || m.id.includes(modelId));
}

// Get curated model info
export function getCuratedModel(modelId: string): CuratedModel | undefined {
  const normalizedQuery = modelId.toLowerCase().replace(/[-_./]/g, '');
  
  // 1. Try exact match first
  const exactMatch = CURATED_MODELS.find(m => m.id === modelId);
  if (exactMatch) return exactMatch;
  
  // 2. Try normalized match (ignore dashes, underscores, dots, slashes, case)
  const normalizedMatch = CURATED_MODELS.find(
    m => m.id.toLowerCase().replace(/[-_./]/g, '') === normalizedQuery
  );
  if (normalizedMatch) return normalizedMatch;
  
  // 3. Find all substring matches
  const substringMatches = CURATED_MODELS.filter(
    m => modelId.includes(m.id) || m.id.includes(modelId)
  );
  
  if (substringMatches.length === 0) return undefined;
  
  // 4. Return the match with the longest ID (most specific)
  return substringMatches.reduce((best, current) => 
    current.id.length > best.id.length ? current : best
  );
}

// Check if model is known to work with tools
export function supportsToolCalling(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return TOOL_CAPABLE_MODELS.some(m => id.includes(m.toLowerCase()));
}

// Get best model for coding from curated list
export function getBestCodingModel(availableModels: string[]): string | null {
  const sorted = CURATED_MODELS
    .filter(m => availableModels.some(a => a.includes(m.id) || m.id.includes(a)))
    .sort((a, b) => b.swe_score - a.swe_score);

  return sorted[0]?.id || null;
}
