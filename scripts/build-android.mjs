import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const javaFile = windows ? 'java.exe' : 'java';
const android = join(root, 'android');
const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
const children = (directory) => existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => join(directory, item.name)) : [];

function findJava() {
  const candidates = [
    process.env.JAVA_HOME,
    ...children(join(root, '.tooling')),
    ...(windows ? [
      join(process.env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'),
      ...children(join(localAppData, 'Programs', 'Microsoft')),
      ...children(join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft')),
      ...children(join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium')),
      ...children(join(process.env.ProgramFiles || 'C:\\Program Files', 'Java')),
    ] : [
      ...children('/usr/lib/jvm'),
      ...children('/Library/Java/JavaVirtualMachines').map((path) => join(path, 'Contents', 'Home')),
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    ]),
    ...children(join(homedir(), '.jdks')),
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    const executable = join(candidate, 'bin', javaFile);
    if (!existsSync(executable)) continue;
    const result = spawnSync(executable, ['-version'], { encoding: 'utf8', windowsHide: true });
    const match = `${result.stdout || ''}${result.stderr || ''}`.match(/version\s+"(\d+)/);
    if (result.status === 0 && match && Number(match[1]) >= 21) return candidate;
  }
  throw new Error('JDK 21+ is required. Set JAVA_HOME to a JDK 21 folder, install Android Studio, or extract a portable JDK 21 inside .tooling/. No global environment changes are made by this script.');
}

function findSdk() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(localAppData, 'Android', 'Sdk'), join(homedir(), 'Library', 'Android', 'sdk'), join(homedir(), 'Android', 'Sdk')].filter(Boolean);
  const sdk = candidates.find((candidate) => existsSync(join(candidate, 'platforms', 'android-36')));
  if (!sdk) throw new Error('Android SDK Platform 36 is required. Install it with Android Studio SDK Manager and set ANDROID_HOME if it is outside the default location.');
  return sdk;
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unknown'}).`);
}

function main() {
  if (!existsSync(join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'))) throw new Error('Dependencies are missing. Run npm ci in the project folder first.');
  if (!existsSync(join(android, 'gradlew'))) throw new Error('The Android project is missing. Restore the android/ directory from the project sources.');
  const java = findJava();
  const sdk = findSdk();
  const env = { ...process.env, JAVA_HOME: java, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, DEBUG: '' };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${join(java, 'bin')}${windows ? ';' : ':'}${env[pathKey] || ''}`;
  const sdkProperty = sdk.replaceAll('\\', '/').replaceAll(':', '\\:').replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  writeFileSync(join(android, 'local.properties'), `# Generated locally by scripts/build-android.mjs; do not commit.\nsdk.dir=${sdkProperty}\n`);
  console.log(`Building KROK with JDK: ${java}`);
  console.log(`Android SDK: ${sdk}`);
  if (windows) run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm.cmd', 'run', 'build'], root, env);
  else run('npm', ['run', 'build'], root, env);
  run(process.execPath, [join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'], root, env);
  if (windows) run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', '.\\gradlew.bat', '--no-daemon', 'assembleDebug'], android, env);
  else run('sh', ['gradlew', '--no-daemon', 'assembleDebug'], android, env);
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Package version must use semantic versioning.');
  const filename = `krok-${version}-debug.apk`;
  const releases = join(root, 'releases');
  mkdirSync(releases, { recursive: true });
  const destination = join(releases, filename);
  copyFileSync(join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), destination);
  const digest = createHash('sha256').update(readFileSync(destination)).digest('hex');
  writeFileSync(`${destination}.sha256`, `${digest}  ${filename}\n`);
  console.log(`\nAPK: ${destination}\nSHA256: ${digest}\nThis is a debug-signed APK for direct testing, not a Google Play release bundle.`);
}

try { main(); } catch (error) { console.error(`\n${error.message}`); process.exitCode = 1; }
