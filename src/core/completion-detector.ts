// ============================================================================
// Completion Detector - Detects task completion markers
// ============================================================================

export interface CompletionCheck {
  isComplete: boolean;
  feedback?: string;
}

export interface DetectorConfig {
  completionMarker: string;
  feedbackTemplate?: string;
}

const DEFAULT_FEEDBACK_TEMPLATE = `You haven't marked the task as complete yet.

Please:
1. Review your work carefully
2. Verify it's correct and complete
3. Include {MARKER} at the end of your response when finished

Continue working until the task is truly done.`;

/**
 * Detect if response contains completion marker
 */
export function detectCompletion(
  content: string | null | undefined,
  config: DetectorConfig
): CompletionCheck {
  const marker = config.completionMarker;
  const normalizedContent = (content || '').trim();
  
  const hasMarker = normalizedContent.includes(marker);
  
  if (hasMarker) {
    return { isComplete: true };
  }

  const feedback = (config.feedbackTemplate || DEFAULT_FEEDBACK_TEMPLATE)
    .replace('{MARKER}', marker);

  return {
    isComplete: false,
    feedback,
  };
}

/**
 * Extract content before completion marker
 * Returns clean content without the marker
 */
export function extractContentBeforeMarker(
  content: string | null | undefined,
  marker: string
): string {
  if (!content) return '';
  
  const index = content.indexOf(marker);
  if (index === -1) {
    return content.trim();
  }
  
  return content.substring(0, index).trim();
}
