import { r } from "~/trace";
import { type FrameContext } from "~/trace/core";
import { type CallSite } from "~/trace/utils";
import { type H, hashed, shortId } from "~/utils/other";
import hash from "object-hash";
import { log } from "./logger";

const WebGPU = Symbol("WebGPU");

// TODO: create a shorthand for this, we could yield r instead
export const createShaderModule = r(function* (
  descriptor: GPUShaderModuleDescriptor
) {
  return yield { WebGPU, call: { createShaderModule: descriptor } };
});

export const createRenderPipeline = r(function* (
  descriptor: GPURenderPipelineDescriptor
) {
  return yield { WebGPU, call: { createRenderPipeline: descriptor } };
});

export const pushFrame = r(function* (
  frame: (bag: FrameBag) => void,
  deps?: unknown[]
) {
  return yield { WebGPU, call: { pushFrame: frame, deps } };
});

export type FrameBag = {
  time: number;
  encoder: GPUCommandEncoder;
};

type PluginCalls =
  | {
      createShaderModule: GPUShaderModuleDescriptor;
    }
  | {
      createRenderPipeline: GPURenderPipelineDescriptor;
    }
  | {
      pushFrame: (bag: FrameBag) => void;
      deps?: unknown[];
    };

type PluginYield = {
  Use: typeof WebGPU;
  call: PluginCalls;
};

interface WebGPUFrameContext extends FrameContext {
  calls?: Record<string, unknown>;
  frameDeps?: Record<string, unknown[]>;
}

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
  (device: H<GPUDevice>, rendererContext: Map<string, FrameCallback>) => () => {
    return {
      matches: (value: unknown): value is PluginYield =>
        typeof value === "object" &&
        value !== null &&
        "WebGPU" in value &&
        value.WebGPU === WebGPU,
      dispose: (ctx: WebGPUFrameContext) => {
        for (const gen of Object.values(ctx.calls ?? {})) {
          // We dont even known what fiber context we will have
        }
      },
      exec: (
        { call }: PluginYield,
        callSite: CallSite[],
        ctx: WebGPUFrameContext
      ) => {
        const key = callSite.join("@");

        if (!ctx.calls) {
          ctx.calls = {};
        }

        if (!ctx.frameDeps) {
          ctx.frameDeps = {};
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

          return resource;
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
        } else {
          throw new Error("Unknown call using WebGPU symbol");
        }
      },
    };
  };
