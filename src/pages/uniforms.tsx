import { type NextPage } from "next";
import Head from "next/head";

import { useRef, type FC } from "react";
import {
  usePresentationFormat,
  useWebGPUCanvas,
  useWebGPUContext,
} from "~/webgpu/canvas";
import { useFrame } from "~/webgpu/per-frame";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";
import { ToOverlay } from "~/utils/overlay";
import { rand, range } from "~/utils/other";
import { useAction } from "~/utils/hooks";
import { gpu, useGPU } from "~/webgpu/use-gpu";

const Example: FC = () => {
  const frameRef = useRef<(time: number) => void>();
  useFrame((time) => {
    frameRef.current?.(time);
  });
  const canvas = useWebGPUCanvas();

  const presentationFormat = usePresentationFormat();
  const context = useWebGPUContext();

  const kColorOffset = 0;
  const kOffsetOffset = 4;
  const kScaleOffset = 0;

  const actionRef = useRef<() => void>();

  useGPU(
    ({ device }) => {
      const shader = gpu.createShaderModule({
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

      const pipeline = gpu.createRenderPipeline({
        label: "Uniforms example render pipeline",
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
        const staticUniformBuffer = gpu.createBuffer({
          label: `static uniforms for obj: ${i}`,
          size: staticUniformBufferSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const staticValues = new Float32Array(staticUniformBufferSize / 4);
        staticValues.set([rand(), rand(), rand(), 1], kColorOffset);
        staticValues.set([rand(-0.9, 0.9), rand(-0.9, 0.9)], kOffsetOffset);

        // Upload once, and then never
        device.queue.writeBuffer(staticUniformBuffer, 0, staticValues);

        const uniformValues = new Float32Array(uniformBufferSize / 4);
        const uniformBuffer = gpu.createBuffer({
          label: `changing uniforms for obj: ${i}`,
          size: uniformBufferSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const bindGroup = device.createBindGroup({
          label: `bind group for obj: ${i}`,
          layout: pipeline.getBindGroupLayout(0),
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
      }

      actionRef.current = () => {
        for (const { staticValues, staticUniformBuffer } of objectInfos) {
          staticValues.set([rand(), rand(), rand(), 1], kColorOffset);
          staticValues.set([rand(-0.9, 0.9), rand(-0.9, 0.9)], kOffsetOffset);
          device.queue.writeBuffer(staticUniformBuffer, 0, staticValues);
        }
      };

      frameRef.current = () => {
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

        immediateRenderPass(device, "triangle encoder", (encoder) => {
          renderPass(encoder, renderPassDescriptor, (pass) => {
            pass.setPipeline(pipeline);

            const aspect = canvas.width / canvas.height;

            for (const {
              scale,
              bindGroup,
              uniformBuffer,
              uniformValues,
            } of objectInfos) {
              uniformValues.set([scale / aspect, scale], kScaleOffset);
              device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
              pass.setBindGroup(0, bindGroup);
              pass.draw(3);
            }
          });
        });
      };
    },
    [presentationFormat]
  );

  const { locked, execute } = useAction({}, () => actionRef.current?.(), []);

  return (
    <ToOverlay>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        disabled={locked}
        onClick={execute}
      >
        Randomize
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
