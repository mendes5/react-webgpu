import { type NextPage } from "next";
import Head from "next/head";

import { type FC } from "react";
import { useWebGPUCanvas, useWebGPUContext } from "~/webgpu/canvas";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useFrame } from "~/webgpu/per-frame";
import { usePipeline, useShaderModule } from "~/webgpu/resources";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";
import { ToOverlay } from "~/utils/overlay";
import { rand, range } from "~/utils/other";
import { useAction, useMemoBag } from "~/utils/hooks";

// The entire random triangles thing is just this
// component, everything else is a one layer deep wrapper
// the code being declarative means we can trivially mix
// react buttons/events with raw GPU orcherstration code
const Example: FC = () => {
  const shader = useShaderModule(
    /* wgsl */ `
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
    "rgb  triangle shader"
  );

  /**
   * Pipeline will be recreated if the shader changes
   */
  const pipeline = usePipeline(shader, "Main render pipeline");

  const device = useGPUDevice();
  const context = useWebGPUContext();

  const kColorOffset = 0;
  const kOffsetOffset = 4;

  const kScaleOffset = 0;

  const { objectInfos } =
    useMemoBag(
      { device, pipeline },
      ({ device, pipeline }) => {
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

        // Not a fan of the 100 bind groups approach
        // could be usefull still for thigs
        // that share the same shader but their
        // data dont change in bulk too often
        for (const i of range(kNumObjects)) {
          const staticUniformBuffer = device.createBuffer({
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
          const uniformBuffer = device.createBuffer({
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

        return { objectInfos };
      },
      [device, pipeline]
    ) ?? {};

  const { locked, execute } = useAction(
    { device, objectInfos },
    ({ device, objectInfos }) => {
      for (const { staticValues, staticUniformBuffer } of objectInfos) {
        staticValues.set([rand(), rand(), rand(), 1], kColorOffset);
        staticValues.set([rand(-0.9, 0.9), rand(-0.9, 0.9)], kOffsetOffset);

        // Upload once, here if the user clicks
        // since WebGPU is not statefull we can do it whenever we want
        // no need to wait a render pass to finish or something like that
        device.queue.writeBuffer(staticUniformBuffer, 0, staticValues);
      }
    },
    []
  );

  /**
   * It's so much more easy that way...
   *
   * If I randomly need access to the canvas I just
   * call useWebGPUCanvas and get a reference to it
   *
   * No need for a base Object3D class or magic Managers
   * just get what you need and use it
   */
  const canvas = useWebGPUCanvas();

  useFrame(() => {
    if (!pipeline || !objectInfos || !device) return null;

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
  });

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
