import { useMemo } from "react";
import { useGPUDevice } from "./gpu-device";
import stringHash from "string-hash";
import { createShaderModule } from "./calls";
import { usePresentationFormat } from "./canvas";

const SHADER_CACHE: Map<number, GPUShaderModule> = new Map();

export const useShaderModule = (code: string, label?: string) => {
  const device = useGPUDevice();

  return useMemo(() => {
    const hash = stringHash(code);

    const fromCache = SHADER_CACHE.get(hash);

    if (fromCache) {
      return fromCache;
    }

    const shader = createShaderModule(device, code, label);

    SHADER_CACHE.set(hash, shader);

    return shader;
  }, [device, code, label]);
};

const PIPELINE_CACHE: Map<GPUShaderModule, GPURenderPipeline> = new Map();

export const usePipeline = (shader: GPUShaderModule, label?: string) => {
  const device = useGPUDevice();
  const format = usePresentationFormat();

  return useMemo(() => {
    const fromCache = PIPELINE_CACHE.get(shader);

    if (fromCache) {
      return fromCache;
    }

    const pipeline = device.createRenderPipeline({
      label,
      layout: "auto",
      vertex: {
        module: shader,
        entryPoint: "vsMain",
      },
      fragment: {
        module: shader,
        entryPoint: "fsMain",
        targets: [{ format }],
      },
    });

    return pipeline;
  }, [device, label, shader, format]);
};
