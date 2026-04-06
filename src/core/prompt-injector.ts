// ============================================================================
// Prompt Injector - Injects verification requirements into system prompt
// ============================================================================

import { ChatMessage } from './types.js';

const VERIFICATION_PROMPT = `When you complete this task, you MUST:
1. Verify your work is correct and complete
2. Mark completion with: [TASK_DONE]

If you stop without this marker, you will be asked to continue working.

IMPORTANT: Your response must include [TASK_DONE] at the end when truly finished.`;

/**
 * Check if verification prompt is already present in messages
 */
function hasVerificationPrompt(messages: ChatMessage[]): boolean {
  return messages.some(
    m => m.role === 'system' && m.content?.includes('[TASK_DONE]')
  );
}

/**
 * Inject verification requirements into messages
 * Adds a system message if not already present
 */
export function injectVerificationPrompt(messages: ChatMessage[]): ChatMessage[] {
  if (hasVerificationPrompt(messages)) {
    return messages;
  }

  // Add system message at the beginning
  return [
    {
      role: 'system',
      content: VERIFICATION_PROMPT,
    },
    ...messages,
  ];
}

/**
 * Remove trigger phrase from user message content
 */
export function removeTriggerPhrase(
  content: string,
  triggerPhrase: string = '#loop'
): string {
  if (typeof content !== 'string') {
    return content;
  }
  
  // Remove all occurrences of the trigger phrase
  return content
    .replace(new RegExp(triggerPhrase, 'gi'), '')
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim();
}
