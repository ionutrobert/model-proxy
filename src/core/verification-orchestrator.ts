// ============================================================================
// Verification Orchestrator - Auto-continuation until task completion
// ============================================================================

import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from './types.js';
import { injectVerificationPrompt, removeTriggerPhrase } from './prompt-injector.js';
import { detectCompletion } from './completion-detector.js';

export interface LoopConfig {
  enabled: boolean;
  maxIterations: number;
  completionMarker: string;
  triggerPhrase: string;
  retryDelayMs: number;
  feedbackTemplate?: string;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  enabled: process.env.ENABLE_VERIFICATION_LOOP !== 'false', // Enabled by default
  maxIterations: parseInt(process.env.LOOP_MAX_ITERATIONS || '3', 10),
  completionMarker: process.env.LOOP_COMPLETION_MARKER || '[TASK_DONE]',
  triggerPhrase: '#loop',
  retryDelayMs: parseInt(process.env.LOOP_RETRY_DELAY_MS || '1000', 10),
};

export type ExecuteFunction = (
  request: ChatCompletionRequest
) => Promise<ChatCompletionResponse>;

/**
 * Verification Orchestrator
 * Implements auto-continuation loop until task completion
 */
export class VerificationOrchestrator {
  private config: LoopConfig;

  constructor(config: Partial<LoopConfig> = {}) {
    this.config = { ...DEFAULT_LOOP_CONFIG, ...config };
  }

  /**
   * Check if trigger phrase is present in user messages
   */
  shouldEnableLoop(messages: ChatMessage[]): boolean {
    if (!this.config.enabled) {
      return false;
    }

    return messages.some(
      m =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes(this.config.triggerPhrase)
    );
  }

  /**
   * Sanitize messages by removing trigger phrases
   */
  sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(m => {
      if (m.role === 'user' && typeof m.content === 'string') {
        return {
          ...m,
          content: removeTriggerPhrase(m.content, this.config.triggerPhrase),
        };
      }
      return m;
    });
  }

  /**
   * Execute with verification loop
   * Keeps calling the model until [TASK_DONE] appears or max iterations reached
   */
  async executeWithVerification(
    request: ChatCompletionRequest,
    executeFn: ExecuteFunction
  ): Promise<ChatCompletionResponse> {
    // Sanitize messages (remove #loop trigger)
    let messages = this.sanitizeMessages(request.messages);
    
    // Inject verification system prompt
    messages = injectVerificationPrompt(messages);

    let iteration = 0;
    const maxIterations = this.config.maxIterations;

    while (iteration < maxIterations) {
      // Call the model
    const response = await executeFn({
      ...request,
      messages,
    });

    const content = response.choices[0]?.message?.content;
    const contentStr = typeof content === 'string' ? content : '';

    // Check for completion marker
    const check = detectCompletion(contentStr, {
      completionMarker: this.config.completionMarker,
      feedbackTemplate: this.config.feedbackTemplate,
    });

    if (check.isComplete) {
      // Task is complete - return clean response
      return {
        ...response,
        choices: [
          {
            ...response.choices[0],
            message: {
              ...response.choices[0].message,
              content: contentStr
                .replace(new RegExp(this.config.completionMarker, 'g'), '')
                .trim(),
            },
          },
        ],
      };
    }

      // Not complete - add feedback and continue
      messages = [
        ...messages,
        {
          role: 'assistant',
          content,
        },
        {
          role: 'user',
          content: check.feedback || 'Please continue and mark the task as complete.',
        },
      ];

      iteration++;

      // Optional delay between iterations
      if (this.config.retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
      }
    }

    // Max iterations reached - return last response
    console.warn(`[LOOP] Max iterations (${maxIterations}) reached without completion marker`);
    
    const lastContent = messages[messages.length - 1]?.content || '';
    return await executeFn({
      ...request,
      messages,
    });
  }
}
