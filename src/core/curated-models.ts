// Curated list of known good coding models that work well with tools
// Based on free-coding-models S-tier list

export interface CuratedModel {
  id: string;
  tier: 'S+' | 'S' | 'A+';
  contextWindow: number;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  swe_score: number; // SWE-bench score
}

// Known working models from free-coding-models S-tier
export const CURATED_MODELS: CuratedModel[] = [
  // S+ tier - best for coding
  { id: 'deepseek-ai/deepseek-v3.2', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 73.1 },
  { id: 'deepseek-ai/deepseek-v3.1', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 73.1 },
  { id: 'moonshotai/kimi-k2.5', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 76.8 },
  { id: 'z-ai/glm5', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 77.8 },
  { id: 'z-ai/glm4.7', tier: 'S+', contextWindow: 200000, supportsFunctionCalling: true, supportsVision: false, swe_score: 73.8 },
  { id: 'moonshotai/kimi-k2-thinking', tier: 'S+', contextWindow: 256000, supportsFunctionCalling: true, supportsVision: false, swe_score: 71.3 },
  { id: 'minimaxai/minimax-m2.5', tier: 'S+', contextWindow: 200000, supportsFunctionCalling: true, supportsVision: false, swe_score: 80.2 },
  { id: 'minimaxai/minimax-m2.1', tier: 'S+', contextWindow: 200000, supportsFunctionCalling: true, supportsVision: false, swe_score: 74.0 },
  { id: 'stepai/step-3.5-flash', tier: 'S+', contextWindow: 256000, supportsFunctionCalling: true, supportsVision: false, swe_score: 74.4 },
  { id: 'qwen/qwen3-coder-480b', tier: 'S+', contextWindow: 256000, supportsFunctionCalling: true, supportsVision: false, swe_score: 70.6 },
  { id: 'qwen/qwen3-235b', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 70.0 },
  { id: 'mistralai/devstral-2-123b', tier: 'S+', contextWindow: 256000, supportsFunctionCalling: true, supportsVision: false, swe_score: 72.2 },
  { id: 'deepseek-ai/deepseek-v3.1-terminus', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 68.4 },
  { id: 'moonshotai/kimi-k2-instruct', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 65.8 },
  { id: 'minimaxai/minimax-m2', tier: 'S+', contextWindow: 128000, supportsFunctionCalling: true, supportsVision: false, swe_score: 69.4 },
];

// Models known to work well with tools/function calling
export const TOOL_CAPABLE_MODELS = [
  'deepseek-ai/deepseek-v3',
  'deepseek-ai/deepseek-v3.1',
  'deepseek-ai/deepseek-v3.2',
  'z-ai/glm5',
  'z-ai/glm4.7',
  'qwen/qwen3',
  'meta/llama-3.1',
  'meta/llama-3.3',
];

// Check if a model is in our curated list
export function isCuratedModel(modelId: string): boolean {
  return CURATED_MODELS.some(m => modelId.includes(m.id) || m.id.includes(modelId));
}

// Get curated model info
export function getCuratedModel(modelId: string): CuratedModel | undefined {
  return CURATED_MODELS.find(m => modelId.includes(m.id) || m.id.includes(modelId));
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
