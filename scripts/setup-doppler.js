#!/usr/bin/env node

/**
 * Interactive Doppler service token setup
 * Cross-platform script that works on Windows, macOS, and Linux
 */

import { execSync } from 'child_process';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise((resolve) => {
    // Use muted output for password-like input
    process.stdout.write(question);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let input = '';

    const onData = (char) => {
      const charStr = char.toString();

      if (charStr === '\n' || charStr === '\r') {
        stdin.removeListener('data', onData);
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw);
        }
        process.stdout.write('\n');
        resolve(input);
      } else if (charStr === '\u0003') {
        // Ctrl+C
        process.exit(1);
      } else if (charStr === '\u007F' || charStr === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        input += charStr;
      }
    };

    stdin.on('data', onData);
    stdin.resume();
  });
}

async function main() {
  console.log('Configuring Doppler service token...');
  console.log('');
  console.log('Generate a service token in Doppler dashboard:');
  console.log('  Project → dev config → Access tab → Generate');
  console.log('');

  const token = await prompt('Enter dev token: ');

  if (!token || token.trim() === '') {
    console.error('Error: Token cannot be empty');
    process.exit(1);
  }

  console.log('');
  console.log('Configuring token...');

  try {
    execSync(`doppler configure set token "${token.trim()}" --silent`, {
      stdio: 'inherit',
      shell: true,
    });
    console.log('✓ Token configured');
    console.log('');
    console.log('✓ Doppler token configured successfully');
  } catch (error) {
    console.error('Error configuring Doppler token:', error.message);
    process.exit(1);
  }

  rl.close();
  process.exit(0);
}

main();
