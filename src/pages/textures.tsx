import { type NextPage } from "next";
import Head from "next/head";

import { type FC, useState, useRef, useMemo } from "react";
import {
  usePresentationFormat,
  useWebGPUCanvas,
  useWebGPUContext,
} from "~/webgpu/canvas";
import { WebGPUApp } from "~/utils/webgpu-app";
import { ToOverlay } from "~/utils/overlay";
import { useRefTrap } from "~/webgpu/use-gpu";
import { useGPU } from "~/webgpu/use-gpu";
import {
  createBindGroup,
  createBindGroupLayout,
  createBuffer,
  createRenderPipeline,
  createSampler,
  createShaderModule,
  createTexture,
  pushFrame,
  pushFrameG,
  queueEffect,
} from "~/webgpu/web-gpu-plugin";

const AddressMode = {
  clampToEdge: "clamp-to-edge",
  repeat: "repeat",
  mirrorRepeat: "mirror-repeat",
} as const;

const FilterMode = {
  nearest: "nearest",
  linear: "linear",
} as const;

const Example: FC = () => {
  const [modeU, setModeU] = useState<string>(AddressMode.repeat);
  const [modeV, setModeV] = useState<string>(AddressMode.repeat);
  const [magFilter, setMagFilter] = useState<string>(FilterMode.nearest);
  const [minFilter, setMingFilter] = useState<string>(FilterMode.nearest);
  const scaleRef = useRefTrap(1);

  const { textureData, kTextureWidth, kTextureHeight } = useMemo(() => {
    const kTextureWidth = 5;
    const kTextureHeight = 7;
    const _ = [255, 0, 0, 255]; // red
    const y = [255, 255, 0, 255]; // yellow
    const b = [0, 0, 255, 255]; // blue

    // prettier-ignore
    const textureData = new Uint8Array([   
      _, _, _, _, _,
      _, y, _, _, _,
      _, y, _, _, _,
      _, y, y, _, _,
      _, y, _, _, _,
      _, y, y, y, _,
      b, _, _, _, _,
    ].flat());

    return { textureData, kTextureWidth, kTextureHeight };
  }, []);

  const canvas = useWebGPUCanvas();

  const presentationFormat = usePresentationFormat();
  const context = useWebGPUContext();

  useGPU(
    function* () {
      const shader: GPUShaderModule = yield createShaderModule({
        label: "Texture Shader",
        code: /* wgsl */ `
      struct OurVertexShaderOutput {
        @builtin(position) position: vec4f,
        @location(0) texcoord: vec2f,
      };

      struct Uniforms {
        scale: vec2f,
        offset: vec2f,
      };
       
      @group(0) @binding(2) var<uniform> uni: Uniforms;
      
      @vertex fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> OurVertexShaderOutput {
        var pos = array<vec2f, 6>(
          // 1st triangle
          vec2f( 0.0,  0.0),  // center
          vec2f( 1.0,  0.0),  // right, center
          vec2f( 0.0,  1.0),  // center, top
        
          // 2st triangle
          vec2f( 0.0,  1.0),  // center, top
          vec2f( 1.0,  0.0),  // right, center
          vec2f( 1.0,  1.0),  // right, top
        );

        var vsOutput: OurVertexShaderOutput;
        let xy = pos[vertexIndex];
        vsOutput.position = vec4f(xy * uni.scale + uni.offset, 0.0, 1.0);
        vsOutput.texcoord = xy;
        return vsOutput;
      }

      @group(0) @binding(0) var ourSampler: sampler;
      @group(0) @binding(1) var ourTexture: texture_2d<f32>;

      @fragment fn fsMain(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
        return textureSample(ourTexture, ourSampler, fsInput.texcoord);
      }`,
      });

      const pipeline: GPURenderPipeline = yield createRenderPipeline({
        label: "Texture render pipeline",
        layout: "auto",
        vertex: {
          entryPoint: "vsMain",
          module: shader,
        },
        fragment: {
          entryPoint: "fsMain",
          module: shader,
          targets: [{ format: presentationFormat }],
        },
      });

      const texture: GPUTexture = yield createTexture({
        label: "Main texture",
        size: [kTextureWidth, kTextureHeight],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });

      yield queueEffect(
        (q) =>
          q.writeTexture(
            { texture },
            textureData,
            { bytesPerRow: kTextureWidth * 4 },
            { width: kTextureWidth, height: kTextureHeight }
          ),
        [texture]
      );

      const uniformBufferSize =
        2 * 4 + // scale is 2 32bit floats (4bytes each)
        2 * 4; // offset is 2 32bit floats (4bytes each)

      const uniformBuffer: GPUBuffer = yield createBuffer({
        label: "uniforms for quad",
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // create a typedarray to hold the values for the uniforms in JavaScript
      const uniformValues = new Float32Array(uniformBufferSize / 4);

      // offsets to the various uniform values in float32 indices
      const kScaleOffset = 0;
      const kOffsetOffset = 2;

      const sampler: GPUSampler = yield createSampler({
        label: "Main sampler",
        addressModeU: modeU as GPUAddressMode,
        addressModeV: modeV as GPUAddressMode,
        magFilter: magFilter as GPUFilterMode,
        minFilter: minFilter as GPUFilterMode,
      });

      const bindGroup: GPUBindGroup = yield createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: texture.createView() },
          { binding: 2, resource: { buffer: uniformBuffer } },
        ],
      });

      yield pushFrameG(function* ({ time, encoder, queue }) {
        time *= 0.001;

        const renderPassDescriptor: GPURenderPassDescriptor = {
          label: "our basic canvas renderPass",
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: [0.3, 0.3, 0.3, 1],
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        };

        const pass = encoder.beginRenderPass(renderPassDescriptor);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);

        // compute a scale that will draw our 0 to 1 clip space quad
        // 2x2 pixels in the canvas.
        const scaleX = (4 / canvas.width) * scaleRef.current;
        const scaleY = (4 / canvas.height) * scaleRef.current;

        uniformValues.set([scaleX, scaleY], kScaleOffset); // set the scale
        uniformValues.set([Math.sin(time * 0.25) * 0.8, -0.8], kOffsetOffset); // set the offset

        // copy the values from JavaScript to the GPU
        queue.writeBuffer(uniformBuffer, 0, uniformValues);

        pass.draw(6);
        pass.end();
      });
    },
    [presentationFormat, modeU, modeV, magFilter, minFilter]
  );

  const spanRef = useRef<HTMLSpanElement>(null);

  return (
    <ToOverlay>
      <label className="font-bold text-white">
        Scale:{" "}
        <input
          type="range"
          min={0.5}
          defaultValue={1}
          max={60}
          onInput={(event) => {
            scaleRef.current = parseInt(event.currentTarget.value, 10);
          }}
        />
        <span ref={spanRef}>{scaleRef.current}</span>
      </label>

      <select
        onChange={(event) => setMingFilter(event.currentTarget.value)}
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
      >
        {Object.entries(FilterMode).map(([key, value]) => (
          <option key={value} value={value}>
            Min Filter Mode: {key}
          </option>
        ))}
      </select>

      <select
        onChange={(event) => setMagFilter(event.currentTarget.value)}
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
      >
        {Object.entries(FilterMode).map(([key, value]) => (
          <option key={value} value={value}>
            Mag Filter Mode: {key}
          </option>
        ))}
      </select>

      {magFilter !== "nearest" && (
        <>
          <select
            onChange={(event) => setModeU(event.currentTarget.value)}
            className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
          >
            {Object.entries(AddressMode).map(([key, value]) => (
              <option key={value} value={value}>
                Address Mode U: {key}
              </option>
            ))}
          </select>
          <select
            onChange={(event) => setModeV(event.currentTarget.value)}
            className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
          >
            {Object.entries(AddressMode).map(([key, value]) => (
              <option key={value} value={value}>
                Address Mode V: {key}
              </option>
            ))}
          </select>
        </>
      )}
    </ToOverlay>
  );
};

const Home: NextPage = () => {
  const [downscale, setDownscale] = useState(64);
  const spanRef = useRef<HTMLSpanElement>(null);
  return (
    <>
      <Head>
        <title>WebGPU Tests</title>
        <link rel="icon" href="/favicon.svg" />
      </Head>
      <ToOverlay>
        <label className="font-bold text-white">
          Downscale:{" "}
          <input
            type="range"
            min={0}
            defaultValue={64}
            max={256}
            onInput={(event) => {
              setDownscale(parseInt(event.currentTarget.value, 10));
            }}
          />
          <span ref={spanRef}>{downscale}</span>
        </label>
      </ToOverlay>

      <WebGPUApp fullscreen downscale={downscale}>
        <Example />
      </WebGPUApp>
    </>
  );
};

export default Home;
