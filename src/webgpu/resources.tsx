import { useCallback, useId, useMemo, useRef } from "react";
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

      const texture = hashed(
        device.createTexture({
          format: format ?? "rgba8unorm",
          mipLevelCount: mips ? numMipLevels(source.width, source.height) : 1,
          size: [source.width, source.height],
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
        device.queue.copyExternalImageToTexture(
          { source, flipY },
          { texture },
          { width: source.width, height: source.height }
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
