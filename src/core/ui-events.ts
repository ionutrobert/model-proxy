// ============================================================================
// Custom UI Events for Streaming
// ============================================================================

import { ChatCompletionChunk } from './types.js';

export interface UIEvent {
  type: 'thinking_start' | 'thinking_end' | 'tool_call_start' | 'tool_call_end' | 'progress' | 'animation';
  timestamp: number;
}

export interface AnimationConfig {
  type: 'spinner' | 'progress' | 'ascii';
  frames: string[];
  interval: number; // milliseconds
  currentFrame: number;
}

export interface ProgressInfo {
  current: number;
  total: number;
  message: string;
}

export interface CustomChunk {
  id?: string;
  object?: 'chat.completion.chunk';
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string | null;
  }>;
  ui_event?: UIEvent;
  animation?: AnimationConfig;
  progress?: ProgressInfo;
  metadata?: {
    stage: 'reasoning' | 'planning' | 'executing' | 'done';
    tool_name?: string;
  };
}

// ASCII animations for different states
export const ANIMATIONS = {
  thinking: ['🤔', '💭', '🧠', '⚡', '✨'],
  processing: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  searching: ['🔍', '🔎', '📂', '📁', '📄'],
  analyzing: ['📊', '📈', '📉', '🔬', '🧪'],
  success: ['✅', '🎉', '⭐'],
  error: ['❌', '⚠️', '🚨'],
};

export function createThinkingStartChunk(): CustomChunk {
  return {
    id: `ui-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'ui-event',
    choices: [],
    ui_event: {
      type: 'thinking_start',
      timestamp: Date.now(),
    },
    animation: {
      type: 'ascii',
      frames: ANIMATIONS.thinking,
      interval: 500,
      currentFrame: 0,
    },
    metadata: {
      stage: 'reasoning',
    },
  };
}

export function createToolCallStartChunk(toolName: string): CustomChunk {
  return {
    id: `ui-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'ui-event',
    choices: [],
    ui_event: {
      type: 'tool_call_start',
      timestamp: Date.now(),
    },
    animation: {
      type: 'spinner',
      frames: ANIMATIONS.processing,
      interval: 100,
      currentFrame: 0,
    },
    metadata: {
      stage: 'executing',
      tool_name: toolName,
    },
  };
}

export function createProgressChunk(current: number, total: number, message: string): CustomChunk {
  return {
    id: `ui-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'ui-event',
    choices: [],
    ui_event: {
      type: 'progress',
      timestamp: Date.now(),
    },
    progress: {
      current,
      total,
      message,
    },
    metadata: {
      stage: 'executing',
    },
  };
}
