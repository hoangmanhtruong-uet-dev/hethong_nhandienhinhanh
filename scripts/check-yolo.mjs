import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web/wasm';

ort.env.wasm.numThreads = 1;
const model = await readFile(new URL('../assets/models/yolov8n.onnx', import.meta.url));
const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
const input = new ort.Tensor('float32', new Float32Array(3 * 640 * 640), [1, 3, 640, 640]);
const output = await session.run({ [session.inputNames[0]]: input });
const tensor = output[session.outputNames[0]];
if (JSON.stringify(tensor.dims) !== JSON.stringify([1, 84, 8400])) {
  throw new Error(`Unexpected YOLO output shape: ${JSON.stringify(tensor.dims)}`);
}
console.log('YOLO ONNX smoke test passed:', tensor.dims.join('x'));
