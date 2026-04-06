// ============================================================================
// Enhanced Animation System for Model Proxy
// Inspired by Hermes Agent's KawaiiSpinner
// ============================================================================

import { EventEmitter } from 'events';
import * as readline from 'readline';

export type AnimationType = 
  | 'dots'
  | 'bounce'
  | 'grow'
  | 'arrows'
  | 'star'
  | 'moon'
  | 'pulse'
  | 'brain'
  | 'sparkle'
  | 'thinking'
  | 'processing'
  | 'searching';

export interface AnimationConfig {
  type: AnimationType;
  message: string;
  interval: number;
  showTime: boolean;
  color: boolean;
}

// Animation frames - inspired by Hermes Agent
const ANIMATION_FRAMES: Record<AnimationType, string[]> = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
  grow: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'],
  arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  star: ['✶', '✷', '✸', '✹', '✺', '✹', '✸', '✷'],
  moon: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
  pulse: ['◜', '◠', '◝', '◞', '◡', '◟'],
  brain: ['🧠', '💭', '💡', '✨', '💫', '🌟', '💡', '💭'],
  sparkle: ['⁺', '˚', '*', '✧', '✦', '✧', '*', '˚'],
  thinking: [
    '(｡•́︿•̀｡)', '(◔_◔)', '(¬‿¬)', '( •_•)>⌐■-■', '(⌐■_■)', '(´･_･`)',
    '◉_◉', '(°ロ°)', '( ˇωˇ )', '(¬_¬)', 'ヽ(ー_ー )ノ', '(；一_一)'
  ],
  processing: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  searching: ['🔍 ◀', '◀ 🔍', '🔍 ▶', '▶ 🔍', '🔎 ◀', '◀ 🔎'],
};

// ANSI color codes
const ANSI_COLORS = {
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

// Thinking verbs - inspired by Hermes
const THINKING_VERBS = [
  'pondering', 'contemplating', 'musing', 'cogitating', 'ruminating',
  'deliberating', 'mulling', 'reflecting', 'processing', 'reasoning',
  'analyzing', 'computing', 'synthesizing', 'formulating', 'brainstorming'
];

// Kawaii faces for different states
const KAWAII_FACES = {
  thinking: ['(｡◕‿◕｡)', '(◕‿◕✿)', '٩(◕‿◕｡)۶', '(✿◠‿◠)', '( ˘▽˘)っ'],
  waiting: ['♪(´ε` )', '(ノ´ヮ`)ノ*:・゚✧', 'ヾ(＾∇＾)', '(◕ᴗ◕✿)', 'ヽ(>∀<☆)ノ'],
  processing: ['ヽ(>∀<☆)ノ', '(☆▽☆)', '( ˘▽˘)っ', '(≧◡≦)', 'ヾ(￣▽￣)'],
  search: ['🔍 ◀', '◀ 🔍', '🔍 ▶', '▶ 🔍', '🔎 ◀', '◀ 🔎'],
};

export class AnimationManager extends EventEmitter {
  private frames: string[] = [];
  private currentFrame = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private message: string = '';
  private isRunning = false;
  private readonly showTime: boolean;
  private readonly useColors: boolean;
  private readonly animationType: AnimationType;

  constructor(config: Partial<AnimationConfig> = {}) {
    super();
    
    // Configuration from environment variables or defaults
    this.animationType = config.type || this.getEnvAnimationType();
    this.message = config.message || 'Processing';
    this.showTime = config.showTime !== undefined ? config.showTime : this.getEnvShowTime();
    this.useColors = config.color !== undefined ? config.color : this.getEnvUseColors();
    
    this.frames = ANIMATION_FRAMES[this.animationType] || ANIMATION_FRAMES.processing;
  }

  // Environment variable getters
  private getEnvAnimationType(): AnimationType {
    const envType = process.env.PROXY_ANIMATION_TYPE;
    if (envType && (ANIMATION_FRAMES as any)[envType]) {
      return envType as AnimationType;
    }
    return 'processing';
  }

  private getEnvShowTime(): boolean {
    return process.env.PROXY_ANIMATION_SHOW_TIME !== 'false';
  }

  private getEnvUseColors(): boolean {
    return process.env.PROXY_ANIMATION_COLORS !== 'false';
  }

  // Check if animations are enabled
  private isAnimationEnabled(): boolean {
    return process.env.PROXY_ANIMATIONS_ENABLED !== 'false';
  }

  // Check if output is a TTY
  private isTTY(): boolean {
    return process.stdout.isTTY && !process.env.CI;
  }

  // Generate elapsed time string
  private getElapsedTime(): string {
    if (!this.startTime) return '';
    const elapsed = (Date.now() - this.startTime) / 1000;
    return ` (${elapsed.toFixed(1)}s)`;
  }

  // Build the animation line
  private buildAnimationLine(): string {
    const frame = this.frames[this.currentFrame % this.frames.length];
    const timeStr = this.showTime ? this.getElapsedTime() : '';
    
    let line = `${frame} ${this.message}${timeStr}`;
    
    if (this.useColors && this.isTTY()) {
      const color = this.getAnimationColor();
      line = `${color}${line}${ANSI_COLORS.reset}`;
    }
    
    return line;
  }

  // Get color for current animation type
  private getAnimationColor(): string {
    const colorMap: Record<AnimationType, string> = {
      thinking: ANSI_COLORS.cyan,
      processing: ANSI_COLORS.magenta,
      searching: ANSI_COLORS.yellow,
      analyzing: ANSI_COLORS.blue,
      success: ANSI_COLORS.green,
      error: ANSI_COLORS.red,
      dots: ANSI_COLORS.cyan,
      bounce: ANSI_COLORS.magenta,
      grow: ANSI_COLORS.blue,
      arrows: ANSI_COLORS.green,
      star: ANSI_COLORS.yellow,
      moon: ANSI_COLORS.dim,
      pulse: ANSI_COLORS.cyan,
      brain: ANSI_COLORS.magenta,
      sparkle: ANSI_COLORS.yellow,
    };
    
    return colorMap[this.animationType] || ANSI_COLORS.cyan;
  }

  // Clear current line
  private clearLine(): void {
    if (this.isTTY()) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
  }

  // Start animation
  start(message?: string): void {
    if (!this.isAnimationEnabled() || !this.isTTY() || this.isRunning) {
      return;
    }

    if (message) {
      this.message = message;
    }

    this.isRunning = true;
    this.startTime = Date.now();
    this.currentFrame = 0;

    const interval = this.getInterval();
    
    this.intervalId = setInterval(() => {
      this.clearLine();
      process.stdout.write(this.buildAnimationLine());
      this.currentFrame++;
    }, interval);

    this.emit('start');
  }

  // Stop animation
  stop(finalMessage?: string): void {
    if (!this.isRunning || !this.intervalId) {
      return;
    }

    this.isRunning = false;
    clearInterval(this.intervalId);
    this.intervalId = null;

    if (this.isTTY()) {
      this.clearLine();
      
      if (finalMessage) {
        process.stdout.write(finalMessage);
      }
      
      process.stdout.write('\n');
    }

    this.emit('stop', { finalMessage, duration: this.getElapsedTime() });
  }

  // Update message during animation
  updateMessage(message: string): void {
    this.message = message;
  }

  // Get current interval based on animation type
  private getInterval(): number {
    const intervalMap: Record<AnimationType, number> = {
      thinking: 800,
      processing: 100,
      searching: 200,
      analyzing: 300,
      success: 500,
      error: 600,
      dots: 120,
      bounce: 150,
      grow: 80,
      arrows: 100,
      star: 120,
      moon: 200,
      pulse: 150,
      brain: 180,
      sparkle: 100,
    };
    
    const envInterval = parseInt(process.env.PROXY_ANIMATION_SPEED || '');
    if (!isNaN(envInterval)) {
      return envInterval;
    }
    
    return intervalMap[this.animationType] || 120;
  }

  // Create a bordered message
  createBorderedMessage(message: string): string {
    const border = '─';
    const vertical = '│';
    const topLeft = '╭';
    const topRight = '╮';
    const bottomLeft = '╰';
    const bottomRight = '╯';
    
    const lines = message.split('\n');
    const maxLength = Math.max(...lines.map(l => l.length));
    
    const top = `${topLeft}${border.repeat(maxLength + 2)}${topRight}`;
    const bottom = `${bottomLeft}${border.repeat(maxLength + 2)}${bottomRight}`;
    const middle = lines.map(line => 
      `${vertical} ${line.padEnd(maxLength)} ${vertical}`
    ).join('\n');
    
    return `${top}\n${middle}\n${bottom}`;
  }

  // Get a random thinking verb
  getRandomThinkingVerb(): string {
    return THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)];
  }

  // Get a random kawaii face
  getRandomKawaiiFace(type: keyof typeof KAWAII_FACES = 'thinking'): string {
    const faces = KAWAII_FACES[type] || KAWAII_FACES.thinking;
    return faces[Math.floor(Math.random() * faces.length)];
  }

  // Static utility: create a quick animation
  static async animateQuick(
    message: string,
    duration: number,
    type: AnimationType = 'processing'
  ): Promise<void> {
    const animator = new AnimationManager({ type, message });
    animator.start();
    
    await new Promise(resolve => setTimeout(resolve, duration));
    
    animator.stop(`✓ ${message}`);
  }

  // Static utility: animate with promise
  static async animatePromise<T>(
    promise: Promise<T>,
    message: string,
    type: AnimationType = 'processing'
  ): Promise<T> {
    const animator = new AnimationManager({ type, message });
    animator.start();
    
    try {
      const result = await promise;
      animator.stop(`✓ ${message}`);
      return result;
    } catch (error) {
      animator.stop(`✗ ${message}`);
      throw error;
    }
  }
}

// ============================================================================
// Streaming Response Transformer with Animation Support
// ============================================================================

import { ChatCompletionChunk } from '../types.js';

export interface AnimationTransformerConfig {
  enabled?: boolean;
  animationType?: AnimationType;
  detectThinking?: boolean;
  thinkingMessage?: string;
  processingMessage?: string;
  completionMessage?: string;
}

export class StreamingAnimationTransformer {
  private animationManager: AnimationManager;
  private config: Required<AnimationTransformerConfig>;
  private isThinking = false;
  private isProcessing = false;
  private buffer: ChatCompletionChunk[] = [];

  constructor(config: AnimationTransformerConfig = {}) {
    this.config = {
      enabled: process.env.PROXY_ANIMATIONS_ENABLED !== 'false',
      animationType: config.animationType || 'processing',
      detectThinking: config.detectThinking !== false,
      thinkingMessage: config.thinkingMessage || '🤔 Thinking...',
      processingMessage: config.processingMessage || '⚡ Processing...',
      completionMessage: config.completionMessage || '✓ Complete',
      ...config,
    };

    this.animationManager = new AnimationManager({
      type: this.config.animationType,
    });
  }

  // Detect if a chunk contains thinking/reasoning content
  private isThinkingChunk(chunk: ChatCompletionChunk): boolean {
    if (!this.config.detectThinking) return false;
    
    const content = chunk.choices?.[0]?.delta?.content || '';
    return content.includes(' <think> ') || content.includes('💭') || content.includes('🤔');
  }

  // Detect if a chunk contains final answer
  private isAnswerChunk(chunk: ChatCompletionChunk): boolean {
    const content = chunk.choices?.[0]?.delta?.content || '';
    return content.includes(' <think> ') === false && content.trim().length > 0;
  }

  // Transform a single chunk
  transformChunk(chunk: ChatCompletionChunk): ChatCompletionChunk {
    if (!this.config.enabled) return chunk;

    // Detect thinking phase
    if (this.isThinkingChunk(chunk) && !this.isThinking) {
      this.isThinking = true;
      this.animationManager.updateMessage(this.config.thinkingMessage);
      if (!this.animationManager.isRunning) {
        this.animationManager.start();
      }
    }

    // Detect answer phase
    if (this.isAnswerChunk(chunk) && this.isThinking) {
      this.isThinking = false;
      this.isProcessing = true;
      this.animationManager.updateMessage(this.config.processingMessage);
    }

    // Buffer the chunk
    this.buffer.push(chunk);
    return chunk;
  }

  // Transform an entire stream
  async *transformStream(
    stream: AsyncIterable<ChatCompletionChunk>
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    if (!this.config.enabled) {
      yield* stream;
      return;
    }

    try {
      for await (const chunk of stream) {
        yield this.transformChunk(chunk);
      }
    } finally {
      this.complete();
    }
  }

  // Complete the animation
  complete(): void {
    if (this.animationManager.isRunning) {
      this.animationManager.stop(this.config.completionMessage);
    }
    this.isThinking = false;
    this.isProcessing = false;
  }

  // Get the buffered chunks
  getBufferedChunks(): ChatCompletionChunk[] {
    return [...this.buffer];
  }

  // Clear the buffer
  clearBuffer(): void {
    this.buffer = [];
  }
}

// ============================================================================
// Proxy Integration Helpers
// ============================================================================

import { ModelProxyCore } from '../index.js';

export function enhanceProxyWithAnimations(proxy: ModelProxyCore): void {
  const originalExecuteStreaming = proxy.executeStreaming.bind(proxy);
  
  proxy.executeStreaming = async function(
    request,
    onChunk,
    onComplete,
    onError,
    mode
  ): Promise<void> {
    const transformer = new StreamingAnimationTransformer({
      detectThinking: true,
      thinkingMessage: '🤔 Thinking...',
      processingMessage: '⚡ Processing...',
      completionMessage: '✓ Complete',
    });

    // Wrap the onChunk callback to inject animations
    const wrappedOnChunk = (chunk: ChatCompletionChunk) => {
      transformer.transformChunk(chunk);
      onChunk(chunk);
    };

    // Wrap onComplete to stop animation
    const wrappedOnComplete = () => {
      transformer.complete();
      onComplete?.();
    };

    // Wrap onError to stop animation with error
    const wrappedOnError = (error: Error) => {
      transformer.complete();
      onError?.(error);
    };

    try {
      await originalExecuteStreaming(
        request,
        wrappedOnChunk,
        wrappedOnComplete,
        wrappedOnError,
        mode
      );
    } finally {
      transformer.complete();
    }
  };
}

// ============================================================================
// Animation Presets
// ============================================================================

export const ANIMATION_PRESETS = {
  // Hermes-style preset
  hermes: {
    type: 'brain' as AnimationType,
    thinkingMessage: '🧠 Thinking...',
    processingMessage: '⚡ Processing...',
    completionMessage: '✨ Complete',
  },
  
  // Minimal preset
  minimal: {
    type: 'dots' as AnimationType,
    thinkingMessage: 'Thinking...',
    processingMessage: 'Processing...',
    completionMessage: 'Done',
  },
  
  // Cute preset
  cute: {
    type: 'thinking' as AnimationType,
    thinkingMessage: '(｡◕‿◕｡) Pondering...',
    processingMessage: '(✿◠‿◠) Working...',
    completionMessage: '(≧◡≦) Done!',
  },
  
  // Professional preset
  professional: {
    type: 'processing' as AnimationType,
    thinkingMessage: 'Analyzing...',
    processingMessage: 'Generating...',
    completionMessage: 'Complete',
  },
};

// ============================================================================
// Default Export
// ============================================================================

export default {
  AnimationManager,
  StreamingAnimationTransformer,
  enhanceProxyWithAnimations,
  ANIMATION_PRESETS,
};
