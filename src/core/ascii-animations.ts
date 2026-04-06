// ============================================================================
// ASCII Animations for Streaming UI Events
// ============================================================================

export type AnimationType = 'thinking' | 'processing' | 'searching' | 'analyzing' | 'success' | 'error';

export interface ASCIIAnimation {
  frames: string[];
  interval: number;
  color?: string;
}

// Cute ASCII animations
export const ASCII_ANIMATIONS: Record<AnimationType, ASCIIAnimation> = {
  thinking: {
    frames: [
      '🤔 💭',
      '💭 🤔',
      '🧠 ✨',
      '✨ 🧠',
      '💡 🎯',
      '🎯 💡',
    ],
    interval: 800,
    color: '\x1b[36m', // Cyan
  },
  processing: {
    frames: [
      '⠋',
      '⠙',
      '⠹',
      '⠸',
      '⠼',
      '⠴',
      '⠦',
      '⠧',
      '⠇',
      '⠏',
    ],
    interval: 100,
    color: '\x1b[35m', // Magenta
  },
  searching: {
    frames: [
      '🔍 ◀',
      '◀ 🔍',
      '🔍 ▶',
      '▶ 🔍',
      '🔎 ◀',
      '◀ 🔎',
    ],
    interval: 200,
    color: '\x1b[33m', // Yellow
  },
  analyzing: {
    frames: [
      '📊 ▓',
      '▓ 📊',
      '📈 ▒',
      '▒ 📈',
      '📉 ░',
      '░ 📉',
    ],
    interval: 300,
    color: '\x1b[34m', // Blue
  },
  success: {
    frames: [
      '✅',
      '🎉',
      '⭐',
      '✨',
    ],
    interval: 500,
    color: '\x1b[32m', // Green
  },
  error: {
    frames: [
      '❌',
      '⚠️',
      '🚨',
    ],
    interval: 600,
    color: '\x1b[31m', // Red
  },
};

// ASCII art borders and boxes
export const ASCII_BORDERS = {
  simple: {
    topLeft: '+',
    topRight: '+',
    bottomLeft: '+',
    bottomRight: '+',
    horizontal: '-',
    vertical: '|',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
  },
  bold: {
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
    horizontal: '━',
    vertical: '┃',
  },
};

// Progress bar ASCII
export function createProgressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent.toFixed(0)}%`;
}

// Spinner frames
export const SPINNER_FRAMES = [
  '◜',
  '◠',
  '◝',
  '◞',
  '◡',
  '◟',
];

// Bouncing ball animation
export const BOUNCING_BALL = [
  '(●)',
  '( ●)',
  '(  ●)',
  '(   ●)',
  '(    ●)',
  '(   ●)',
  '(  ●)',
  '( ●)',
  '(●)',
];

// Wave animation
export const WAVE_ANIMATION = [
  '   🌊   ',
  '  🌊🌊  ',
  ' 🌊🌊🌊 ',
  '🌊🌊🌊🌊',
  ' 🌊🌊🌊 ',
  '  🌊🌊  ',
];

// Pulse animation
export const PULSE_ANIMATION = [
  '●',
  '◉',
  '○',
  '◉',
];

// Typing dots animation
export const TYPING_DOTS = [
  '.  ',
  '.. ',
  '...',
  ' ..',
  '  .',
  '   ',
];

// Heart beat animation
export const HEARTBEAT = [
  '♡',
  '♥',
  '♡',
  '♥',
];

// Orbit animation
export const ORBIT_ANIMATION = [
  '○ ●',
  '● ○',
  ' ○●',
  '●○ ',
];

// Loading dots
export const LOADING_DOTS = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
];

// Get animation frame
export function getAnimationFrame(
  animationType: AnimationType,
  frameIndex: number
): string {
  const animation = ASCII_ANIMATIONS[animationType];
  const index = frameIndex % animation.frames.length;
  const frame = animation.frames[index];
  const color = animation.color || '';
  const reset = '\x1b[0m';
  return `${color}${frame}${reset}`;
}

// Create bordered message
export function createBorderedMessage(
  message: string,
  borderStyle: keyof typeof ASCII_BORDERS = 'rounded'
): string {
  const border = ASCII_BORDERS[borderStyle];
  const lines = message.split('\n');
  const maxLength = Math.max(...lines.map(l => l.length));
  
  const top = `${border.topLeft}${border.horizontal.repeat(maxLength + 2)}${border.topRight}`;
  const bottom = `${border.bottomLeft}${border.horizontal.repeat(maxLength + 2)}${border.bottomRight}`;
  const middle = lines.map(line => 
    `${border.vertical} ${line.padEnd(maxLength)} ${border.vertical}`
  ).join('\n');
  
  return `${top}\n${middle}\n${bottom}`;
}

// Center text in width
export function centerText(text: string, width: number): string {
  const padding = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(padding) + text + ' '.repeat(width - text.length - padding);
}

// Rainbow color animation
export function rainbowText(text: string, offset: number = 0): string {
  const colors = [
    '\x1b[31m', // Red
    '\x1b[33m', // Yellow
    '\x1b[32m', // Green
    '\x1b[36m', // Cyan
    '\x1b[34m', // Blue
    '\x1b[35m', // Magenta
  ];
  
  return text.split('').map((char, i) => {
    const colorIndex = (i + offset) % colors.length;
    return `${colors[colorIndex]}${char}\x1b[0m`;
  }).join('');
}
