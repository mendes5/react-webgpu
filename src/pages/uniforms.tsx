import { type NextPage } from "next";
import Head from "next/head";

import { useState, type FC } from "react";
import {
  usePresentationFormat,
  useWebGPUCanvas,
  useWebGPUContext,
} from "~/webgpu/canvas";
import { WebGPUApp } from "~/utils/webgpu-app";
import { ToOverlay } from "~/utils/overlay";
import { rand, range } from "~/utils/other";
import { useGPU } from "~/webgpu/use-gpu";
import {
  type GPUAction,
  action,
  createBindGroup,
  createBuffer,
  createRenderPipeline,
  createShaderModule,
  pushFrame,
  queueEffect,
  type FrameCallback,
  createBindGroupLayout,
  createPipelineLayout,
} from "~/webgpu/web-gpu-plugin";
import { key } from "~/trace";

const Example: FC = () => {
  const canvas = useWebGPUCanvas();

  const presentationFormat = usePresentationFormat();
  const context = useWebGPUContext();

  const kColorOffset = 0;
  const kOffsetOffset = 4;
  const kScaleOffset = 0;

  const [force, setForce] = useState(0);

  const { randomize } =
    useGPU(
      function* () {
        console.time("ReRun");
        const shader: GPUShaderModule = yield createShaderModule({
          label: "Uniforms example",
          code: /* wgsl */ `
        struct OurStruct {
          color: vec4f,
          offset: vec2f,
        };

        struct OtherStruct {
          scale: vec2f,
        };

        @group(0) @binding(0) var<uniform> ourStruct: OurStruct;
        @group(0) @binding(1) var<uniform> otherStruct: OtherStruct;

        @vertex fn vsMain(@builtin(vertex_index) vertexIndex : u32) ->  @builtin(position) vec4f  {
          var pos = array<vec2f, 3>(
            vec2f( 0.0,  0.5),
            vec2f(-0.5, -0.5),
            vec2f( 0.5, -0.5) 
          );

          return vec4f(
            pos[vertexIndex] * otherStruct.scale + ourStruct.offset, 0.0, 1.0);
        }
      
        @fragment fn fsMain() -> @location(0) vec4f {
          return ourStruct.color;
        }
      `,
        });

        const bingGroupLayout: GPUBindGroupLayout = yield createBindGroupLayout(
          {
            entries: [
              {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: "uniform" },
              },
              {
                binding: 1,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: "uniform" },
              },
            ],
          }
        );

        const pipelineLayout: GPUPipelineLayout = yield createPipelineLayout({
          bindGroupLayouts: [bingGroupLayout],
        });

        const pipeline: GPURenderPipeline = yield createRenderPipeline({
          label: "Uniforms example render pipeline",
          layout: pipelineLayout,
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

        // Probably will need some code
        // to abstract away this offset calculation
        const staticUniformBufferSize =
          4 * 4 + // color is 4 32bit floats (4bytes each)
          2 * 4 + // offset is 2 32bit floats (4bytes each)
          2 * 4; // padding

        const uniformBufferSize = 2 * 4; // scale is 2 32bit floats (4bytes each)

        const kNumObjects = 100;
        const objectInfos = [] as {
          scale: number;
          uniformBuffer: GPUBuffer;
          staticUniformBuffer: GPUBuffer;
          staticValues: Float32Array;
          uniformValues: Float32Array;
          bindGroup: GPUBindGroup;
        }[];

        for (const i of range(kNumObjects)) {
          const unkey: () => void = yield key(i);

          const staticUniformBuffer: GPUBuffer = yield createBuffer({
            label: `static uniforms for obj: ${i}`,
            size: staticUniformBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });

          const staticValues = new Float32Array(staticUniformBufferSize / 4);
          staticValues.set([rand(), rand(), rand(), 1], kColorOffset);
          staticValues.set([rand(-0.9, 0.9), rand(-0.9, 0.9)], kOffsetOffset);

          // Upload once, and then never
          yield queueEffect(
            (q) => q.writeBuffer(staticUniformBuffer, 0, staticValues),
            [staticUniformBuffer]
          );

          const uniformValues = new Float32Array(uniformBufferSize / 4);
          const uniformBuffer: GPUBuffer = yield createBuffer({
            label: `changing uniforms for obj: ${i}`,
            size: uniformBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });

          const bindGroup: GPUBindGroup = yield createBindGroup({
            label: `bind group for obj: ${i}`,
            layout: bingGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: staticUniformBuffer } },
              { binding: 1, resource: { buffer: uniformBuffer } },
            ],
          });

          const out = {
            scale: rand(0.2, 0.5),
            uniformBuffer,
            staticUniformBuffer,
            staticValues,
            uniformValues,
            bindGroup,
          };

          objectInfos.push(out);
          unkey();
        }

        const main: FrameCallback = yield pushFrame(({ encoder, queue }) => {
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

          const aspect = canvas.width / canvas.height;

          for (const {
            scale,
            bindGroup,
            uniformBuffer,
            uniformValues,
          } of objectInfos) {
            uniformValues.set([scale / aspect, scale], kScaleOffset);
            queue.writeBuffer(uniformBuffer, 0, uniformValues);
            pass.setBindGroup(0, bindGroup);
            pass.draw(3);
          }
          pass.end();
        }, []);

        const randomize: GPUAction = yield action(
          async ({ queue, invalidate }) => {
            for (const { staticValues, staticUniformBuffer } of objectInfos) {
              staticValues.set([rand(), rand(), rand(), 1], kColorOffset);
              staticValues.set(
                [rand(-0.9, 0.9), rand(-0.9, 0.9)],
                kOffsetOffset
              );
              queue.writeBuffer(staticUniformBuffer, 0, staticValues);
            }
            invalidate(main);
          }
        );
        console.timeEnd("ReRun");

        return { randomize };
      },
      [presentationFormat, force]
    ) ?? {};

  return (
    <ToOverlay>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        disabled={!randomize}
        onClick={() => {
          randomize().catch(console.error);
        }}
      >
        Randomize
      </button>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        onClick={() => setForce((x) => x + 1)}
      >
        Force rerender
      </button>
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
