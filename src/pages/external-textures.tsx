import { type NextPage } from "next";
import Head from "next/head";

import { type FC, useState } from "react";
import {
  usePresentationFormat,
  useWebGPUCanvas,
  useWebGPUContext,
} from "~/webgpu/canvas";
import { WebGPUApp } from "~/utils/webgpu-app";
import { ToOverlay } from "~/utils/overlay";
import { useAsyncResource } from "~/utils/hooks";
import { useGPU } from "~/webgpu/use-gpu";
import { getSourceSize, loadImageBitmap } from "~/utils/mips";
import { type H } from "~/utils/other";

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
  const presentationFormat = usePresentationFormat();

  const [modeU, setModeU] = useState<string>(AddressMode.repeat);
  const [modeV, setModeV] = useState<string>(AddressMode.repeat);
  const [magFilter, setMagFilter] = useState<string>(FilterMode.nearest);
  const [minFilter, setMingFilter] = useState<string>(FilterMode.nearest);

  const state = useAsyncResource(
    () => loadImageBitmap("/resources/f-texture.png"),
    []
  );

  const canvas = useWebGPUCanvas();
  const context = useWebGPUContext();

  useGPU(
    async ({ device, frame, gpu }) => {
      const shader = gpu.createShaderModule({
        label: "External texture shader module",
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
          }
        `,
      });

      const pipeline = await gpu.createRenderPipelineAsync({
        label: "External texture render pipeline",
        layout: "auto",
        vertex: {
          module: shader,
          entryPoint: "vsMain",
        },
        fragment: {
          module: shader,
          entryPoint: "fsMain",
          targets: [{ format: presentationFormat }],
        },
      });

      let texture: H<GPUTexture> | null = null;
      if (state.type === "success") {
        const size = getSourceSize(state.value);

        texture = gpu.createTexture({
          label: "External texture",
          format: "rgba8unorm",
          size: getSourceSize(state.value),
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });

        device.queue.copyExternalImageToTexture(
          { source: state.value, flipY: true },
          { texture },
          { width: size[0], height: size[1] }
        );
      }

      const uniformBufferSize =
        2 * 4 + // scale is 2 32bit floats (4bytes each)
        2 * 4; // offset is 2 32bit floats (4bytes each)
      const uniformBuffer = gpu.createBuffer({
        label: "uniforms for quad",
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // create a typedarray to hold the values for the uniforms in JavaScript
      const uniformValues = new Float32Array(uniformBufferSize / 4);

      // offsets to the various uniform values in float32 indices
      const kScaleOffset = 0;
      const kOffsetOffset = 2;

      const sampler = gpu.createSampler({
        label: "External texture sampler",
        addressModeU: modeU as GPUAddressMode,
        addressModeV: modeV as GPUAddressMode,
        magFilter: magFilter as GPUFilterMode,
        minFilter: minFilter as GPUFilterMode,
      });

      if (texture) {
        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: texture.createView() },
            { binding: 2, resource: { buffer: uniformBuffer } },
          ],
        });

        frame.main!(({ time, encoder }) => {
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
          if (bindGroup) {
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);

            // compute a scale that will draw our 0 to 1 clip space quad
            // 2x2 pixels in the canvas.
            const scaleX = (4 / canvas.width) * 100;
            const scaleY = (4 / canvas.height) * 100;

            uniformValues.set([scaleX, scaleY], kScaleOffset); // set the scale
            uniformValues.set(
              [Math.sin(time * 0.25) * 0.8, -0.8],
              kOffsetOffset
            ); // set the offset

            // copy the values from JavaScript to the GPU
            device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

            pass.draw(6);
          }
          pass.end();
        });
      }
    },
    [presentationFormat, modeU, modeV, magFilter, minFilter, state]
  );

  return (
    <ToOverlay>
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
  return (
    <>
      <Head>
        <title>WebGPU Tests</title>
        <link rel="icon" href="/favicon.svg" />
      </Head>

      <WebGPUApp fullscreen>
        <Example />
      </WebGPUApp>
    </>
  );
};

export default Home;
