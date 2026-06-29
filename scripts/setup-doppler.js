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

function isDopplerInstalled() {
  try {
    execSync('doppler --version', { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Refresh this process's PATH from the machine + user environment.
 * winget updates the persisted PATH but not the running shell, so without
 * this the freshly installed `doppler` binary stays invisible until restart.
 */
function refreshWindowsPath() {
  try {
    const path = execSync(
      'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'Machine\') + \';\' + [Environment]::GetEnvironmentVariable(\'Path\',\'User\')"',
      { encoding: 'utf8' }
    ).trim();
    if (path) {
      process.env.Path = path;
    }
  } catch (error) {
    console.warn('Warning: could not refresh PATH after install:', error.message);
  }
}

/**
 * Ensure the Doppler CLI is available. On Windows, install it via winget if
 * it's missing. On other platforms, print install guidance and exit.
 */
function ensureDoppler() {
  if (isDopplerInstalled()) {
    return;
  }

  if (process.platform !== 'win32') {
    console.error('Error: the Doppler CLI is not installed.');
    console.error('Install it: https://docs.doppler.com/docs/install-cli');
    process.exit(1);
  }

  // It may already be installed but missing from this shell's PATH (e.g. winget
  // installed it without a terminal restart). Refresh PATH and re-check before
  // attempting a redundant install.
  refreshWindowsPath();
  if (isDopplerInstalled()) {
    return;
  }

  console.log('Doppler CLI not found. Installing via winget...');
  console.log('');

  try {
    execSync(
      'winget install --id Doppler.doppler --source winget --accept-package-agreements --accept-source-agreements --silent',
      { stdio: 'inherit', shell: true }
    );
  } catch (error) {
    console.error('Error: winget install failed:', error.message);
    console.error('Install Doppler manually: https://docs.doppler.com/docs/install-cli');
    process.exit(1);
  }

  refreshWindowsPath();

  if (!isDopplerInstalled()) {
    console.error('Error: Doppler was installed but is still not on PATH.');
    console.error('Restart your terminal and re-run "pnpm run setup:doppler".');
    process.exit(1);
  }

  console.log('');
  console.log('✓ Doppler CLI installed');
  console.log('');
}

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

  ensureDoppler();

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
