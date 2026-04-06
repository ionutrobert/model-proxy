/**
 * Streaming Animation Transformer
 * Integrates animations into the model proxy's streaming responses
 */

import { ChatCompletionChunk } from '../core/types.js';
import { AnimationManager } from './animation-manager.js';
import { isThinkingModel } from './thinking-detector.js';

export interface StreamingAnimationOptions {
  enabled?: boolean;
  animationType?: string;
  injectDuringThinking?: boolean;
  injectDuringProcessing?: boolean;
  maxAnimationFrames?: number;
}

export class StreamingAnimationTransformer {
  private animationManager: AnimationManager;
  private options: Required<StreamingAnimationOptions>;
  private isThinkingPhase = false;
  private thinkingStartTime = 0;
  private animationInterval: NodeJS.Timeout | null = null;
  private lastAnimationFrame = '';
  private animationInjected = false;

  constructor(options: StreamingAnimationOptions = {}) {
    this.animationManager = new AnimationManager();
    this.options = {
      enabled: options.enabled ?? this.isEnabledByEnv(),
      animationType: options.animationType ?? this.getEnvAnimationType(),
      injectDuringThinking: options.injectDuringThinking ?? true,
      injectDuringProcessing: options.injectDuringProcessing ?? false,
      maxAnimationFrames: options.maxAnimationFrames ?? 100,
    };
  }

  private isEnabledByEnv(): boolean {
    return process.env.PROXY_ANIMATIONS_ENABLED !== 'false' && process.env.PROXY_ANIMATIONS_ENABLED !== '0';
  }

  private getEnvAnimationType(): string {
    return process.env.PROXY_ANIMATION_TYPE || 'brain';
  }

  /**
   * Transform a streaming response chunk
   * Injects animations based on the current phase (thinking/processing)
   */
  async *transformStream(
    originalStream: AsyncIterable<ChatCompletionChunk>,
    modelId: string
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    if (!this.options.enabled) {
      // Passthrough if animations disabled
      yield* originalStream;
      return;
    }

    const isThinkingModelFlag = isThinkingModel(modelId);
    let chunkBuffer: ChatCompletionChunk[] = [];
    let isFirstChunk = true;

    try {
      for await (const chunk of originalStream) {
        if (isFirstChunk) {
          isFirstChunk = false;
          // Start animation if this is a thinking model
          if (isThinkingModelFlag && this.options.injectDuringThinking) {
            this.startThinkingAnimation();
          }
        }

        // Check if we're still in thinking phase
        if (isThinkingModelFlag && this.isThinkingPhase && chunk.choices?.[0]?.delta?.content) {
          const content = chunk.choices[0].delta.content;
          
          // Detect end of thinking phase (when we see normal content)
          if (this.isThinkingPhase && !content.includes(' <think> ') && !content.includes('💭')) {
            this.stopThinkingAnimation();
          }
        }

        // Buffer chunks during thinking phase
        if (this.isThinkingPhase) {
          chunkBuffer.push(chunk);
          
          // Inject animation frame periodically
          if (this.shouldInjectAnimation()) {
            const animationFrame = this.getAnimationFrame();
            if (animationFrame && animationFrame !== this.lastAnimationFrame) {
              this.lastAnimationFrame = animationFrame;
              yield this.createAnimationChunk(animationFrame);
            }
          }
        } else {
          // Flush buffered chunks
          if (chunkBuffer.length > 0) {
            yield* chunkBuffer;
            chunkBuffer = [];
          }
          
          // Yield current chunk
          yield chunk;
        }
      }

      // Cleanup
      this.stopThinkingAnimation();
      
      // Flush any remaining buffered chunks
      if (chunkBuffer.length > 0) {
        yield* chunkBuffer;
      }
    } catch (error) {
      this.stopThinkingAnimation();
      throw error;
    }
  }

  private startThinkingAnimation(): void {
    this.isThinkingPhase = true;
    this.thinkingStartTime = Date.now();
    this.animationInjected = false;
    
    // Set animation type based on model
    this.animationManager.setAnimationType('thinking');
    this.animationManager.start();
  }

  private stopThinkingAnimation(): void {
    this.isThinkingPhase = false;
    
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    }
    
    this.animationManager.stop();
  }

  private shouldInjectAnimation(): boolean {
    // Limit animation frames to prevent spam
    return this.animationManager.getFrameCount() < this.options.maxAnimationFrames;
  }

  private getAnimationFrame(): string {
    return this.animationManager.getNextFrame();
  }

  private createAnimationFrame(content: string): ChatCompletionChunk {
    return {
      id: `anim-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'proxy-animation',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: content + '\n',
          },
          finish_reason: null,
        },
      ],
    };
  }

  /**
   * Transform the executeStreaming method in ModelProxyCore
   */
  public wrapExecuteStreaming(
    originalMethod: (
      request: import('../core/types.js').ChatCompletionRequest,
      onChunk: (chunk: ChatCompletionChunk) => void,
      onComplete?: () => void,
      onError?: (error: Error) => void,
      mode?: import('../core/types.js').SelectionMode
    ) => Promise<void>
  ): typeof originalMethod {
    return async (request, onChunk, onComplete, onError, mode) => {
      if (!this.options.enabled) {
        // Passthrough if disabled
        return originalMethod(request, onChunk, onComplete, onError, mode);
      }

      const modelId = request.model || 'unknown';
      let hasSentFirstChunk = false;
      
      // Wrap the onChunk callback to inject animations
      const wrappedOnChunk = (chunk: ChatCompletionChunk) => {
        if (!hasSentFirstChunk) {
          hasSentFirstChunk = true;
          // Start animation on first chunk
          if (this.options.injectDuringProcessing) {
            this.animationManager.setAnimationType('processing');
            this.animationManager.start();
          }
        }
        onChunk(chunk);
      };

      const wrappedOnComplete = () => {
        this.animationManager.stop();
        onComplete?.();
      };

      const wrappedOnError = (error: Error) => {
        this.animationManager.stop();
        onError?.(error);
      };

      try {
        await originalMethod(request, wrappedOnChunk, wrappedOnComplete, wrappedOnError, mode);
      } finally {
        this.animationManager.stop();
      }
    };
  }
}

export default StreamingAnimationTransformer;
