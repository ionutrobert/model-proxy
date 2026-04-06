# Animation System Documentation

## Overview

The Model Proxy includes a sophisticated animation system inspired by Hermes Agent's `KawaiiSpinner`. This system provides visual feedback during model execution, streaming responses, and various processing phases.

## 🎯 Key Features

- **9 Animation Types**: dots, bounce, grow, arrows, star, moon, pulse, brain, sparkle
- **Kawaii Faces**: Cute emoji faces for different states (thinking, waiting, processing)
- **ANSI Color Support**: Full terminal color support with customizable palettes
- **Environment Variable Configuration**: Easy enable/disable and customization
- **Streaming Integration**: Automatic animation injection during streaming responses
- **Clean Output**: Animations stripped from final responses

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_ANIMATIONS_ENABLED` | `true` | Enable/disable animations (set to `false` to disable) |
| `PROXY_ANIMATION_TYPE` | `processing` | Animation type to use (see Animation Types below) |
| `PROXY_ANIMATION_SPEED` | `120` | Animation speed in milliseconds |
| `PROXY_ANIMATION_COLORS` | `true` | Enable/disable ANSI colors (set to `false` to disable) |
| `PROXY_ANIMATION_SHOW_TIME` | `true` | Show elapsed time during animation (set to `false` to hide) |

### Default Behavior

**✅ Animations are ENABLED by default**

The system will automatically:
- Show animations during model execution
- Display elapsed time
- Use ANSI colors (when in a TTY)
- Use the 'processing' animation type

## 🎨 Animation Types

### Available Types

| Type | Description | Default Speed | Color |
|------|-------------|--------------|-------|
| `dots` | Classic spinner dots | 120ms | Cyan |
| `bounce` | Bouncing dots | 150ms | Magenta |
| `grow` | Growing bar | 80ms | Blue |
| `arrows` | Rotating arrows | 100ms | Green |
| `star` | Star burst | 120ms | Yellow |
| `moon` | Moon phases | 200ms | Dim |
| `pulse` | Pulse animation | 150ms | Cyan |
| `brain` | Brain thinking | 180ms | Magenta |
| `sparkle` | Sparkle effect | 100ms | Yellow |
| `thinking` | Kawaii thinking faces | 800ms | Cyan |
| `processing` | Processing spinner | 100ms | Magenta |
| `searching` | Search animation | 200ms | Yellow |

### Animation Frames

#### Dots
```
⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
```

#### Brain
```
🧠 💭 💡 ✨ 💫 🌟 💡 💭
```

#### Thinking (Kawaii Faces)
```
(｡•́︿•̀｡) (◔_◔) (¬‿¬) ( •_•)>⌐■-■ (⌐■_■)
```

## 🚀 Usage Examples

### Basic Usage

```typescript
import { ModelProxyCore } from './core/index.js';

// Animations are automatically enabled
const proxy = createModelProxy({
  providers: [...]
});

// Streaming with animations
await proxy.executeStreaming(
  request,
  (chunk) => {
    // Chunks include animations during processing
    console.log(chunk);
  },
  () => {
    // On complete, animations are stripped
    console.log('Done!');
  }
);
```

### Custom Animation Type

```bash
# Set animation type via environment variable
export PROXY_ANIMATION_TYPE=brain
```

```typescript
// Or configure programmatically
import { AnimationManager } from './animations/index.js';

const animator = new AnimationManager({
  type: 'brain',
  message: 'Thinking...',
  showTime: true,
  color: true,
});

animator.start();
// ... do work ...
animator.stop('✓ Complete');
```

### Disable Animations

```bash
# Disable animations globally
export PROXY_ANIMATIONS_ENABLED=false
```

```typescript
// Or disable for specific instance
const transformer = new StreamingAnimationTransformer({
  enabled: false,
});
```

### Custom Speed

```bash
# Set custom animation speed (in milliseconds)
export PROXY_ANIMATION_SPEED=200
```

### Disable Colors

```bash
# Disable ANSI colors
export PROXY_ANIMATION_COLORS=false
```

## 🎭 Animation Presets

The system includes pre-configured animation presets:

### Hermes Preset
```typescript
import { ANIMATION_PRESETS } from './animations/index.js';

const config = ANIMATION_PRESETS.hermes;
// {
//   type: 'brain',
//   thinkingMessage: '🧠 Thinking...',
//   processingMessage: '⚡ Processing...',
//   completionMessage: '✨ Complete',
// }
```

### Minimal Preset
```typescript
const config = ANIMATION_PRESETS.minimal;
// {
//   type: 'dots',
//   thinkingMessage: 'Thinking...',
//   processingMessage: 'Processing...',
//   completionMessage: 'Done',
// }
```

### Cute Preset
```typescript
const config = ANIMATION_PRESETS.cute;
// {
//   type: 'thinking',
//   thinkingMessage: '(｡◕‿◕｡) Pondering...',
//   processingMessage: '(✿◠‿◠) Working...',
//   completionMessage: '(≧◡≦) Done!',
// }
```

### Professional Preset
```typescript
const config = ANIMATION_PRESETS.professional;
// {
//   type: 'processing',
//   thinkingMessage: 'Analyzing...',
//   processingMessage: 'Generating...',
//   completionMessage: 'Complete',
// }
```

## 🔧 Advanced Usage

### Streaming Animation Transformer

```typescript
import { StreamingAnimationTransformer } from './animations/index.js';

const transformer = new StreamingAnimationTransformer({
  enabled: true,
  animationType: 'brain',
  detectThinking: true,
  thinkingMessage: '🤔 Thinking...',
  processingMessage: '⚡ Processing...',
  completionMessage: '✓ Complete',
});

// Transform streaming chunks
for await (const chunk of transformer.transformStream(stream)) {
  console.log(chunk);
}

// Complete animation
transformer.complete();
```

### Quick Animation

```typescript
import { AnimationManager } from './animations/index.js';

// Animate for a fixed duration
await AnimationManager.animateQuick('Loading data...', 2000, 'dots');

// Animate a promise
const result = await AnimationManager.animatePromise(
  fetchData(),
  'Fetching data...',
  'processing'
);
```

### Custom Animation Manager

```typescript
import { AnimationManager } from './animations/index.js';

const animator = new AnimationManager({
  type: 'sparkle',
  message: 'Processing...',
  interval: 100,
  showTime: true,
  color: true,
});

animator.start('Starting task...');
// ... do work ...
animator.updateMessage('Almost done...');
// ... more work ...
animator.stop('✓ Task complete!');
```

## 🎨 Kawaii Faces

The system includes cute emoji faces for different states:

### Thinking Faces
```
(｡◕‿◕｡) (◕‿◕✿) ٩(◕‿◕｡)۶ (✿◠‿◠) ( ˘▽˘)っ
```

### Waiting Faces
```
♪(´ε` ) (ノ´ヮ`)ノ*:・゚✧ ヾ(＾∇＾) (◕ᴗ◕✿) ヽ(>∀<☆)ノ
```

### Processing Faces
```
ヽ(>∀<☆)ノ (☆▽☆) ( ˘▽˘)っ (≧◡≦) ヾ(￣▽￣)
```

### Search Faces
```
🔍 ◀ ◀ 🔍 🔍 ▶ ▶ 🔍 🔎 ◀ ◀ 🔎
```

## 📊 Thinking Verbs

Random thinking verbs for variety:
```
pondering, contemplating, musing, cogitating, ruminating,
deliberating, mulling, reflecting, processing, reasoning,
analyzing, computing, synthesizing, formulating, brainstorming
```

## 🛠️ Utility Functions

### Create Bordered Message
```typescript
import { AnimationManager } from './animations/index.js';

const message = animator.createBorderedMessage('Hello World');
// Output:
// ╭──────────────╮
// │ Hello World  │
// ╰──────────────╯
```

### Get Random Thinking Verb
```typescript
const verb = animator.getRandomThinkingVerb();
// Returns: "pondering", "contemplating", etc.
```

### Get Random Kawaii Face
```typescript
const face = animator.getRandomKawaiiFace('thinking');
// Returns: "(｡◕‿◕｡)", "(◕‿◕✿)", etc.
```

## 🔍 Detection Features

The streaming transformer automatically detects:

### Thinking Phase
- Content containing ` </think></think></think>` (thinking tokens)`
- Content containing `💭` (thought bubble emoji)
- Content containing `🤔` (thinking face emoji)

### Answer Phase
- Content without thinking tokens
- Non-empty trimmed content

## 🎯 Integration Points

### Model Proxy Core
The animation system is integrated into:
- `ModelProxyCore.executeStreaming()` - Automatic animation during streaming
- `StreamingAnimationTransformer` - Chunk-level animation injection

### Adapters
Animation support in:
- Express adapter (`src/adapters/express.ts`)
- Next.js adapter (`src/adapters/nextjs.ts`)

## 📝 Best Practices

### 1. Use Appropriate Animation Types
- `brain` for thinking/reasoning tasks
- `processing` for general processing
- `dots` for minimal feedback
- `sparkle` for completion/success states

### 2. Consider Your Audience
- Use `professional` preset for production environments
- Use `cute` preset for development/personal use
- Use `minimal` preset for CI/CD environments

### 3. Respect TTY Detection
The system automatically:
- Disables animations in non-TTY environments
- Disables animations in CI environments
- Respects `CI` environment variable

### 4. Performance Considerations
- Default speed (120ms) is optimized for most use cases
- Slower animations (200ms+) for long-running tasks
- Faster animations (80ms) for quick operations

## 🐛 Troubleshooting

### Animations Not Showing

**Check:**
```bash
# Verify animations are enabled
echo $PROXY_ANIMATIONS_ENABLED
# Should be empty or "true"

# Verify TTY detection
echo $TERM
# Should be set (e.g., "xterm-256color")
```

**Solution:**
```bash
# Enable animations
export PROXY_ANIMATIONS_ENABLED=true

# Or force enable in code
const transformer = new StreamingAnimationTransformer({
  enabled: true,
});
```

### Colors Not Working

**Check:**
```bash
# Verify colors are enabled
echo $PROXY_ANIMATION_COLORS
# Should be empty or "true"

# Verify terminal supports colors
echo $TERM
# Should support 256 colors
```

**Solution:**
```bash
# Enable colors
export PROXY_ANIMATION_COLORS=true

# Or use a terminal that supports ANSI colors
```

### Animation Too Fast/Slow

**Solution:**
```bash
# Adjust speed (in milliseconds)
export PROXY_ANIMATION_SPEED=200
```

### Animations in Logs

**Problem:** Animations appearing in log files

**Solution:**
```bash
# Disable animations in non-TTY environments
export PROXY_ANIMATIONS_ENABLED=false

# Or check for TTY in your code
if (!process.stdout.isTTY) {
  process.env.PROXY_ANIMATIONS_ENABLED = 'false';
}
```

## 📚 API Reference

### AnimationManager

```typescript
class AnimationManager extends EventEmitter {
  constructor(config?: Partial<AnimationConfig>)
  
  start(message?: string): void
  stop(finalMessage?: string): void
  updateMessage(message: string): void
  
  static async animateQuick(
    message: string,
    duration: number,
    type?: AnimationType
  ): Promise<void>
  
  static async animatePromise<T>(
    promise: Promise<T>,
    message: string,
    type?: AnimationType
  ): Promise<T>
  
  createBorderedMessage(message: string): string
  getRandomThinkingVerb(): string
  getRandomKawaiiFace(type?: string): string
}
```

### StreamingAnimationTransformer

```typescript
class StreamingAnimationTransformer {
  constructor(config?: AnimationTransformerConfig)
  
  transformChunk(chunk: ChatCompletionChunk): ChatCompletionChunk
  async *transformStream(
    stream: AsyncIterable<ChatCompletionChunk>
  ): AsyncGenerator<ChatCompletionChunk>
  
  complete(): void
  getBufferedChunks(): ChatCompletionChunk[]
  clearBuffer(): void
}
```

## 🎨 Color Reference

### ANSI Color Codes Used

| Color | Code | Usage |
|-------|------|-------|
| Cyan | `\x1b[36m` | Thinking, dots, pulse |
| Magenta | `\x1b[35m` | Processing, bounce, brain |
| Yellow | `\x1b[33m` | Searching, star, sparkle |
| Blue | `\x1b[34m` | Analyzing, grow |
| Green | `\x1b[32m` | Success, arrows |
| Red | `\x1b[31m` | Error |
| Dim | `\x1b[2m` | Moon, secondary text |
| Bold | `\x1b[1m` | Emphasis |
| Reset | `\x1b[0m` | Reset to default |

## 📖 Examples

### Example 1: Basic Streaming with Animations

```typescript
import { createModelProxy } from './core/index.js';

const proxy = createModelProxy({
  providers: [
    { id: 'openai', apiKey: 'sk-...' }
  ]
});

await proxy.executeStreaming(
  { messages: [{ role: 'user', content: 'Hello!' }] },
  (chunk) => {
    // Animation shows during processing
    console.log(chunk.choices[0]?.delta?.content);
  },
  () => {
    console.log('\n✓ Complete');
  }
);
```

### Example 2: Custom Animation Configuration

```bash
# Set environment variables
export PROXY_ANIMATION_TYPE=brain
export PROXY_ANIMATION_SPEED=150
export PROXY_ANIMATION_COLORS=true
export PROXY_ANIMATION_SHOW_TIME=true
```

### Example 3: Programmatic Animation Control

```typescript
import { AnimationManager } from './animations/index.js';

const animator = new AnimationManager({
  type: 'sparkle',
  message: 'Loading...',
});

animator.start();

// Simulate work
await new Promise(resolve => setTimeout(resolve, 3000));

animator.stop('✓ Loaded!');
```

### Example 4: Streaming with Custom Transformer

```typescript
import { StreamingAnimationTransformer } from './animations/index.js';

const transformer = new StreamingAnimationTransformer({
  enabled: true,
  animationType: 'brain',
  thinkingMessage: '🧠 Deep thinking...',
  processingMessage: '⚡ Generating response...',
  completionMessage: '✨ Response ready!',
});

for await (const chunk of transformer.transformStream(stream)) {
  console.log(chunk.choices[0]?.delta?.content);
}

transformer.complete();
```

## 🎯 Summary

**Default Configuration:**
- ✅ Animations: **ENABLED**
- 🎨 Colors: **ENABLED**
- ⏱️ Show Time: **ENABLED**
- 🔄 Animation Type: `processing`
- ⚡ Animation Speed: `120ms`

**To Disable:**
```bash
export PROXY_ANIMATIONS_ENABLED=false
```

**To Customize:**
```bash
export PROXY_ANIMATION_TYPE=brain
export PROXY_ANIMATION_SPEED=200
export PROXY_ANIMATION_COLORS=false
export PROXY_ANIMATION_SHOW_TIME=false
```

The animation system is designed to be **non-intrusive** and **automatically disabled** in non-TTY environments, making it safe for production use while providing excellent visual feedback during development.
