import { useEffect, useId, useRef, useState } from "react";
import { useGPUDevice } from "./gpu-device";
import { shortId, type H, hashed } from "~/utils/other";
import { useEffectBag } from "~/utils/hooks";
import hash from "object-hash";
import { log } from "./logger";

// Resources put in those caches are global to a specific device
// and can be used anywhere the program, and are only cleared
// when the device is destroyed
const SAMPLER_CACHE: Map<GPUDevice, Map<string, H<GPUSampler>>> = new Map();

const SHADER_CACHE: Map<GPUDevice, Map<string, H<GPUShaderModule>>> = new Map();

const RENDER_PIPELINE_CACHE: Map<
  GPUDevice,
  Map<string, H<GPURenderPipeline>>
> = new Map();

const COMPUTE_PIPELINE_CACHE: Map<
  GPUDevice,
  Map<string, H<GPUComputePipeline>>
> = new Map();

type NoUndefinedField<T> = {
  [P in keyof T]-?: NonNullable<T[P]>;
};

export type GPU_API = {
  createBuffer: (desc: GPUBufferDescriptor) => H<GPUBuffer>;
  createTexture: (desc: GPUTextureDescriptor) => H<GPUTexture>;
  createShaderModule: (desc: GPUShaderModuleDescriptor) => H<GPUShaderModule>;
  createRenderPipeline: (
    desc: GPURenderPipelineDescriptor
  ) => H<GPURenderPipeline>;
  createComputePipeline: (
    desc: GPUComputePipelineDescriptor
  ) => H<GPUComputePipeline>;
  createSampler: (desc: GPUSamplerDescriptor) => H<GPUSampler>;
};

const localResourceHash = (
  desc: GPUObjectDescriptorBase,
  owner: H<GPUDevice>
) =>
  hash(Object.assign(desc, { owningDevice: owner.instanceId }), {
    replacer: (value: unknown) => {
      // eslint-disable-next-line
      // @ts-ignore
      if (value && typeof value === "object" && "instanceId" in value) {
        return value.instanceId;
      }
      return value;
    },
  });

const globalResourceHash = (desc: GPUObjectDescriptorBase) =>
  hash(desc, {
    replacer: (value: unknown) => {
      // eslint-disable-next-line
      // @ts-ignore
      if (value && typeof value === "object" && "instanceId" in value) {
        return value.instanceId;
      }
      return value;
    },
  });

const stubGPUProxy: GPU_API = {
  createBuffer() {
    throw new Error(
      "Cannot call gpu.createBuffer() outside the rendering cycle of useGPU."
    );
  },
  createComputePipeline() {
    throw new Error(
      "Cannot call gpu.createComputePipeline() outside the rendering cycle of useGPU."
    );
  },
  createRenderPipeline() {
    throw new Error(
      "Cannot call gpu.createRenderPipeline() outside the rendering cycle of useGPU."
    );
  },
  createSampler() {
    throw new Error(
      "Cannot call gpu.createSampler() outside the rendering cycle of useGPU."
    );
  },
  createShaderModule() {
    throw new Error(
      "Cannot call gpu.createShaderModule() outside the rendering cycle of useGPU."
    );
  },
  createTexture() {
    throw new Error(
      "Cannot call gpu.createTexture() outside the rendering cycle of useGPU."
    );
  },
};

const GPUProxy = Object.assign({}, stubGPUProxy);

export const gpu: GPU_API = {
  createBuffer: (desc) => GPUProxy.createBuffer(desc),
  createComputePipeline: (desc) => GPUProxy.createComputePipeline(desc),
  createRenderPipeline: (desc) => GPUProxy.createRenderPipeline(desc),
  createSampler: (desc) => GPUProxy.createSampler(desc),
  createShaderModule: (desc) => GPUProxy.createShaderModule(desc),
  createTexture: (desc) => GPUProxy.createTexture(desc),
};

export function useGPU<
  T extends Record<string, unknown | null | undefined>,
  R extends Record<string, unknown>
>(
  bag: T,
  callback: (bag: NoUndefinedField<T> & { device: GPUDevice }) => R | void,
  deps: unknown[]
): Partial<R> {
  const id = useId();
  const device = useGPUDevice();
  const currentBuffersRef = useRef<Map<string, H<GPUBuffer>>>();
  const currentTexturesRef = useRef<Map<string, H<GPUTexture>>>();

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(
    () => () => {
      if (currentBuffersRef.current?.size) {
        for (const buffer of currentBuffersRef.current.values()) {
          log(
            `Destroying buffer ${shortId(
              buffer.instanceId
            )} of instance ${id}, unmount`
          );
          buffer.destroy();
        }
        currentBuffersRef.current.clear();
      }
      if (currentTexturesRef.current?.size) {
        for (const texture of currentTexturesRef.current.values()) {
          log(
            `Destroying texture ${shortId(
              texture.instanceId
            )} of instance ${id}, unmount`
          );
          texture.destroy();
        }
        currentTexturesRef.current.clear();
      }
    },
    [device, id]
  );

  const [result, setResult] = useState<Partial<R>>({});

  useEffectBag(
    { ...bag, device },
    (bag) => {
      const { device } = bag;

      if (!currentBuffersRef.current) currentBuffersRef.current = new Map();
      if (!currentTexturesRef.current) currentTexturesRef.current = new Map();

      const currentBuffers = currentBuffersRef.current;
      const currentTextures = currentTexturesRef.current;

      if (!device) return;

      const unusedBuffers = new Set([...currentBuffers.keys()]);
      const unusedTextures = new Set([...currentTextures.keys()]);

      GPUProxy.createBuffer = (desc: GPUBufferDescriptor) => {
        const key = localResourceHash(desc, device);
        const existing = currentBuffers.get(key);

        if (existing) {
          unusedBuffers.delete(key);
          return existing;
        }

        const resource = hashed(device.createBuffer(desc));
        currentBuffers.set(key, resource);

        log(
          `Created buffer ${desc.label ?? "<unnamed>"} (${shortId(
            resource.instanceId
          )}) for instance ${id}`
        );
        return resource;
      };
      GPUProxy.createTexture = (desc: GPUTextureDescriptor) => {
        const key = localResourceHash(desc, device);
        const existing = currentTextures.get(key);

        if (existing) {
          unusedTextures.delete(key);
          return existing;
        }

        const resource = hashed(device.createTexture(desc));
        currentTextures.set(key, resource);

        log(
          `Created texture ${desc.label ?? "<unnamed>"} ${shortId(
            resource.instanceId
          )} for instance ${id}`
        );
        return resource;
      };
      GPUProxy.createShaderModule = (desc: GPUShaderModuleDescriptor) => {
        let cache = SHADER_CACHE.get(device);
        if (!cache) {
          const newCache = new Map();
          cache = newCache;
          SHADER_CACHE.set(device, cache);
          device.lost
            .then(() => {
              SHADER_CACHE.delete(device);
              const size = newCache.size;
              newCache.clear();
              log(
                `Cleared ${size} items from shader cache of device ${device.instanceId}`
              );
            })
            .catch(console.error);
        }

        const key = globalResourceHash(desc);
        const fromCache = cache.get(key);

        if (fromCache) return fromCache;

        const resource = hashed(device.createShaderModule(desc));
        cache.set(key, resource);

        log(
          `Created shader ${desc.label ?? "<unnamed>"} ${shortId(
            resource.instanceId
          )} for device ${shortId(device.instanceId)}`
        );
        return resource;
      };
      GPUProxy.createRenderPipeline = (desc: GPURenderPipelineDescriptor) => {
        let cache = RENDER_PIPELINE_CACHE.get(device);
        if (!cache) {
          const newCache = new Map();
          cache = newCache;
          RENDER_PIPELINE_CACHE.set(device, cache);
          device.lost
            .then(() => {
              RENDER_PIPELINE_CACHE.delete(device);
              const size = newCache.size;
              newCache.clear();
              log(
                `Cleared ${size} items from render pipeline cache of device ${device.instanceId}`
              );
            })
            .catch(console.error);
        }

        const key = globalResourceHash(desc);
        const fromCache = cache.get(key);

        if (fromCache) return fromCache;

        const resource = hashed(device.createRenderPipeline(desc));
        log(
          `Created render pipeline ${desc.label ?? "<unnamed>"} ${shortId(
            resource.instanceId
          )} for device ${shortId(device.instanceId)}`
        );

        cache.set(key, resource);

        return resource;
      };
      GPUProxy.createComputePipeline = (desc: GPUComputePipelineDescriptor) => {
        let cache = COMPUTE_PIPELINE_CACHE.get(device);
        if (!cache) {
          const newCache = new Map();
          cache = newCache;
          COMPUTE_PIPELINE_CACHE.set(device, cache);
          device.lost
            .then(() => {
              COMPUTE_PIPELINE_CACHE.delete(device);
              const size = newCache.size;
              newCache.clear();
              log(
                `Cleared ${size} items from compute pipeline cache of device ${device.instanceId}`
              );
            })
            .catch(console.error);
        }

        const key = globalResourceHash(desc);
        const fromCache = cache.get(key);

        if (fromCache) return fromCache;

        const resource = hashed(device.createComputePipeline(desc));
        cache.set(key, resource);

        log(
          `Created compute pipeline ${desc.label ?? "<unnamed>"} ${shortId(
            resource.instanceId
          )} for device ${shortId(device.instanceId)}`
        );
        return resource;
      };
      GPUProxy.createSampler = (desc: GPUSamplerDescriptor) => {
        let cache = SAMPLER_CACHE.get(device);
        if (!cache) {
          const newCache = new Map();
          cache = newCache;
          SAMPLER_CACHE.set(device, cache);
          device.lost
            .then(() => {
              SAMPLER_CACHE.delete(device);
              const size = newCache.size;
              newCache.clear();
              log(
                `Cleared ${size} items from sampler cache of device ${device.instanceId}`
              );
            })
            .catch(console.error);
        }

        const key = globalResourceHash(desc);
        const fromCache = cache.get(key);

        if (fromCache) return fromCache;

        const resource = hashed(device.createSampler(desc));
        cache.set(key, resource);

        log(
          `Created sampler ${desc.label ?? "<unnamed>"} ${shortId(
            resource.instanceId
          )} for device ${shortId(device.instanceId)}`
        );
        return resource;
      };

      const out = callbackRef.current({ ...bag, device });

      Object.assign(GPUProxy, stubGPUProxy);

      unusedBuffers.forEach((resource) => {
        const fromCache = currentBuffers.get(resource);
        if (!fromCache) {
          console.warn(
            `Buffer keyed ${resource} on instance ${id} was deleted outside the render cycle, this should not happen.`
          );
          return;
        }
        currentBuffers.delete(resource);
        log(
          `Destroyed buffer ${shortId(
            fromCache.instanceId
          )} on instance ${id}, unused.`
        );
        fromCache.destroy();
      });
      unusedTextures.forEach((resource) => {
        const fromCache = currentTextures.get(resource);
        if (!fromCache) {
          console.warn(
            `Texture keyed ${resource} on instance ${id} was deleted outside the render cycle, this should not happen.`
          );
          return;
        }
        currentTextures.delete(resource);
        log(
          `Destroyed texture ${shortId(
            fromCache.instanceId
          )} on instance ${id}, unused.`
        );
        fromCache.destroy();
      });

      setResult(out ?? {});
    },
    () => setResult({}),
    [...deps, device, id]
  );

  return result;
}
