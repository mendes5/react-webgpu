import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { useGPUDevice } from "./gpu-device";
import stringHash from "string-hash";
import { usePresentationFormat } from "./canvas";
import { useAsyncResource, useMemoBag, type V } from "~/utils/hooks";
import { type H, hashed, shortId, NOOP } from "~/utils/other";
import { log } from "./logger";
import { numMipLevels } from "~/utils/mips";
import { useWithMips } from "./gpu-mipmap";
import { loadImageBitmap } from "~/utils/mips";

const SAMPLER_CACHE: Map<GPUDevice, Map<string, H<GPUSampler>>> = new Map();

const SHADER_CACHE: Map<GPUDevice, Map<number, H<GPUShaderModule>>> = new Map();

const TEXTURES_REFS: Map<string, H<GPUTexture>> = new Map();

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
      TEXTURES_REFS,
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
  buffers?: V<GPUVertexBufferLayout[]>,
  targetFormat?: GPUTextureFormat,
  ready = true
) => {
  const presentationFormat = usePresentationFormat();

  const format = targetFormat ?? presentationFormat;

  const key = `${String(ready) ?? ""}/${shader?.instanceId ?? ""}/${
    buffers?.useVersionCacheBurstId ?? ""
  }/${presentationFormat ?? ""}`;

  return useDeviceCache(
    key,
    (device) => {
      if (!ready) return null;

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
  addressModeU?: GPUAddressMode;
  addressModeV?: GPUAddressMode;
  magFilter?: GPUFilterMode;
  minFilter?: GPUFilterMode;
}) => {
  const key = `${addressModeU ?? ""}/${addressModeV ?? ""}/${magFilter ?? ""}/${
    minFilter ?? ""
  }`;
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

const getSourceSize = (source: GPUImageCopyExternalImage["source"]) => {
  if (source instanceof HTMLVideoElement) {
    return [source.videoWidth - 1, source.videoHeight - 1] as const;
  }
  return [source.width, source.height];
};

export const useExternalTexture = (
  source?: GPUImageCopyExternalImage["source"] | null,
  {
    mips,
    format,
    flipY,
  }: { mips?: boolean; format?: GPUTextureFormat; flipY?: boolean } = {}
) => {
  const device = useGPUDevice();
  const lastInstance = useRef<H<GPUTexture> | null>(null);

  const id = useId();

  const texture = useMemoBag(
    { device, source },
    ({ device, source }) => {
      if (lastInstance.current) {
        log(
          `Destroyed texture ${shortId(
            lastInstance.current.instanceId
          )} for instance ${id}`
        );
        lastInstance.current.destroy();
      }

      const size = getSourceSize(source);

      const texture = hashed(
        device.createTexture({
          format: format ?? "rgba8unorm",
          mipLevelCount: mips ? numMipLevels(...size) : 1,
          size,
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        })
      );

      log(`Created texture ${shortId(texture.instanceId)} for instance ${id}`);

      lastInstance.current = texture;

      return texture;
    },
    [mips, format]
  );

  const updateCallback = useRef(NOOP);

  const updateFromSource = useCallback(() => updateCallback.current(), []);

  const renderMips = useWithMips(texture);

  useMemoBag(
    { device, source, texture },
    ({ device, source, texture }) => {
      updateCallback.current = () => {
        const size = getSourceSize(source);
        device.queue.copyExternalImageToTexture(
          { source, flipY },
          { texture },
          { width: size[0], height: size[1] }
        );

        if (texture.mipLevelCount > 1) {
          renderMips();
        }
      };
      updateCallback.current();
    },
    [renderMips, flipY]
  );

  return [texture, updateFromSource] as const;
};

export const useAsyncExternalTexture = (
  url: string,
  {
    mips,
    format,
    flipY,
    colorSpaceConversion,
  }: {
    mips?: boolean;
    format?: GPUTextureFormat;
    flipY?: boolean;
    colorSpaceConversion?: ImageBitmapOptions["colorSpaceConversion"];
  } = {}
) => {
  const state = useAsyncResource(
    () => loadImageBitmap(url, { colorSpaceConversion }),
    [url]
  );

  const [texture] = useExternalTexture(
    state.type === "success" ? state.value : null,
    {
      mips,
      format,
      flipY,
    }
  );

  return texture;
};

export const useDataTexture = (
  initialData: BufferSource | SharedArrayBuffer,
  width: number,
  height: number,
  format?: GPUTextureFormat
) => {
  const device = useGPUDevice();

  const textureRef = useRef<null | H<GPUTexture>>(null);

  const id = useId();

  const updateTexture =
    useRef<(data: BufferSource | SharedArrayBuffer) => void>(NOOP);

  const texture = useMemoBag(
    { device },
    ({ device }) => {
      if (textureRef.current) {
        log(
          `Destroyed texture ${shortId(
            textureRef.current.instanceId
          )} for instance ${id}`
        );
        textureRef.current.destroy();
      }
      const texture = hashed(
        device.createTexture({
          size: [width, height],
          format: format ?? "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })
      );
      textureRef.current = texture;
      log(
        `Created data texture ${shortId(texture.instanceId)} for instance ${id}`
      );

      updateTexture.current = (data: BufferSource | SharedArrayBuffer) => {
        if (texture && device) {
          device.queue.writeTexture(
            { texture },
            data,
            { bytesPerRow: width * 4 },
            { width: width, height: height }
          );
        }
      };

      updateTexture.current(initialData);

      return texture;
    },
    [width, height, format]
  );

  return [
    texture,
    useCallback(
      (data: BufferSource | SharedArrayBuffer) => updateTexture.current(data),
      []
    ),
  ] as const;
};

type NoUndefinedField<T> = {
  [P in keyof T]-?: NonNullable<T[P]>;
};

/**
 * NOTE: will never transfer data to new buffers upon
 * new buffer initialization, if the buffers managed
 * by this hook are re-built.
 *
 * The lib also don't track any GPU related state
 * so even on cases of GPU device lost where the
 * buffer signature didn't change you won't get
 * your data back.
 *
 * Also note: the double render you get on dev mode
 * is not a bug, its React strict mode.
 */
export const useBuffers = <
  T extends Record<string, unknown | null | undefined>,
  R extends Record<string, unknown>
>(
  bag: T,
  callback: (
    createBuffer: (desc: GPUBufferDescriptor) => H<GPUBuffer>,
    bag: NoUndefinedField<T>
  ) => R,
  deps: unknown[]
): Partial<R> => {
  const device = useGPUDevice();

  const currentBuffersRef = useRef<Set<H<GPUBuffer>>>();

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const id = useId();

  useEffect(
    () => () => {
      if (currentBuffersRef.current?.size) {
        for (const buffer of currentBuffersRef.current.values()) {
          log(
            `Destroying buffer ${shortId(buffer.instanceId)} of instance ${id}`
          );
          buffer.destroy();
        }
        currentBuffersRef.current.clear();
      }
    },
    []
  );

  return (
    useMemoBag(
      bag,
      (bag) => {
        if (!currentBuffersRef.current) {
          currentBuffersRef.current = new Set();
        }

        if (currentBuffersRef.current.size) {
          for (const buffer of currentBuffersRef.current.values()) {
            log(
              `Destroying buffer ${shortId(
                buffer.instanceId
              )} of instance ${id}`
            );
            buffer.destroy();
          }
          currentBuffersRef.current.clear();
        }

        if (!device) return {};

        const ref = {
          current: (desc: GPUBufferDescriptor): H<GPUBuffer> => {
            // TODO: compute structure hash and use it to decide if
            // we delete previous buffers or not
            //
            // deleting all buffers on a re-render is silly
            // but works for now
            //
            // maybe we can even key/reconcile those calls
            // instead of doing hashes.
            const buffer = hashed(device.createBuffer(desc));
            log(
              `Created buffer ${shortId(buffer.instanceId)} for instance ${id}`
            );
            currentBuffersRef.current?.add(buffer);
            return buffer;
          },
        };

        const createBufferCb = (desc: GPUBufferDescriptor) => ref.current(desc);

        const out = callbackRef.current(createBufferCb, bag);

        ref.current = () => {
          throw new Error(
            "Cannot call createBuffer outside the rendering of useBuffers"
          );
        };

        return out;
      },
      deps
    ) ?? {}
  );
};

/**
 * Idea: A `useGPU` hook:
 *
 * const { pipeline, buffer, shader } = useGPU(({ createBuffer, createTexture }) => {
 *   // block
 * })
 *
 * Kinda like this useBuffer but for everything, auto manages/reconcile the used resources
 * based on structural hashes of the descriptors/call orders of the created resources.
 *
 * Kinda like a render, but imperative
 * all code ran inside // block should pass
 * trough our own reconciler, like we did
 * with DRER-rs last year.
 *
 * Also solves the problem of re-rendering recreating resources
 * without needing, and you can return more stuff from the bag
 * AND you also solve the optional device issue.
 *
 * Looks like a cool API and is a nice way to hide the GPU device, that I want to become
 * private anyways...
 */
