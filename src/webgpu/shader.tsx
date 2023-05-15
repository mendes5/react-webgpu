import { useMemo, useRef } from "react";
import { useGPUDevice } from "./gpu-device";
import stringHash from "string-hash";
import { usePresentationFormat } from "./canvas";
import { type V } from "~/utils/hooks";
import { type H, hashed, shortId } from "~/utils/other";
import { log } from "./logger";

const SAMPLER_CACHE: Map<GPUDevice, Map<string, H<GPUSampler>>> = new Map();

const SHADER_CACHE: Map<GPUDevice, Map<number, H<GPUShaderModule>>> = new Map();

const RENDER_PIPELINE_CACHE: Map<
  GPUDevice,
  Map<string, H<GPURenderPipeline>>
> = new Map();

const COMPUTE_PIPELINE_CACHE: Map<
  GPUDevice,
  Map<string, H<GPUComputePipeline>>
> = new Map();

if (typeof window !== "undefined")
  Object.assign(window, {
    CACHES: {
      SAMPLER_CACHE,
      SHADER_CACHE,
      RENDER_PIPELINE_CACHE,
      COMPUTE_PIPELINE_CACHE,
    },
  });

export const useDeviceCache = <K, V>(
  key: K,
  create: (device: GPUDevice) => V,
  globalCache: Map<GPUDevice, Map<K, V>>
): V | null => {
  const device = useGPUDevice();

  const createRef = useRef(create);
  createRef.current = create;

  return useMemo(() => {
    if (device) {
      const cache = upsertDeviceCache(device, globalCache);
      const fromCache = cache.get(key);

      if (fromCache) return fromCache;

      const newItem = createRef.current(device);

      cache.set(key, newItem);

      return newItem;
    }
    return null;
  }, [device, globalCache, key]);
};

const upsertDeviceCache = <K, V>(
  device: GPUDevice,
  globalCache: Map<GPUDevice, Map<K, V>>
): Map<K, V> => {
  const fromCache = globalCache.get(device);
  if (fromCache) return fromCache;

  const cache = new Map<K, V>();

  globalCache.set(device, cache);

  device.lost
    .then(() => {
      cache.clear();
      globalCache.delete(device);
    })
    .catch(console.error);

  return cache;
};

export const useShaderModule = (code: string, label?: string) => {
  const key = useMemo(() => stringHash(code), [code]);

  return useDeviceCache(
    key,
    (device) => {
      const shader = hashed(
        device.createShaderModule({
          label,
          code,
        })
      );
      log(`Created shader module ${shortId(shader.instanceId)}`);
      return shader;
    },
    SHADER_CACHE
  );
};

export const usePipeline = (
  shader: H<GPUShaderModule> | null,
  label?: string,
  buffers?: V<GPUVertexBufferLayout[]>
) => {
  const format = usePresentationFormat();

  return useDeviceCache(
    `${shader?.instanceId ?? ""}${buffers?.useVersionCacheBurstId ?? ""}`,
    (device) => {
      const pipeline = hashed(
        device.createRenderPipeline({
          label,
          layout: "auto",
          vertex: {
            module: shader!,
            buffers: buffers,
            entryPoint: "vsMain",
          },
          fragment: {
            module: shader!,
            entryPoint: "fsMain",
            targets: [{ format }],
          },
        })
      );
      log(`Created render pipeline ${shortId(pipeline.instanceId)}`);
      return pipeline;
    },
    RENDER_PIPELINE_CACHE
  );
};

export const useComputePipeline = (
  shader?: H<GPUShaderModule> | null,
  label?: string
): GPUComputePipeline | null => {
  return useDeviceCache(
    `${shader?.instanceId ?? ""}`,
    (device) => {
      const pipeline = hashed(
        device.createComputePipeline({
          label,
          layout: "auto",
          compute: {
            module: shader!,
            entryPoint: "computeMain",
          },
        })
      );
      log(`Created compute pipeline ${shortId(pipeline.instanceId)}`);
      return pipeline;
    },
    COMPUTE_PIPELINE_CACHE
  );
};

export const useSampler = ({
  addressModeU,
  addressModeV,
  magFilter,
  minFilter,
}: {
  addressModeU: GPUAddressMode;
  addressModeV: GPUAddressMode;
  magFilter: GPUFilterMode;
  minFilter: GPUFilterMode;
}) => {
  const key = `${addressModeU}/${addressModeV}/${magFilter}/${minFilter}`;
  return useDeviceCache(
    key,
    (device) => {
      const sampler = hashed(
        device.createSampler({
          addressModeU,
          addressModeV,
          magFilter,
          minFilter,
        })
      );
      log(`Created sampler ${shortId(sampler.instanceId)}`);
      return sampler;
    },
    SAMPLER_CACHE
  );
};
