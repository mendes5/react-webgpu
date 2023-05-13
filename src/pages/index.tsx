import { type NextPage } from "next";
import Head from "next/head";

import { api } from "~/utils/api";

import { type FC } from "react";
import { WebGPUCanvas, useWebGPUContext } from "~/webgpu/canvas";
import { Inspector } from "~/webgpu/debug";
import { WebGPUDevice, useGPUDevice } from "~/webgpu/gpu-device";
import { RenderController, useFrame } from "~/webgpu/per-frame";
import { usePipeline, useShaderModule } from "~/webgpu/shader";
import styles from "./style.module.css";

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
    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "our basic canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0.3, 0.3, 0.0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    const encoder = device.createCommandEncoder({ label: "our encoder" });

    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  });

  return null;
};

const Home: NextPage = () => {
  const version = api.meta.version.useQuery();

  return (
    <>
      <Head>
        <title>WebGPU Tests</title>
        <link rel="icon" href="/favicon.svg" />
        <meta rel="app-version" content={version.data} />
      </Head>
      <Inspector name="root">
        <RenderController enabled>
          <WebGPUDevice fallback={<h1>Failed to create GPUDevice</h1>}>
            <div className={styles.root}>
              <WebGPUCanvas
                fallback={<h1>Failed to create Canvas</h1>}
                width={500}
                height={500}
              >
                <Example />
              </WebGPUCanvas>
            </div>
          </WebGPUDevice>
        </RenderController>
      </Inspector>
    </>
  );
};

export default Home;
