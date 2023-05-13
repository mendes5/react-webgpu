import { useMemo } from "react";
import { useGPUDevice } from "./gpu-device";
import stringHash from "string-hash";
import { createShaderModule } from "./calls";
import { usePresentationFormat } from "./canvas";
import { lResource } from "./logger";

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

    lResource("Shader created", { hash, code: [code], label });

    SHADER_CACHE.set(hash, shader);

    return shader;
  }, [device, code, label]);
};

const RENDER_PIPELINE_CACHE: Map<GPUShaderModule, GPURenderPipeline> =
  new Map();

const COMPUTE_PIPELINE_CACHE: Map<GPUShaderModule, GPUComputePipeline> =
  new Map();

export const usePipeline = (shader: GPUShaderModule, label?: string) => {
  const device = useGPUDevice();
  const format = usePresentationFormat();

  return useMemo(() => {
    const fromCache = RENDER_PIPELINE_CACHE.get(shader);

    if (fromCache) {
      RENDER_PIPELINE_CACHE.get(shader);
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

    RENDER_PIPELINE_CACHE.set(shader, pipeline);

    lResource("Pipeline created", {
      pipeline,
      shader,
      format,
      RENDER_PIPELINE_CACHE,
    });

    return pipeline;
  }, [device, label, shader, format]);
};

export const useComputePipeline = (
  shader: GPUShaderModule,
  label?: string
): GPUComputePipeline => {
  const device = useGPUDevice();

  return useMemo(() => {
    const fromCache = COMPUTE_PIPELINE_CACHE.get(shader);

    if (fromCache) {
      return fromCache;
    }

    const pipeline = device.createComputePipeline({
      label,
      layout: "auto",
      compute: {
        module: shader,
        entryPoint: "computeMain",
      },
    });

    return pipeline;
  }, [device, label, shader]);
};
