import { hashed } from "~/utils/other";
import { log } from "./logger";

export function getPresentationFormat() {
  return navigator.gpu.getPreferredCanvasFormat();
}

export function configureContextPresentation(
  device: GPUDevice,
  context: GPUCanvasContext
) {
  const presentationFormat = getPresentationFormat();

  log("Presentation format configured", { presentationFormat });

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

  return hashed(device);
}
