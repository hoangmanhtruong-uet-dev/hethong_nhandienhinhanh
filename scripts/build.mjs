import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

function gitBuildId() {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 12);
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return `local-${Date.now()}`;
  }
}

const buildId = gitBuildId();
const replacements = new Map([
  ['__VISION_APP_VERSION__', packageJson.version],
  ['__VISION_BUILD_ID__', buildId],
]);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ['index.html', 'style.css', 'script.js', 'yolo-runtime.js', 'manifest.webmanifest', 'sw.js']) {
  await cp(resolve(root, file), resolve(dist, file));
}

for (const file of ['index.html', 'script.js', 'sw.js']) {
  const target = resolve(dist, file);
  let contents = await readFile(target, 'utf8');
  for (const [token, value] of replacements) contents = contents.replaceAll(token, value);
  await writeFile(target, contents, 'utf8');
}
await cp(resolve(root, 'assets'), resolve(dist, 'assets'), { recursive: true });
await mkdir(resolve(dist, 'vendor'), { recursive: true });
for (const file of [
  'ort.webgpu.min.js',
  'ort.wasm.min.js',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]) {
  await cp(resolve(root, 'node_modules', 'onnxruntime-web', 'dist', file), resolve(dist, 'vendor', file));
}

console.log(`Vision AI v${packageJson.version}+${buildId} production build completed: dist/`);
