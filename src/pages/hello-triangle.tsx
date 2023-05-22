import { type NextPage } from "next";
import Head from "next/head";

import { useRef, type FC } from "react";
import { usePresentationFormat, useWebGPUContext } from "~/webgpu/canvas";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useFrame } from "~/webgpu/per-frame";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";
import { gpu, useGPU } from "~/webgpu/use-gpu";

const Example: FC = () => {
  const presentationFormat = usePresentationFormat();

  const device = useGPUDevice();
  const context = useWebGPUContext();

  const frameRef = useRef<(time: number) => void>();

  useGPU(
    { presentationFormat, device },
    ({ presentationFormat, device }) => {
      const shader = gpu.createShaderModule({
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

      const pipeline = gpu.createRenderPipeline({
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

      frameRef.current = () => {
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
      };
    },
    []
  );

  useFrame((time) => {
    frameRef.current?.(time);
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
