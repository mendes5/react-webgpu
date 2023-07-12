import {
  type SyncClosureFiberGenerator,
  createChildSyncClosureFiberRoot,
  r,
} from "~/trace";
import { type PluginInstance, type FrameContext } from "~/trace/core";
import { type CallSite } from "~/trace/utils";
import { type H, hashed, shortId } from "~/utils/other";
import hash from "object-hash";
import { log } from "./logger";
import stringHash from "string-hash";
import objectHash from "object-hash";

const WebGPU = Symbol("WebGPU");

// TODO: create a shorthand for this, we could yield r instead
export const createShaderModule = r(function* (
  descriptor: GPUShaderModuleDescriptor
) {
  return yield { WebGPU, call: { createShaderModule: descriptor } };
});

export type GPUAction<T = unknown> = () => Promise<T>;

export const createRenderPipeline = r(function* (
  descriptor: GPURenderPipelineDescriptor
) {
  return yield { WebGPU, call: { createRenderPipeline: descriptor } };
});

export const createComputePipeline = r(function* (
  descriptor: GPUComputePipelineDescriptor
) {
  return yield { WebGPU, call: { createComputePipeline: descriptor } };
});

export const createBindGroupLayout = r(function* (
  descriptor: GPUBindGroupLayoutDescriptor
) {
  return yield { WebGPU, call: { createBindGroupLayout: descriptor } };
});
export const createPipelineLayout = r(function* (
  descriptor: GPUPipelineLayoutDescriptor
) {
  return yield { WebGPU, call: { createPipelineLayout: descriptor } };
});

// PLugins should be alot easier
// Like, dont return generator objects
// Just build the entire API arround yielding stuff
// This R hack could just be a Object.assign(x, { recordedPosition: getStackFrame(2) })
export const createBuffer = r(function* (descriptor: GPUBufferDescriptor) {
  return yield { WebGPU, call: { createBuffer: descriptor } };
});
export const createTexture = r(function* (descriptor: GPUTextureDescriptor) {
  return yield { WebGPU, call: { createTexture: descriptor } };
});
export const createBindGroup = r(function* (
  descriptor: GPUBindGroupDescriptor
) {
  return yield { WebGPU, call: { createBindGroup: descriptor } };
});
export const createSampler = r(function* (descriptor: GPUSamplerDescriptor) {
  return yield { WebGPU, call: { createSampler: descriptor } };
});
export const action = r(function* (
  action: (bag: ActionBag) => Promise<unknown>
) {
  return yield { WebGPU, call: { action } };
});

export const actionG = r(function* (action: (bag: ActionBag) => Generator) {
  return yield { WebGPU, actionG: { action } };
});

export const queueEffect = r(function* (
  queueEffect: (queue: GPUQueue) => void,
  deps: unknown[]
) {
  return yield { WebGPU, call: { queueEffect, deps } };
});

export const pushFrame = r(function* (
  frame: (bag: FrameBag) => void,
  deps?: unknown[]
) {
  return yield { WebGPU, call: { pushFrame: frame, deps } };
});

export const pushFrameG = r(function* (
  frame: (bag: FrameBag) => Generator,
  deps?: unknown[]
) {
  return yield { WebGPU, call: { pushFrameG: frame, deps } };
});

export type FrameBag = {
  time: number;
  encoder: GPUCommandEncoder;
  queue: GPUQueue;
};

export type ActionBag = {
  queue: GPUQueue;
  invalidate: (callback: FrameCallback) => void;
  time: number;
  encoder: GPUCommandEncoder;
  renderToken: Promise<number>;
};

type PluginCalls =
  | {
      createShaderModule: GPUShaderModuleDescriptor;
    }
  | {
      createRenderPipeline: GPURenderPipelineDescriptor;
    }
  | {
      createComputePipeline: GPUComputePipelineDescriptor;
    }
  | {
      createBindGroupLayout: GPUBindGroupLayoutDescriptor;
    }
  | {
      createPipelineLayout: GPUPipelineLayoutDescriptor;
    }
  | {
      createBuffer: GPUBufferDescriptor;
    }
  | {
      createTexture: GPUTextureDescriptor;
    }
  | {
      createBindGroup: GPUBindGroupDescriptor;
    }
  | {
      createSampler: GPUSamplerDescriptor;
    }
  | {
      pushFrame: (bag: FrameBag) => void;
      deps?: unknown[];
    }
  | {
      pushFrameG: (bag: FrameBag) => Generator<any, undefined, unknown>;
      deps?: unknown[];
    }
  | {
      action: (bag: ActionBag) => Promise<unknown>;
    }
  | {
      actionG: (bag: ActionBag) => Generator<any, undefined, unknown>;
    }
  | {
      queueEffect: (queue: GPUQueue) => void;
      deps: unknown[];
    };

type PluginYield = {
  Use: typeof WebGPU;
  call: PluginCalls;
};

type LocalResource<T> = {
  hash: string;
  value: T;
};

interface WebGPUFrameContext extends FrameContext {
  calls?: Record<string, unknown>;
  frameDeps?: Record<string, unknown[]>;
  queueEffectsDeps?: Record<string, unknown[]>;
  actionGenerators?: Record<string, SyncClosureFiberGenerator>;
  frameGenerators?: Record<string, SyncClosureFiberGenerator>;
  // Local Resources
  buffers?: Map<string, LocalResource<H<GPUBuffer>>>;
  textures?: Record<string, LocalResource<H<GPUTexture>>>;
}

const SAMPLER_CACHE: Map<GPUDevice, Map<string, H<GPUSampler>>> = new Map();

const SHADER_CACHE: Map<GPUDevice, Map<string, H<GPUShaderModule>>> = new Map();

const BIND_GROUP_CACHE: Map<
  GPUDevice,
  Map<string, H<GPUBindGroup>>
> = new Map();

const BIND_GROUP_LAYOUT_CACHE: Map<
  GPUDevice,
  Map<string, H<GPUBindGroupLayout>>
> = new Map();
const PIPELINE_LAYOUT_CACHE: Map<
  GPUDevice,
  Map<string, H<GPUPipelineLayout>>
> = new Map();

const RENDER_PIPELINE_CACHE: Map<
  GPUDevice,
  Map<string, H<GPURenderPipeline>>
> = new Map();

const COMPUTE_PIPELINE_CACHE: Map<
  GPUDevice,
  Map<string, H<GPUComputePipeline>>
> = new Map();

export type FrameCallback = {
  valid: boolean;
  callback: (bag: FrameBag) => void;
  enabled: boolean;
  kind: "once" | "loop";
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

export const webGPUPluginCreator =
  (
    device: H<GPUDevice>,
    rendererContext: Map<string, FrameCallback>,
    actionContext: Set<(bag: ActionBag) => unknown>
  ) =>
  () => {
    return {
      matches: (value: unknown): value is PluginYield =>
        typeof value === "object" &&
        value !== null &&
        "WebGPU" in value &&
        value.WebGPU === WebGPU,
      dispose: (ctx: WebGPUFrameContext) => {
        if (ctx.textures)
          for (const texture of Object.values(ctx.textures)) {
            texture.value.destroy();
            log(`Destroyed texture ${shortId(texture.hash)}`);
          }
        if (ctx.buffers)
          for (const buffer of ctx.buffers.values()) {
            // TODO: do we need to check if it is mapped?
            buffer.value.destroy();
            log(`Destroyed buffer ${shortId(buffer.hash)}`);
          }
        if (ctx.actionGenerators)
          for (const fiber of Object.values(ctx.actionGenerators)) {
            fiber.dispose();
          }
        if (ctx.frameGenerators)
          for (const fiber of Object.values(ctx.frameGenerators)) {
            fiber.dispose();
          }
        if (ctx.frameDeps)
          for (const key of Object.keys(ctx.frameDeps)) {
            rendererContext.delete(key);
          }
      },
      exec: (
        { call }: PluginYield,
        callSite: CallSite[],
        ctx: WebGPUFrameContext,
        allPlugins: PluginInstance[]
      ) => {
        const key = callSite.join("@");
        const fiberHash = stringHash(key);

        if (!ctx.calls) {
          ctx.calls = {};
        }

        if (!ctx.frameDeps) {
          ctx.frameDeps = {};
        }

        if (!ctx.buffers) {
          ctx.buffers = new Map();
        }

        if (!ctx.textures) {
          ctx.textures = {};
        }

        if (!ctx.actionGenerators) {
          ctx.actionGenerators = {};
        }

        if (!ctx.queueEffectsDeps) {
          ctx.queueEffectsDeps = {};
        }

        if (!ctx.frameGenerators) {
          ctx.frameGenerators = {};
        }

        if ("createShaderModule" in call) {
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
                  `Cleared ${size} items from shader cache of device ${device.instanceId} due to it being lost`
                );
              })
              .catch(console.error);
          }

          const resourceKey = globalResourceHash(call.createShaderModule);
          const fromCache = cache.get(resourceKey);

          if (fromCache) return fromCache;

          const resource = hashed(
            device.createShaderModule(call.createShaderModule)
          );
          cache.set(resourceKey, resource);

          log(
            `Created shader ${
              call.createShaderModule.label ?? "<unnamed>"
            } ${shortId(resource.instanceId)} for device ${shortId(
              device.instanceId
            )}`
          );

          return resource;
        } else if ("createSampler" in call) {
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
                  `Cleared ${size} items from sampler cache of device ${device.instanceId} due to it being lost`
                );
              })
              .catch(console.error);
          }

          const resourceKey = globalResourceHash(call.createSampler);
          const fromCache = cache.get(resourceKey);

          if (fromCache) return fromCache;

          const resource = hashed(device.createSampler(call.createSampler));
          cache.set(resourceKey, resource);

          log(
            `Created sampler ${
              call.createSampler.label ?? "<unnamed>"
            } ${shortId(resource.instanceId)} for device ${shortId(
              device.instanceId
            )}`
          );

          return resource;
        } else if ("createRenderPipeline" in call) {
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

          const resourceKey = globalResourceHash(call.createRenderPipeline);
          const fromCache = cache.get(resourceKey);

          if (fromCache) return fromCache;

          const resource = hashed(
            device.createRenderPipeline(call.createRenderPipeline)
          );
          log(
            `Created render pipeline ${
              call.createRenderPipeline.label ?? "<unnamed>"
            } ${shortId(resource.instanceId)} for device ${shortId(
              device.instanceId
            )}`
          );

          cache.set(resourceKey, resource);

          Object.assign(resource, {
            getBindGroupLayout(...args: unknown[]) {
              const bindGroupLayout: GPUTexture =
                GPURenderPipeline.prototype.getBindGroupLayout.call(
                  this,
                  ...args
                );
              return Object.assign(bindGroupLayout, {
                instanceId: `${String(args[0])}-${resource.instanceId}`,
              });
            },
          });

          return resource;
        } else if ("createComputePipeline" in call) {
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

          const resourceKey = globalResourceHash(call.createComputePipeline);
          const fromCache = cache.get(resourceKey);

          if (fromCache) return fromCache;

          const resource = hashed(
            device.createComputePipeline(call.createComputePipeline)
          );
          log(
            `Created render pipeline ${
              call.createComputePipeline.label ?? "<unnamed>"
            } ${shortId(resource.instanceId)} for device ${shortId(
              device.instanceId
            )}`
          );

          cache.set(resourceKey, resource);

          return resource;
        } else if ("createBindGroupLayout" in call) {
          let cache = BIND_GROUP_LAYOUT_CACHE.get(device);
          if (!cache) {
            const newCache = new Map();
            cache = newCache;
            BIND_GROUP_LAYOUT_CACHE.set(device, cache);
            device.lost
              .then(() => {
                BIND_GROUP_LAYOUT_CACHE.delete(device);
                const size = newCache.size;
                newCache.clear();
                log(
                  `Cleared ${size} items from bind group layout cache of device ${device.instanceId}`
                );
              })
              .catch(console.error);
          }

          const resourceKey = globalResourceHash(call.createBindGroupLayout);
          const fromCache = cache.get(resourceKey);

          if (fromCache) return fromCache;

          const resource = hashed(
            device.createBindGroupLayout(call.createBindGroupLayout)
          );
          log(
            `Created bind group layout ${
              call.createBindGroupLayout.label ?? "<unnamed>"
            } ${shortId(resource.instanceId)} for device ${shortId(
              device.instanceId
            )}`
          );

          cache.set(resourceKey, resource);

          return resource;
        } else if ("createPipelineLayout" in call) {
          let cache = PIPELINE_LAYOUT_CACHE.get(device);
          if (!cache) {
            const newCache = new Map();
            cache = newCache;
            PIPELINE_LAYOUT_CACHE.set(device, cache);
            device.lost
              .then(() => {
                PIPELINE_LAYOUT_CACHE.delete(device);
                const size = newCache.size;
                newCache.clear();
                log(
                  `Cleared ${size} items from pipeline layout cache of device ${device.instanceId}`
                );
              })
              .catch(console.error);
          }

          const resourceKey = globalResourceHash(call.createPipelineLayout);
          const fromCache = cache.get(resourceKey);

          if (fromCache) return fromCache;

          const resource = hashed(
            device.createPipelineLayout(call.createPipelineLayout)
          );
          log(
            `Created pipeline layout ${
              call.createPipelineLayout.label ?? "<unnamed>"
            } ${shortId(resource.instanceId)} for device ${shortId(
              device.instanceId
            )}`
          );

          cache.set(resourceKey, resource);

          return resource;
        } else if ("createBindGroup" in call) {
          let cache = BIND_GROUP_CACHE.get(device);
          if (!cache) {
            const newCache = new Map();
            cache = newCache;
            BIND_GROUP_CACHE.set(device, cache);
            device.lost
              .then(() => {
                BIND_GROUP_CACHE.delete(device);
                const size = newCache.size;
                newCache.clear();
                log(
                  `Cleared ${size} items from bind group cache of device ${device.instanceId}`
                );
              })
              .catch(console.error);
          }

          const resourceHash = globalResourceHash(call.createBindGroup);
          const fromCache = cache.get(resourceHash);
          if (fromCache) return cache.get(resourceHash);

          const resource = hashed(device.createBindGroup(call.createBindGroup));
          cache.set(resourceHash, resource);

          log(
            `Created bindGroup ${
              call.createBindGroup.label ?? "<unnamed>"
            } (${shortId(resource.instanceId)})`
          );

          return resource;
        } else if ("createBuffer" in call) {
          const resourceHash = localResourceHash(call.createBuffer, device);
          const existing = ctx.buffers.get(key);

          if (existing) {
            if (existing.hash === resourceHash) {
              return existing.value;
            } else {
              existing.value.destroy();

              log(
                `Destroying buffer ${shortId(
                  existing.value.instanceId
                )} for fiber ${fiberHash} since its hash changed`
              );
            }
          }

          const resource = hashed(device.createBuffer(call.createBuffer));
          ctx.buffers.set(key, { hash: resourceHash, value: resource });

          log(
            `Created buffer ${
              call.createBuffer.label ?? "<unnamed>"
            } (${shortId(resource.instanceId)}) for fiber ${fiberHash}`
          );

          return resource;
        } else if ("createTexture" in call) {
          const resourceKey = localResourceHash(call.createTexture, device);
          const existing = ctx.textures[key];

          if (existing) {
            if (existing.hash === resourceKey) {
              return existing.value;
            } else {
              existing.value.destroy();

              log(
                `Destroying texture ${shortId(
                  existing.value.instanceId
                )} for fiber ${fiberHash} since its hash changed`
              );
            }
          }

          const resource = hashed(device.createTexture(call.createTexture));
          ctx.textures[key] = { value: resource, hash: resourceKey };

          log(
            `Created texture ${
              call.createTexture.label ?? "<unnamed>"
            } ${shortId(resource.instanceId)} for fiber ${fiberHash}`
          );

          Object.assign(resource, {
            createView(descriptor: GPUTextureViewDescriptor = {}) {
              const textureView: GPUTexture =
                GPUTexture.prototype.createView.call(this, descriptor);
              return Object.assign(textureView, {
                instanceId: objectHash(descriptor) + resource.instanceId,
              });
            },
          });

          return resource;
        } else if ("queueEffect" in call) {
          const cached = ctx.queueEffectsDeps[key];

          if (!isSameDependencies(cached, call.deps)) {
            ctx.queueEffectsDeps[key] = call.deps;
            log(
              `Ran queue effect for fiber ${fiberHash} since its dependencies changed`
            );
            call.queueEffect(device.queue);
          }
        } else if ("action" in call) {
          // TODO: allow for params
          // it just will be very ugly
          // from the TS side
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
              call.action(bag).then(promise.resolve).catch(promise.reject)
            );

            return token;
          };
        } else if ("actionG" in call) {
          let fiber: SyncClosureFiberGenerator;

          if (ctx.actionGenerators[key]) {
            fiber = ctx.actionGenerators[key];
          } else {
            fiber = createChildSyncClosureFiberRoot(allPlugins);
            ctx.actionGenerators[key] = fiber;
          }

          return () => {
            const promise = {
              resolve: (_: unknown): void => undefined,
              reject: (_: unknown): void => undefined,
            };

            const token = new Promise((res, rej) => {
              promise.resolve = res;
              promise.reject = rej;
            });

            actionContext.add(async (bag) => {
              fiber(call.actionG(bag));
              promise.resolve(undefined);
            });

            return token;
          };
        } else if ("pushFrame" in call) {
          const { deps, pushFrame } = call;
          const hasDeps = Array.isArray(deps);

          if (hasDeps) {
            const isFirstRender = !ctx.frameDeps[key];
            const lastDeps = ctx.frameDeps[key];

            const areSame = isSameDependencies(deps, lastDeps);
            const enabled = !areSame || isFirstRender;

            const frame = {
              valid: true,
              callback: pushFrame,
              enabled,
              kind: "once",
            } as const;
            ctx.frameDeps[key] = deps;
            rendererContext.set(key, frame);
            return frame;
          } else {
            const frame = {
              valid: true,
              callback: pushFrame,
              enabled: true,
              kind: "loop",
            } as const;
            rendererContext.set(key, frame);
            return frame;
          }
        } else if ("pushFrameG" in call) {
          const { deps, pushFrameG } = call;
          const hasDeps = Array.isArray(deps);

          let fiber: SyncClosureFiberGenerator;
          if (ctx.frameGenerators[key]) {
            fiber = ctx.frameGenerators[key];
          } else {
            ctx.frameGenerators[key] =
              createChildSyncClosureFiberRoot(allPlugins);
            fiber = ctx.frameGenerators[key];
          }

          if (hasDeps) {
            const isFirstRender = !ctx.frameDeps[key];
            const lastDeps = ctx.frameDeps[key];

            const areSame = isSameDependencies(deps, lastDeps);
            const enabled = !areSame || isFirstRender;

            const frame: FrameCallback = {
              valid: true,
              callback: (bag) => {
                fiber(pushFrameG(bag));
              },
              enabled,
              kind: "once",
            } as const;
            ctx.frameDeps[key] = deps;
            rendererContext.set(key, frame);
            return frame;
          } else {
            const frame: FrameCallback = {
              valid: true,
              callback: (bag) => {
                fiber(pushFrameG(bag));
              },
              enabled: true,
              kind: "loop",
            } as const;
            rendererContext.set(key, frame);
            return frame;
          }
        } else {
          throw new Error("Unknown call using WebGPU symbol");
        }
      },
    };
  };
