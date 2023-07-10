import { type NextPage } from "next";
import Head from "next/head";

import { type FC } from "react";
import { usePresentationFormat, useWebGPUContext } from "~/webgpu/canvas";
import { WebGPUApp } from "~/utils/webgpu-app";
import { useGPUButBetter } from "~/webgpu/use-gpu-but-better";
import {
  createRenderPipeline,
  createShaderModule,
  pushFrame,
} from "~/webgpu/web-gpu-plugin";

const Example: FC = () => {
  const presentationFormat = usePresentationFormat();

  const context = useWebGPUContext();

  useGPUButBetter(
    function* () {
      const shader: GPUShaderModule = yield createShaderModule({
        label: "our hardcoded red triangle shader",
        code: /* wgsl */ `
          @vertex fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
            var pos = array<vec2f, 3>(
              vec2f( 0.0,  0.5),
              vec2f(-0.5, -0.5),
              vec2f( 0.5, -0.5),
            );
            return vec4f(pos[vertexIndex], 0.0, 1.0);
          }
      
          @fragment fn fsMain() -> @location(0) vec4f {
            return vec4f(1.0, 0.0, 0.0, 1.0);
          }
        `,
      });

      const pipeline: GPURenderPipeline = yield createRenderPipeline({
        label: "Main render pipeline",
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

      yield pushFrame(({ encoder }) => {
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

        const pass = encoder.beginRenderPass(renderPassDescriptor);
        pass.setPipeline(pipeline);
        pass.draw(3);
        pass.end();
      }, []);
    },
    [presentationFormat]
  );

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
