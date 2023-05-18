import { type NextPage } from "next";
import Head from "next/head";

import { type FC } from "react";
import { useWebGPUCanvas, useWebGPUContext } from "~/webgpu/canvas";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useFrame } from "~/webgpu/per-frame";
import {
  useExternalTexture,
  usePipeline,
  useShaderModule,
} from "~/webgpu/resources";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";
import { type Vec3, mat4 } from "~/utils/math";
import { useAsyncResource, useMemoBag } from "~/utils/hooks";

function startPlayingAndWaitForVideo(video: HTMLVideoElement) {
  return new Promise((resolve, reject) => {
    video.addEventListener("error", reject);
    video.requestVideoFrameCallback(resolve);
    video.play().catch(reject);
  });
}

const Example: FC = () => {
  const device = useGPUDevice();

  const shader = useShaderModule(
    /* wgsl */ `
      struct OurVertexShaderOutput {
        @builtin(position) position: vec4f,
        @location(0) texcoord: vec2f,
      };

      struct Uniforms {
        matrix: mat4x4f,
      };
       
      @group(0) @binding(2) var<uniform> uni: Uniforms;
      
      @vertex fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> OurVertexShaderOutput {
        var pos = array<vec2f, 6>(
          vec2f( 0.0,  0.0),
          vec2f( 1.0,  0.0),
          vec2f( 0.0,  1.0),
          vec2f( 0.0,  1.0),
          vec2f( 1.0,  0.0),
          vec2f( 1.0,  1.0),
        );

        var vsOutput: OurVertexShaderOutput;
        let xy = pos[vertexIndex];
        vsOutput.position = uni.matrix * vec4f(xy, 0.0, 1.0);
        vsOutput.texcoord = xy * vec2f(1, 50);
        return vsOutput;
      }

      @group(0) @binding(0) var ourSampler: sampler;
      @group(0) @binding(1) var ourTexture: texture_2d<f32>;

      @fragment fn fsMain(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
        return textureSample(ourTexture, ourSampler, fsInput.texcoord);
      }`,
    "rgb  triangle shader"
  );

  const pipeline = usePipeline(shader, "Main render pipeline");

  const context = useWebGPUContext();

  const kMatrixOffset = 0;

  const canvas = useWebGPUCanvas();

  const videoState = useAsyncResource(
    async (dispose) => {
      if (!device) return Promise.reject();

      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.preload = "auto";
      video.autoplay = true;
      video.src =
        "/resources/Golden_retriever_swimming_the_doggy_paddle-360-no-audio.webm";
      video.style.display = "none";
      document.body.appendChild(video);
      dispose(() => {
        document.body.removeChild(video);
      });
      await startPlayingAndWaitForVideo(video);
      return { video };
    },
    [device]
  );

  const [texture, updateTexture] = useExternalTexture(
    videoState.type === "success" ? videoState.value.video : null,
    { mips: false }
  );

  const { objectInfos } =
    useMemoBag(
      { device, pipeline, texture },
      ({ device, pipeline, texture }) => {
        const objectInfos = [];

        if (videoState.type === "success") {
          for (let i = 0; i < 8; ++i) {
            const sampler = device.createSampler({
              addressModeU: "repeat",
              addressModeV: "repeat",
            });

            const uniformBufferSize = 16 * 4;
            const uniformBuffer = device.createBuffer({
              label: "uniforms for quad",
              size: uniformBufferSize,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            const uniformValues = new Float32Array(uniformBufferSize / 4);
            const matrix = uniformValues.subarray(kMatrixOffset, 16);

            const bindGroup = device.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: texture.createView() },
                { binding: 2, resource: { buffer: uniformBuffer } },
              ],
            });

            objectInfos.push({
              bindGroup,
              matrix,
              uniformValues,
              uniformBuffer,
            });
          }
        }

        return { objectInfos };
      },
      [device, videoState, pipeline]
    ) ?? {};

  useFrame(() => {
    if (!device || !pipeline || !objectInfos) return null;
    if (videoState.type === "success") {
      updateTexture();

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
          const fov = (60 * Math.PI) / 180;
          const aspect = canvas.clientWidth / canvas.clientHeight;
          const zNear = 1;
          const zFar = 2000;
          const projectionMatrix = mat4.perspective(fov, aspect, zNear, zFar);

          const cameraPosition: Vec3 = [0, 0, 2];
          const up: Vec3 = [0, 1, 0];
          const target: Vec3 = [0, 0, 0];

          const cameraMatrix = mat4.lookAt(cameraPosition, target, up);
          const viewMatrix = mat4.inverse(cameraMatrix);
          const viewProjectionMatrix = mat4.multiply(
            projectionMatrix,
            viewMatrix
          );

          pass.setPipeline(pipeline);

          objectInfos.forEach(
            ({ bindGroup, matrix, uniformBuffer, uniformValues }, i) => {
              const xSpacing = 1.2;
              const ySpacing = 0.7;
              const zDepth = 50;

              const x = (i % 4) - 1.5;
              const y = i < 4 ? 1 : -1;

              mat4.translate(
                viewProjectionMatrix,
                [x * xSpacing, y * ySpacing, -zDepth * 0.5],
                matrix
              );
              mat4.rotateX(matrix, 0.5 * Math.PI, matrix);
              mat4.scale(matrix, [1, zDepth * 2, 1], matrix);
              mat4.translate(matrix, [-0.5, -0.5, 0], matrix);

              device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

              pass.setBindGroup(0, bindGroup);
              pass.draw(6);
            }
          );
        });
      });
    }
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

      <WebGPUApp fullscreen>
        <Example />
      </WebGPUApp>
    </>
  );
};

export default Home;
