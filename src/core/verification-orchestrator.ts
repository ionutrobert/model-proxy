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
  enabled: process.env.ENABLE_VERIFICATION_LOOP !== 'false',
  maxIterations: parseInt(process.env.LOOP_MAX_ITERATIONS || '0', 10), // 0 = infinite
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
   * Check if trigger phrase is present in the MOST RECENT user message only
   * This prevents false positives from feedback messages added by previous loop iterations
   */
  shouldEnableLoop(messages: ChatMessage[]): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Only check the most recent user message
    // This prevents the loop from triggering on feedback messages added by previous iterations
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    
    if (!lastUserMessage) {
      return false;
    }

    if (typeof lastUserMessage.content !== 'string') {
      return false;
    }

    const hasTrigger = lastUserMessage.content.includes(this.config.triggerPhrase);
    
    if (hasTrigger) {
      console.log(`[LOOP] Trigger phrase "${this.config.triggerPhrase}" found in last user message`);
    }

    return hasTrigger;
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
   * Keeps calling the model until [TASK_DONE] appears
   * If maxIterations is 0, loops infinitely
   */
  async executeWithVerification(
    request: ChatCompletionRequest,
    executeFn: ExecuteFunction
  ): Promise<ChatCompletionResponse> {
    let messages = this.sanitizeMessages(request.messages);
    messages = injectVerificationPrompt(messages);

    let iteration = 0;
    const maxIterations = this.config.maxIterations;
    const isInfinite = maxIterations === 0;

    while (isInfinite || iteration < maxIterations) {
      iteration++;

      console.log(`[LOOP] Iteration ${iteration}${isInfinite ? '' : `/${maxIterations}`} - calling model...`);

      const response = await executeFn({
        ...request,
        messages,
      });

      const content = response.choices[0]?.message?.content;
      const contentStr = typeof content === 'string' ? content : '';

      const check = detectCompletion(contentStr, {
        completionMarker: this.config.completionMarker,
        feedbackTemplate: this.config.feedbackTemplate,
      });

      if (check.isComplete) {
        console.log(`[LOOP] Task completed at iteration ${iteration}`);
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

      const feedback = this.generateSmartFeedback(contentStr, iteration);
      console.log(`[LOOP] Iteration ${iteration} incomplete - continuing...`);

      messages = [
        ...messages,
        {
          role: 'assistant',
          content,
        },
        {
          role: 'user',
          content: feedback,
        },
      ];

      if (this.config.retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
      }
    }

    console.warn(`[LOOP] Max iterations (${maxIterations}) reached without completion marker`);
    const lastContent = messages[messages.length - 1]?.content || '';
    return await executeFn({
      ...request,
      messages,
    });
  }

  /**
   * Generate smart feedback based on response content
   */
  private generateSmartFeedback(content: string, iteration: number): string {
    const trimmed = content.trim();
    
    if (trimmed.endsWith('...') || /\w\s*$/.test(trimmed)) {
      return `You stopped mid-sentence. Continue from where you left off. When done, add ${this.config.completionMarker}`;
    }

    const openBraces = (trimmed.match(/\{/g) || []).length;
    const closeBraces = (trimmed.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      return `Your code has unclosed braces. Complete your code block and add ${this.config.completionMarker} when finished.`;
    }

    const openParens = (trimmed.match(/\(/g) || []).length;
    const closeParens = (trimmed.match(/\)/g) || []).length;
    if (openParens > closeParens) {
      return `Your code has unclosed parentheses. Complete your code and add ${this.config.completionMarker} when finished.`;
    }

    if (/<[a-zA-Z][^>]*$/.test(trimmed)) {
      return `Your HTML/XML is incomplete. Close your tags and add ${this.config.completionMarker} when finished.`;
    }

    if (/```[a-z]*$/im.test(trimmed) && !/```[\s\S]*```/m.test(trimmed)) {
      return `Your code block is incomplete. Finish your code, close with \`\`\`, and add ${this.config.completionMarker}.`;
    }

    if (iteration <= 3) {
      return `Continue your work. When the task is complete, add ${this.config.completionMarker} at the end.`;
    }

    if (iteration <= 10) {
      return `You're on iteration ${iteration}. Complete the task and add ${this.config.completionMarker}.`;
    }

    return `Iteration ${iteration}. Please finish the task and add ${this.config.completionMarker}.`;
  }
}
