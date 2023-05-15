import { type NextPage } from "next";
import Head from "next/head";

import { type FC } from "react";
import { useWebGPUContext } from "~/webgpu/canvas";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useFrame } from "~/webgpu/per-frame";
import { usePipeline, useShaderModule } from "~/webgpu/shader";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";

const Example: FC = () => {
  const entireShaderApparently = useShaderModule(
    /* wgsl */ `
    @vertex fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
      var pos = array<vec2f, 3>(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
      );

      return vec4f(pos[vertexIndex], 0.0, 1.0);
    }

    @fragment fn fsMain() -> @location(0) vec4f {
      return vec4f(1.0, 0.0, 0.0, 1.0);
    }
  `,
    "our hardcoded red triangle shader"
  );

  const pipeline = usePipeline(entireShaderApparently, "Main render pipeline");

  const device = useGPUDevice();
  const context = useWebGPUContext();

  useFrame(() => {
    if (!device || !pipeline) return;

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "our basic canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0.0, 0.0, 0.1, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    immediateRenderPass(device, "triangle encoder", (encoder) => {
      renderPass(encoder, renderPassDescriptor, (pass) => {
        pass.setPipeline(pipeline);
        pass.draw(3);
      });
    });
  });

  return null;
};

const Home: NextPage = () => {
  return (
    <>
      <Head>
        <title>WebGPU Tests</title>
        <link rel="icon" href="/favicon.svg" />
      </Head>
      <WebGPUApp fullscreen width={500} height={500}>
        <Example />
      </WebGPUApp>
    </>
  );
};

export default Home;
