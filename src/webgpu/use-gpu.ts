import { useEffect, useId, useRef } from "react";
import { useGPUDevice } from "./gpu-device";
import { shortId, type H, hashed } from "~/utils/other";
import { useMemoBag } from "~/utils/hooks";
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

type GPU_API = {
  createBuffer: (desc: GPUBufferDescriptor) => H<GPUBuffer>;
  createTexture: (desc: GPUTextureDescriptor) => H<GPUTexture>;
  createShaderModule: (desc: GPUShaderModuleDescriptor) => H<GPUShaderModule>;
  createRenderPipeline: (
    desc: GPURenderPipelineDescriptor
  ) => H<GPURenderPipeline>;
  createComputePipeline: (
    desc: GPUComputePipelineDescriptor
  ) => H<GPUComputePipeline>;
};

export function useGPU<
  T extends Record<string, unknown | null | undefined>,
  R extends Record<string, unknown>
>(
  bag: T,
  callback: (
    gpu: GPU_API,
    bag: NoUndefinedField<T> & { device: GPUDevice }
  ) => R,
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
    []
  );

  return (
    useMemoBag(
      { ...bag, device },
      (bag) => {
        if (!currentBuffersRef.current) {
          currentBuffersRef.current = new Map();
        }
        if (!currentTexturesRef.current) {
          currentTexturesRef.current = new Map();
        }

        if (!device) {
          return {};
        }

        const unusedBuffers = new Set([...currentBuffersRef.current.keys()]);
        const unusedTextures = new Set([...currentTexturesRef.current.keys()]);

        const deviceAPI = {
          current: {
            createBuffer: (desc: GPUBufferDescriptor) => {
              if (!currentBuffersRef.current) throw new Error("Unreachable");

              const key = hash(
                Object.assign(desc, { owningDevice: device.instanceId }),
                {
                  replacer: (value: unknown) => {
                    // eslint-disable-next-line
                    // @ts-ignore
                    if (
                      value &&
                      typeof value === "object" &&
                      "instanceId" in value
                    ) {
                      return value.instanceId;
                    }
                    return value;
                  },
                }
              );

              const existing = currentBuffersRef.current.get(key);

              if (existing) {
                unusedBuffers.delete(key);
                return existing;
              }

              const resource = hashed(device.createBuffer(desc));

              log(
                `Created buffer ${shortId(
                  resource.instanceId
                )} for instance ${id}`
              );

              currentBuffersRef.current.set(key, resource);

              return resource;
            },
            createTexture: (desc: GPUTextureDescriptor) => {
              if (!currentTexturesRef.current) throw new Error("Unreachable");

              const key = hash(
                Object.assign(desc, { owningDevice: device.instanceId }),
                {
                  replacer: (value: unknown) => {
                    // eslint-disable-next-line
                    // @ts-ignore
                    if (
                      value &&
                      typeof value === "object" &&
                      "instanceId" in value
                    ) {
                      return value.instanceId;
                    }
                    return value;
                  },
                }
              );

              const existing = currentTexturesRef.current.get(key);

              if (existing) {
                unusedTextures.delete(key);
                return existing;
              }

              const resource = hashed(device.createTexture(desc));

              log(
                `Created texture ${shortId(
                  resource.instanceId
                )} for instance ${id}`
              );

              currentTexturesRef.current.set(key, resource);

              return resource;
            },
            createShaderModule: (desc: GPUShaderModuleDescriptor) => {
              let cache = SHADER_CACHE.get(device);

              if (!cache) {
                cache = new Map();
                SHADER_CACHE.set(device, cache);
              }

              const key = hash(desc, {
                replacer: (value: unknown) => {
                  // eslint-disable-next-line
                  // @ts-ignore
                  if (
                    value &&
                    typeof value === value &&
                    typeof value === "object" &&
                    "instanceId" in value
                  ) {
                    return value.instanceId;
                  }
                  return value;
                },
              });

              const fromCache = cache.get(key);

              if (fromCache) {
                return fromCache;
              }

              const resource = hashed(device.createShaderModule(desc));

              log(
                `Created shader ${shortId(resource.instanceId)} for device ${
                  device.instanceId
                }`
              );

              cache.set(key, resource);

              return resource;
            },
            createRenderPipeline: (desc: GPURenderPipelineDescriptor) => {
              let cache = RENDER_PIPELINE_CACHE.get(device);

              if (!cache) {
                cache = new Map();
                RENDER_PIPELINE_CACHE.set(device, cache);
              }

              const key = hash(desc, {
                replacer: (value: unknown) => {
                  // eslint-disable-next-line
                  // @ts-ignore
                  if (
                    value &&
                    typeof value === value &&
                    typeof value === "object" &&
                    "instanceId" in value
                  ) {
                    return value.instanceId;
                  }
                  return value;
                },
              });

              const fromCache = cache.get(key);

              if (fromCache) {
                return fromCache;
              }

              const resource = hashed(device.createRenderPipeline(desc));

              log(
                `Created render pipeline ${shortId(
                  resource.instanceId
                )} for device ${device.instanceId}`
              );

              cache.set(key, resource);

              return resource;
            },
            createComputePipeline: (desc: GPUComputePipelineDescriptor) => {
              let cache = COMPUTE_PIPELINE_CACHE.get(device);

              if (!cache) {
                cache = new Map();
                COMPUTE_PIPELINE_CACHE.set(device, cache);
              }

              const key = hash(desc, {
                replacer: (value: unknown) => {
                  // eslint-disable-next-line
                  // @ts-ignore
                  if (
                    value &&
                    typeof value === "object" &&
                    "instanceId" in value
                  ) {
                    return value.instanceId;
                  }
                  return value;
                },
              });

              const fromCache = cache.get(key);

              if (fromCache) {
                return fromCache;
              }

              const resource = hashed(device.createComputePipeline(desc));

              log(
                `Created compute pipeline ${shortId(
                  resource.instanceId
                )} for device ${device.instanceId}`
              );

              cache.set(key, resource);

              return resource;
            },
            createSampler: (desc: GPUSamplerDescriptor) => {
              let cache = SAMPLER_CACHE.get(device);

              if (!cache) {
                cache = new Map();
                SAMPLER_CACHE.set(device, cache);
              }

              const key = hash(desc, {
                replacer: (value: unknown) => {
                  // eslint-disable-next-line
                  // @ts-ignore
                  if (
                    value &&
                    typeof value === "object" &&
                    "instanceId" in value
                  ) {
                    return value.instanceId;
                  }
                  return value;
                },
              });

              const fromCache = cache.get(key);

              if (fromCache) {
                return fromCache;
              }

              const resource = hashed(device.createSampler(desc));

              log(
                `Created sampler ${shortId(resource.instanceId)} for device ${
                  device.instanceId
                }`
              );

              cache.set(key, resource);

              return resource;
            },
          },
        };

        // Isn't this triple indirection?
        // maybe just deviceAPI is ok to invalidate the callback bag
        const callbacks = {
          createBuffer: (desc: GPUBufferDescriptor) =>
            deviceAPI.current.createBuffer(desc),
          createTexture: (desc: GPUTextureDescriptor) =>
            deviceAPI.current.createTexture(desc),
          createShaderModule: (desc: GPUShaderModuleDescriptor) =>
            deviceAPI.current.createShaderModule(desc),
          createRenderPipeline: (desc: GPURenderPipelineDescriptor) =>
            deviceAPI.current.createRenderPipeline(desc),
          createComputePipeline: (desc: GPUComputePipelineDescriptor) =>
            deviceAPI.current.createComputePipeline(desc),
          createSampler: (desc: GPUSamplerDescriptor) =>
            deviceAPI.current.createSampler(desc),
        };

        const out = callbackRef.current(callbacks, { ...bag, device });

        deviceAPI.current.createBuffer = () => {
          throw new Error(
            "Cannot call `createBuffer` outside the render cycle of useGPU."
          );
        };
        deviceAPI.current.createTexture = () => {
          throw new Error(
            "Cannot call `createTexture` outside the render cycle of useGPU."
          );
        };
        deviceAPI.current.createShaderModule = () => {
          throw new Error(
            "Cannot call `createShaderModule` outside the render cycle of useGPU."
          );
        };
        deviceAPI.current.createRenderPipeline = () => {
          throw new Error(
            "Cannot call `createRenderPipeline` outside the render cycle of useGPU."
          );
        };
        deviceAPI.current.createComputePipeline = () => {
          throw new Error(
            "Cannot call `createComputePipeline` outside the render cycle of useGPU."
          );
        };

        unusedBuffers.forEach((resource) => {
          const fromCache = currentBuffersRef.current!.get(resource);
          if (!fromCache) {
            console.warn(
              `Buffer keyed ${resource} on instance ${id} was deleted outside the render cycle, this should not happen.`
            );
            return;
          }
          currentBuffersRef.current!.delete(resource);
          log(
            `Destroyed buffer ${shortId(
              fromCache.instanceId
            )} (key: ${resource}) on instance ${id}, unused.`
          );
          fromCache.destroy();
        });
        unusedTextures.forEach((resource) => {
          const fromCache = currentBuffersRef.current!.get(resource);
          if (!fromCache) {
            console.warn(
              `Texture keyed ${resource} on instance ${id} was deleted outside the render cycle, this should not happen.`
            );
            return;
          }
          currentBuffersRef.current!.delete(resource);
          log(
            `Destroyed texture ${shortId(
              fromCache.instanceId
            )} on instance ${id}, unused.`
          );
          fromCache.destroy();
        });

        return out;
      },
      [...deps, device]
    ) ?? {}
  );
}
