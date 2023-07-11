import {
  type MutableRefObject,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { FRAME_CALLBACK, useGPUDevice } from "./gpu-device";
import { shortId, type H, hashed } from "~/utils/other";
import { useEffectBag } from "~/utils/hooks";
import hash from "object-hash";
import { log } from "./logger";
import { useMemo } from "react";

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
  createRenderPipelineAsync: (
    desc: GPURenderPipelineDescriptor
  ) => Promise<H<GPURenderPipeline>>;
  createComputePipelineAsync: (
    desc: GPUComputePipelineDescriptor
  ) => Promise<H<GPUComputePipeline>>;
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

export type FrameBag = {
  time: number;
  encoder: GPUCommandEncoder;
  queue: GPUQueue;
};

export type ActionBag = {
  invalidate: (callback: FrameCallback) => void;
  time: number;
  encoder: GPUCommandEncoder;
  renderToken: Promise<number>;
  queue: GPUQueue;
};

export type FrameCallback = {
  valid: boolean;
  callback: (bag: FrameBag) => void;
  enabled: boolean;
  kind: "once" | "loop";
};

export const GPURendererContext = createContext<Map<string, FrameCallback>>(
  new Map()
);

export const GPUActionContext = createContext<Set<(bag: ActionBag) => unknown>>(
  new Set()
);

const isSameDependencies = (
  prev: unknown[] | undefined,
  next: unknown[] | undefined
) => {
  let valid = true;
  if (next === undefined && prev === undefined) return true;
  if (prev === undefined) valid = false;
  if (next != null && prev != null) {
    if (next === prev) return true;

    const n = prev.length || 0;
    if (n !== next.length || 0) valid = false;
    else
      for (let i = 0; i < n; ++i)
        if (prev[i] !== next[i]) {
          valid = false;
          break;
        }
  }
  return valid;
};

type GPUFields = {
  device: GPUDevice;
  frame: Record<
    string,
    (callback: (bag: FrameBag) => void, deps?: unknown[]) => FrameCallback
  >;
  action<T>(callback: (bag: ActionBag) => Promise<T>): () => Promise<T>;
  gpu: GPU_API;
};

export function useGPU<T extends Record<string, unknown | null | undefined>, R>(
  bag: T,
  callback: (bag: NoUndefinedField<T> & GPUFields) => R,
  deps: unknown[]
): Awaited<R extends Record<string, unknown> ? Partial<R> : R | undefined>;

export function useGPU<R>(
  callback: (bag: GPUFields) => R,
  deps: unknown[]
): Awaited<R extends Record<string, unknown> ? Partial<R> : R | undefined>;

export function useGPU<T extends Record<string, unknown | null | undefined>, R>(
  bagOrCallback: T | ((bag: GPUFields) => R),
  callbackOrDeps: unknown[] | ((bag: NoUndefinedField<T> & GPUFields) => R),
  maybeDeps?: unknown[]
): Awaited<R extends Record<string, unknown> ? Partial<R> : R | undefined> {
  let callback: (bag: NoUndefinedField<T> & GPUFields) => R;
  let bag: T;
  let deps;

  if (typeof bagOrCallback === "function") {
    callback = bagOrCallback;
  } else if (typeof callbackOrDeps == "function") {
    callback = callbackOrDeps;
  } else {
    throw new Error("Cannot find useGPU render callback");
  }

  if (typeof bagOrCallback === "object") {
    bag = bagOrCallback;
  } else {
    bag = {} as T;
  }

  if (Array.isArray(callbackOrDeps)) {
    deps = callbackOrDeps;
  } else {
    deps = maybeDeps ?? [];
  }

  const id = useId();
  const device = useGPUDevice();
  const currentBuffersRef = useRef<Map<string, H<GPUBuffer>>>();
  const currentTexturesRef = useRef<Map<string, H<GPUTexture>>>();
  const currentFramesRef = useRef<Set<string>>();

  const rendererContext = useContext(GPURendererContext);
  const actionContext = useContext(GPUActionContext);

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const depsRef = useRef<Map<string, unknown[]>>();

  if (!depsRef.current) {
    depsRef.current = new Map();
  }

  useEffect(
    () => () => {
      for (const key of Object.keys(depsRef.current)) {
        const frame = rendererContext.get(key);

        if (frame) {
          rendererContext.delete(key);
          frame.valid = false;
        }
      }

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
    [device, id, rendererContext]
  );

  const [result, setResult] = useState<R>();

  useEffectBag(
    { ...bag, device },
    (bag) => {
      const { device } = bag;

      if (!currentBuffersRef.current) currentBuffersRef.current = new Map();
      if (!currentTexturesRef.current) currentTexturesRef.current = new Map();

      const currentBuffers = currentBuffersRef.current;
      const currentTextures = currentTexturesRef.current;

      if (!currentFramesRef.current) currentFramesRef.current = new Set();

      const currentFrames = currentFramesRef.current;

      if (!device) return;

      const unusedBuffers = new Set([...currentBuffers.keys()]);
      const unusedTextures = new Set([...currentTextures.keys()]);

      const GPUProxy = {
        createBuffer: (desc: GPUBufferDescriptor) => {
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
        },
        createTexture: (desc: GPUTextureDescriptor) => {
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
        },
        createShaderModule: (desc: GPUShaderModuleDescriptor) => {
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
        },
        createRenderPipeline: (desc: GPURenderPipelineDescriptor) => {
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
        },
        createComputePipeline: (desc: GPUComputePipelineDescriptor) => {
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
        },
        createRenderPipelineAsync: async (
          desc: GPURenderPipelineDescriptor
        ) => {
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

          const resource = hashed(await device.createRenderPipelineAsync(desc));
          log(
            `Created render pipeline ${desc.label ?? "<unnamed>"} ${shortId(
              resource.instanceId
            )} (key: ${key}) for device ${shortId(device.instanceId)}`
          );

          cache.set(key, resource);

          return resource;
        },
        createComputePipelineAsync: async (
          desc: GPUComputePipelineDescriptor
        ) => {
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

          const resource = hashed(
            await device.createComputePipelineAsync(desc)
          );
          cache.set(key, resource);

          log(
            `Created compute pipeline ${desc.label ?? "<unnamed>"} ${shortId(
              resource.instanceId
            )} for device ${shortId(device.instanceId)}`
          );
          return resource;
        },
        createSampler: (desc: GPUSamplerDescriptor) => {
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
        },
      };

      function action<T>(
        callback: (bag: ActionBag) => Promise<T>
      ): () => Promise<T> {
        // Shhhhhh
        // eslint-disable-next-line
        // @ts-ignore
        return () => {
          const promise = {
            resolve: (_: unknown): void => undefined,
            reject: (_: unknown): void => undefined,
          };

          const token = new Promise((res, rej) => {
            promise.resolve = res;
            promise.reject = rej;
          });

          actionContext.add(async (bag) =>
            callback(bag).then(promise.resolve).catch(promise.reject)
          );

          return token;
        };
      }

      const frame: Record<
        string,
        (callback: (bag: FrameBag) => void, deps?: unknown[]) => FrameCallback
      > = new Proxy(
        {},
        {
          get(_, p) {
            return (callback: (bag: FrameBag) => void, deps?: unknown[]) => {
              if (typeof p === "symbol") {
                throw new Error("Nah");
              }

              const ownKey = `${p}@${id}`;
              unusedFrames.delete(ownKey);

              const hasDeps = Array.isArray(deps);

              if (hasDeps) {
                const isFirstRender = !depsRef.current.has(ownKey);
                const lastDeps = depsRef.current.get(ownKey);

                const areSame = isSameDependencies(deps, lastDeps);
                const enabled = !areSame || isFirstRender;

                const frame = {
                  valid: true,
                  callback,
                  enabled,
                  kind: "once",
                } as const;
                rendererContext.set(ownKey, frame);
                return frame;
              } else {
                const frame = {
                  valid: true,
                  callback,
                  enabled: true,
                  kind: "loop",
                } as const;
                rendererContext.set(ownKey, frame);
                return frame;
              }
            };
          },
        }
      );

      const unusedFrames = new Set([...currentFrames.keys()]);

      const out = callbackRef.current({
        ...bag,
        device,
        gpu: GPUProxy,
        frame,
        action,
      });

      const finish = (out: R) => {
        unusedFrames.forEach((key) => {
          rendererContext.delete(key);
        });

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

        setResult(() => out ?? undefined);
      };

      if (out instanceof Promise) {
        out.then(finish).catch(console.error);
      } else {
        finish(out);
      }
    },
    () => {
      setResult(undefined);
    },
    [...deps, device, id, rendererContext]
  );

  if (typeof result === "object" || typeof result === "undefined") {
    // eslint-disable-next-line
    // @ts-ignore
    return result ?? {};
  }
  // eslint-disable-next-line
  // @ts-ignore
  return result ?? undefined;
}

export const useRefTrap = <T>(ref?: T): MutableRefObject<T | undefined> => {
  const rendererRefs = useRef<Set<FrameCallback>>();

  if (!rendererRefs.current) {
    rendererRefs.current = new Set();
  }

  return useMemo(() => {
    const fake = { current: ref };
    const value = { current: ref };
    Object.defineProperty(value, "current", {
      set(value) {
        const renderers = rendererRefs.current;

        for (const frame of renderers) {
          if (!frame.valid) {
            renderers.delete(frame);
          } else {
            frame.enabled = true;
          }
        }

        // eslint-disable-next-line
        fake.current = value;
        return fake.current;
      },
      get() {
        const renderers = rendererRefs.current;

        if (FRAME_CALLBACK.current && FRAME_CALLBACK.current.kind === "once") {
          renderers.add(FRAME_CALLBACK.current);
        }

        // eslint-disable-next-line
        return fake.current;
      },
    });
    return value;
  }, []);
};
