import { createInterface } from 'node:readline';

function isTTY(): boolean {
  return process.stdout.isTTY && process.stdin.isTTY;
}

/**
 * Ask a yes/no question.
 * defaultYes=true  → "[Y/n]"
 * defaultYes=false → "[y/N]"
 */
export function confirm(question: string, defaultYes = false): Promise<boolean> {
  if (!isTTY()) {
    return Promise.resolve(defaultYes);
  }

  const suffix = defaultYes ? '[Y/n]' : '[y/N]';

  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${question} ${suffix} `, (answer: string) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') {
        resolve(defaultYes);
      } else if (trimmed === 'y' || trimmed === 'yes') {
        resolve(true);
      } else if (trimmed === 'n' || trimmed === 'no') {
        resolve(false);
      } else {
        resolve(defaultYes);
      }
    });
  });
}

/**
 * Read a secret value without echoing characters.
 * Shows '*' for each typed character.
 */
export function hiddenInput(prompt: string): Promise<string> {
  if (!isTTY()) {
    throw new Error(
      'Hidden input requires an interactive terminal. ' +
        'Set credentials through environment variables in non-interactive mode.',
    );
  }

  return new Promise((resolve) => {
    // Re-ref and resume stdin — readline.close() unrefs the handle AND
    // removes its 'data' listener, which pauses the stream.  Without resume(),
    // a new 'data' listener on a paused stream never fires.
    process.stdin.ref();
    process.stdin.resume();
    process.stdout.write(prompt);
    const wasRaw = process.stdin.isRaw;
    if (!wasRaw) {
      process.stdin.setRawMode(true);
    }
    let buf = '';
    const onData = (chunk: Buffer) => {
      const char = chunk.toString('utf-8');
      if (char === '\r' || char === '\n') {
        process.stdout.write('\n');
        cleanup();
        resolve(buf);
      } else if (char === '\x03') {
        process.stdout.write('\n');
        cleanup();
        process.exit(130);
      } else if (char === '\x7f' || char === '\b') {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        buf += char;
        process.stdout.write('*');
      }
    };
    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      if (!wasRaw) {
        process.stdin.setRawMode(false);
      }
    };
    process.stdin.on('data', onData);
  });
}

/**
 * Read a visible text line. For non-secret input like file paths.
 * Unlike hiddenInput, the user sees what they type.
 */
export function textInput(prompt: string): Promise<string> {
  if (!isTTY()) {
    throw new Error('Text input requires an interactive terminal.');
  }

  return new Promise((resolve) => {
    process.stdin.ref();
    process.stdin.resume();
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

/**
 * Display numbered options and return the selected value.
 * `defaultIndex` - 0-based index of the default option (selected when user presses Enter).
 */
export function selectFromList(
  title: string,
  items: SelectOption[],
  defaultIndex = 0,
): Promise<string> {
  if (!isTTY()) {
    const defaultItem = items[defaultIndex];
    return Promise.resolve(defaultItem?.value ?? '');
  }

  return new Promise((resolve) => {
    process.stdin.resume();
    console.log(`\n${title}`);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const num = i + 1;
      const desc = item.description ? `\n   ${item.description}` : '';
      console.log(`${String(num)}. ${item.label}${desc}`);
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const defaultLabel = String(defaultIndex + 1);
    rl.question(`\nChoice [${defaultLabel}]: `, (answer: string) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === '') {
        const fallback = items[defaultIndex]?.value ?? '';
        resolve(fallback);
        return;
      }
      const idx = parseInt(trimmed, 10) - 1;
      if (idx >= 0 && idx < items.length) {
        const selected = items[idx]?.value ?? '';
        resolve(selected);
      } else {
        const fallback = items[defaultIndex]?.value ?? '';
        resolve(fallback);
      }
    });
  });
}

export interface ProgressItem {
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail?: string;
}

/**
 * Display a formatted progress list with checkmark/cross symbols.
 */
export function displayProgress(items: ProgressItem[]): void {
  for (const item of items) {
    let symbol: string;
    switch (item.status) {
      case 'pass':
        symbol = '✓';
        break;
      case 'fail':
        symbol = '✗';
        break;
      case 'warn':
        symbol = '⚠';
        break;
      case 'skip':
        symbol = '○';
        break;
      default:
        symbol = '?';
    }
    const detail = item.detail ? ` — ${item.detail}` : '';
    console.log(`${symbol} ${item.label}${detail}`);
  }
}
