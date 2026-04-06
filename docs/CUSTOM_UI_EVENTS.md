# Custom UI Events in Streaming

This document explains how to inject custom UI events and animations into the streaming response.

## Overview

The Model Proxy can inject custom metadata into stream chunks that clients can detect and use to display:
- ASCII animations during thinking
- Progress indicators
- Tool call status
- Custom system messages

## Implementation

### 1. Extended ChatCompletionChunk Type

```typescript
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }>;
  
  // CUSTOM FIELDS
  ui_event?: 'thinking_start' | 'thinking_end' | 'tool_call_start' | 'tool_call_end' | 'progress';
  animation?: {
    type: 'spinner' | 'progress' | 'ascii';
    frames?: string[];
    current_frame?: number;
    interval?: number;
    text?: string;
  };
  metadata?: {
    stage?: 'reasoning' | 'planning' | 'executing' | 'done';
    progress?: number;
    tool_name?: string;
    message?: string;
  };
}
```

### 2. Example: Detecting Reasoning Content

```typescript
protected parseStreamChunk(line: string): ChatCompletionChunk | null {
  const parsed = JSON.parse(data);
  const choices = parsed.choices || [];
  
  const mappedChoices = choices.map((choice: any) => {
    const delta = choice.delta || {};
    
    // Check for reasoning_content (thinking models)
    const hasReasoning = delta.reasoning_content || delta.reasoning;
    
    // Inject UI event when reasoning starts
    if (hasReasoning && !this.reasoningStarted) {
      this.reasoningStarted = true;
      return {
        index: choice.index || 0,
        delta: delta,
        finish_reason: choice.finish_reason || null,
        
        // CUSTOM UI EVENT
        ui_event: 'thinking_start',
        animation: {
          type: 'ascii',
          frames: ['🤔', '💭', '🧠'],
          interval: 500,
          text: 'Thinking...'
        },
        metadata: {
          stage: 'reasoning',
          progress: 0
        }
      };
    }
    
    // Inject UI event when reasoning ends
    if (!hasReasoning && this.reasoningStarted) {
      this.reasoningStarted = false;
      return {
        index: choice.index || 0,
        delta: delta,
        finish_reason: choice.finish_reason || null,
        
        // CUSTOM UI EVENT
        ui_event: 'thinking_end',
        metadata: {
          stage: 'done',
          progress: 1
        }
      };
    }
    
    return {
      index: choice.index || 0,
      delta: delta,
      finish_reason: choice.finish_reason || null,
    };
  });
  
  return {
    id: parsed.id,
    object: 'chat.completion.chunk',
    created: parsed.created,
    model: parsed.model,
    choices: mappedChoices,
  };
}
```

### 3. Example: Tool Call Detection

```typescript
// In parseStreamChunk
const hasToolCalls = delta.tool_calls && Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;

if (hasToolCalls && !this.toolCallStarted) {
  this.toolCallStarted = true;
  
  // Extract tool name
  const toolName = delta.tool_calls[0]?.function?.name || 'unknown';
  
  return {
    index: choice.index || 0,
    delta: delta,
    finish_reason: choice.finish_reason || null,
    
    // CUSTOM UI EVENT
    ui_event: 'tool_call_start',
    animation: {
      type: 'spinner',
      frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
      interval: 100,
      text: `Calling ${toolName}...`
    },
    metadata: {
      stage: 'executing',
      tool_name: toolName,
      progress: 0.5
    }
  };
}
```

## Client-Side Handling

### Example: React Component

```typescript
import { useState, useEffect } from 'react';

function StreamingChat() {
  const [messages, setMessages] = useState([]);
  const [currentAnimation, setCurrentAnimation] = useState(null);
  const [animationFrame, setAnimationFrame] = useState(0);

  useEffect(() => {
    let animationInterval;
    
    async function streamResponse() {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer your-key'
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello!' }],
          stream: true
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            // Handle custom UI events
            if (data.ui_event) {
              handleUIEvent(data);
            }
            
            // Handle normal content
            if (data.choices?.[0]?.delta?.content) {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: data.choices[0].delta.content
              }]);
            }
          }
        }
      }
    }

    function handleUIEvent(data) {
      switch (data.ui_event) {
        case 'thinking_start':
          setCurrentAnimation(data.animation);
          // Start animation loop
          animationInterval = setInterval(() => {
            setAnimationFrame(prev => (prev + 1) % (data.animation.frames?.length || 1));
          }, data.animation.interval || 500);
          break;
          
        case 'thinking_end':
          setCurrentAnimation(null);
          clearInterval(animationInterval);
          break;
          
        case 'tool_call_start':
          setCurrentAnimation(data.animation);
          animationInterval = setInterval(() => {
            setAnimationFrame(prev => (prev + 1) % (data.animation.frames?.length || 1));
          }, data.animation.interval || 100);
          break;
          
        case 'tool_call_end':
          setCurrentAnimation(null);
          clearInterval(animationInterval);
          break;
      }
    }

    streamResponse();

    return () => {
      if (animationInterval) clearInterval(animationInterval);
    };
  }, []);

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i}>{msg.content}</div>
      ))}
      
      {currentAnimation && (
        <div className="animation">
          <span>{currentAnimation.text}</span>
          <span>{currentAnimation.frames?.[animationFrame]}</span>
        </div>
      )}
    </div>
  );
}
```

### Example: Terminal/CLI Client

```typescript
import * as readline from 'readline';

async function streamChat() {
  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer your-key'
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Hello!' }],
      stream: true
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const stdout = process.stdout;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        
        // Handle custom UI events
        if (data.ui_event) {
          handleTerminalUIEvent(data);
        }
        
        // Handle normal content
        if (data.choices?.[0]?.delta?.content) {
          stdout.write(data.choices[0].delta.content);
        }
      }
    }
  }
}

function handleTerminalUIEvent(data) {
  const stdout = process.stdout;
  
  switch (data.ui_event) {
    case 'thinking_start':
      stdout.write('\n🤔 Thinking...\n');
      break;
      
    case 'thinking_end':
      stdout.write('✓ Done thinking\n\n');
      break;
      
    case 'tool_call_start':
      stdout.write(`\n🔧 ${data.animation.text} ${data.animation.frames?.[0]}\n`);
      break;
      
    case 'tool_call_end':
      stdout.write('✓ Tool call complete\n\n');
      break;
      
    case 'progress':
      const { current, total, message } = data.metadata.progress;
      const percent = Math.round((current / total) * 100);
      stdout.write(`\r[${'='.repeat(Math.floor(percent / 5))}${' '.repeat(20 - Math.floor(percent / 5))}] ${percent}% ${message}`);
      break;
  }
}

streamChat();
```

## Available UI Events

| Event | Description | Use Case |
|-------|-------------|----------|
| `thinking_start` | Model started reasoning | Show thinking animation |
| `thinking_end` | Model finished reasoning | Hide thinking animation |
| `tool_call_start` | Model requested tool call | Show tool execution spinner |
| `tool_call_end` | Tool call completed | Show success message |
| `progress` | Progress update | Show progress bar |

## Animation Types

| Type | Description | Example Frames |
|------|-------------|----------------|
| `spinner` | Rotating spinner | `['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']` |
| `ascii` | ASCII art | `['🤔', '💭', '🧠']` |
| `progress` | Progress bar | N/A (use metadata.progress) |

## Configuration

Enable custom UI events by setting environment variable:

```env
ENABLE_UI_EVENTS=true
```

## Notes

- Custom fields are optional and won't break OpenAI compatibility
- Clients can ignore these fields if they don't support them
- Events are injected based on stream content detection
- Animation frames cycle automatically on the client side
