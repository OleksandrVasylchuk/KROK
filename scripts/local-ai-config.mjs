import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const keyFile = fileURLToPath(new URL('../.local/openai-key.dpapi', import.meta.url));
const reader = fileURLToPath(new URL('./read-ai-key.ps1', import.meta.url));
let cachedSignature = '';
let cachedKey = '';
function clearKeyCache() { cachedSignature = ''; cachedKey = ''; return ''; }

// The Windows user encrypts the key locally. Nothing from this module is bundled
// with the browser or APK, and neither key nor decryption errors are logged.
export async function loadOpenAIKey() {
  const environmentKey = process.env.OPENAI_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  if (process.platform !== 'win32') return '';
  try {
    const info = await stat(keyFile);
    if (!info.isFile() || info.size > 32768) return clearKeyCache();
    const signature = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    if (signature === cachedSignature) return cachedKey;
    const { stdout } = await execute('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', reader, '-KeyFile', keyFile,
    ], { windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 32768 });
    const value = stdout.trim();
    if (!value.startsWith('sk-') || value.length > 4096 || /\s/.test(value)) return clearKeyCache();
    cachedSignature = signature;
    cachedKey = value;
    return value;
  } catch {
    return clearKeyCache();
  }
}
