import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types';

export interface IModelProxy {
  execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  executeStreaming(request: ChatCompletionRequest): AsyncGenerator<StreamingEvent>;
  refreshHealth(): Promise<void>;
}

export interface StreamingEvent {
  type: 'content' | 'model_switch' | 'verification' | 'error' | 'done';
  data: unknown;
}
