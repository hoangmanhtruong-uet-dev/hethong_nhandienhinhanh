import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ['index.html', 'style.css', 'script.js', 'yolo-runtime.js', 'manifest.webmanifest', 'sw.js']) {
  await cp(resolve(root, file), resolve(dist, file));
}
await cp(resolve(root, 'assets'), resolve(dist, 'assets'), { recursive: true });
await mkdir(resolve(dist, 'vendor'), { recursive: true });
for (const file of [
  'ort.webgpu.min.js',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]) {
  await cp(resolve(root, 'node_modules', 'onnxruntime-web', 'dist', file), resolve(dist, 'vendor', file));
}

console.log('Vision AI production build completed: dist/');
