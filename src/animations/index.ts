// ============================================================================
// Enhanced Animation System for Model Proxy
// Kawaii-style ASCII face animations inspired by Hermes Agent
// ============================================================================

import { EventEmitter } from 'events';
import * as readline from 'readline';

export type AnimationType = 
  | 'dots' 
  | 'kawaii-thinking' 
  | 'kawaii-processing'
  | 'kawaii-waiting';

export interface AnimationConfig {
  type: AnimationType;
  message: string;
  interval: number;
  showTime: boolean;
  color: boolean;
}

// ============================================================================
// KAWAII ASCII FACE ANIMATIONS - Original creations, similar to Hermes style
// ============================================================================

// Animated kawaii faces for thinking - cycling through different expressions
const KAWAII_THINKING_FRAMES = [
  '(｡•́︿•̀｡)',  // Worried thinking
  '(◔_◔)',       // Skeptical
  '(¬‿¬)',        // Side-eye thinking
  '(•_•)',        // Focused
  '(・_・;)',     // Uncertain
  '(￣ω￣)',       // Calm contemplation
  '(・_・)',      // Neutral thinking
  '(￣ー￣)',      // Smug consideration
];

// Animated kawaii faces for processing - active work expressions  
const KAWAII_PROCESSING_FRAMES = [
  '(⌐■_■)',       // Cool processing
  '( •_•)>⌐■-■',  // Deal with it
  '(◕‿◕)',        // Happy progress
  '(｡◕‿◕｡)',     // Joyful
  '٩(◕‿◕｡)۶',    // Excited
  '(✿◠‿◠)',       // Pleasant
  '( ˘▽˘)っ',     // Content
  '(≧◡≦)',        // Very happy
];

// Animated kawaii faces for waiting - patient expressions
const KAWAII_WAITING_FRAMES = [
  '♪(´ε` )',           // Musical waiting
  '(ノ´ヮ`)ノ*:・゚✧',  // Celebratory wait
  'ヾ(＾∇＾)',          // Cheerful
  '(◕ᴗ◕✿)',            // Sweet waiting
  'ヽ(>∀<☆)ノ',        // Excited wait
];

// Classic dots spinner - the default
const DOTS_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Animation frames mapping
const ANIMATION_FRAMES: Record<AnimationType, string[]> = {
  'dots': DOTS_FRAMES,
  'kawaii-thinking': KAWAII_THINKING_FRAMES,
  'kawaii-processing': KAWAII_PROCESSING_FRAMES,
  'kawaii-waiting': KAWAII_WAITING_FRAMES,
};

// ANSI color codes
const ANSI_COLORS = {
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

// Thinking verbs for dynamic messages
const THINKING_VERBS = [
  'pondering', 'contemplating', 'musing', 'cogitating', 'ruminating',
  'deliberating', 'mulling', 'reflecting', 'processing', 'reasoning',
  'analyzing', 'computing', 'synthesizing', 'formulating', 'brainstorming'
];

// ============================================================================
// Animation Manager Class
// ============================================================================

export class AnimationManager extends EventEmitter {
  private frames: string[];
  private currentFrame = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private message: string;
  private _isRunning = false;
  private readonly showTime: boolean;
  private readonly useColors: boolean;
  private animationType: AnimationType;

  constructor(config: Partial<AnimationConfig> = {}) {
    super();
    
    this.animationType = config.type || this.getEnvAnimationType();
    this.message = config.message || 'Processing';
    this.showTime = config.showTime !== undefined ? config.showTime : this.getEnvShowTime();
    this.useColors = config.color !== undefined ? config.color : this.getEnvUseColors();
    this.frames = ANIMATION_FRAMES[this.animationType] || DOTS_FRAMES;
  }

  // Environment variable getters
  private getEnvAnimationType(): AnimationType {
    const envType = process.env.PROXY_ANIMATION_TYPE as AnimationType;
    if (envType && ANIMATION_FRAMES[envType]) {
      return envType;
    }
    return 'dots'; // Default to classic dots
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
      'dots': ANSI_COLORS.cyan,
      'kawaii-thinking': ANSI_COLORS.magenta,
      'kawaii-processing': ANSI_COLORS.green,
      'kawaii-waiting': ANSI_COLORS.blue,
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
    if (!this.isAnimationEnabled() || !this.isTTY() || this._isRunning) {
      return;
    }
    
    if (message) {
      this.message = message;
    }
    
    this._isRunning = true;
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
    if (!this._isRunning || !this.intervalId) {
      return;
    }
    
    this._isRunning = false;
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

  // Set animation type
  setAnimationType(type: AnimationType): void {
    this.animationType = type;
    this.frames = ANIMATION_FRAMES[type] || DOTS_FRAMES;
  }

  // Get current interval based on animation type
  private getInterval(): number {
    // Base interval for dots is 120ms as requested
    const intervalMap: Record<AnimationType, number> = {
      'dots': 120,
      'kawaii-thinking': 300,     // Slower for expressions
      'kawaii-processing': 250,    // Medium speed
      'kawaii-waiting': 400,       // Slowest for waiting
    };
    
    const envInterval = parseInt(process.env.PROXY_ANIMATION_SPEED || '');
    if (!isNaN(envInterval)) {
      return envInterval;
    }
    
    return intervalMap[this.animationType] || 120;
  }

  // Get a random thinking verb
  getRandomThinkingVerb(): string {
    return THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)];
  }

  // Get current frame number
  getFrameCount(): number {
    return this.currentFrame;
  }

  // Get next frame
  getNextFrame(): string {
    const frame = this.frames[this.currentFrame % this.frames.length];
    this.currentFrame++;
    return frame;
  }

  // Check if running
  get isRunning(): boolean {
    return this._isRunning;
  }

  // Static utility: create a quick animation
  static async animateQuick(
    message: string,
    duration: number,
    type: AnimationType = 'dots'
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
    type: AnimationType = 'dots'
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

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }[];
}

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
      animationType: config.animationType || 'dots',
      detectThinking: config.detectThinking !== false,
      thinkingMessage: config.thinkingMessage || 'Thinking...',
      processingMessage: config.processingMessage || 'Processing...',
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
    return content.includes(' olved: ') === false && content.trim().length > 0;
  }

  // Detect if a chunk contains final answer
  private isAnswerChunk(chunk: ChatCompletionChunk): boolean {
    const content = chunk.choices?.[0]?.delta?.content || '';
    return content.trim().length > 0;
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
// Animation Presets
// ============================================================================

export const ANIMATION_PRESETS = {
  // Default preset - classic dots
  default: {
    type: 'dots' as AnimationType,
    thinkingMessage: 'Thinking...',
    processingMessage: 'Processing...',
    completionMessage: '✓ Complete',
  },
  
  // Kawaii preset - cute expressions
  kawaii: {
    type: 'kawaii-thinking' as AnimationType,
    thinkingMessage: '(｡•́︿•̀｡) Pondering...',
    processingMessage: '(◕‿◕) Working...',
    completionMessage: '(≧◡≦) Done!',
  },
  
  // Professional preset
  professional: {
    type: 'dots' as AnimationType,
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
  ANIMATION_PRESETS,
};
