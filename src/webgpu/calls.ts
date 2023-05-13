import { lResource } from "./logger";

export function getPresentationFormat() {
  return navigator.gpu.getPreferredCanvasFormat();
}

export function configureContextPresentation(
  device: GPUDevice,
  context: GPUCanvasContext
) {
  const presentationFormat = getPresentationFormat();

  lResource("Presentation format configured", { presentationFormat });

  context.configure({
    device,
    format: presentationFormat,
  });
}

export async function requestAdapter() {
  const adapter = await navigator.gpu.requestAdapter();

  if (!adapter) {
    throw new Error("Failed to request adatper");
  }

  const device = await adapter.requestDevice();

  if (!device) {
    throw new Error("Failed to request devide");
  }

  lResource("Device created", { device });

  return device;
}

export function createShaderModule(
  device: GPUDevice,
  code: string,
  label?: string
) {
  const shader = device.createShaderModule({
    label,
    code,
  });

  return shader;
}

export const immediateRenderPass = (
  device: GPUDevice,
  label: string,
  callback: (encode: GPUCommandEncoder) => void
) => {
  const encoder = device.createCommandEncoder({ label });

  callback(encoder);

  const commandBuffer = encoder.finish();

  device.queue.submit([commandBuffer]);
};

export const renderPass = (
  encoder: GPUCommandEncoder,
  descriptor: GPURenderPassDescriptor,
  callback: (pass: GPURenderPassEncoder) => void
) => {
  const pass = encoder.beginRenderPass(descriptor);
  callback(pass);
  pass.end();
};

export const computePass = (
  encoder: GPUCommandEncoder,
  descriptor: GPUComputePassDescriptor,
  callback: (pass: GPUComputePassEncoder) => void
) => {
  const pass = encoder.beginComputePass(descriptor);
  callback(pass);
  pass.end();
};
