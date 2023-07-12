import { type NextPage } from "next";
import Head from "next/head";

import { type FC } from "react";
import {
  usePresentationFormat,
  useWebGPUCanvas,
  useWebGPUContext,
} from "~/webgpu/canvas";
import { WebGPUApp } from "~/utils/webgpu-app";
import { type Vec3, mat4 } from "~/utils/math";
import { useAsyncResource } from "~/utils/hooks";
import { useGPU } from "~/webgpu/use-gpu";
import { getSourceSize } from "~/utils/mips";
import type { H } from "~/utils/other";
import { useGPUButBetter } from "~/webgpu/use-gpu-but-better";
import {
  createBindGroup,
  createBuffer,
  createRenderPipeline,
  createSampler,
  createShaderModule,
  createTexture,
  pushFrame,
} from "~/webgpu/web-gpu-plugin";
import { key } from "~/trace";

function startPlayingAndWaitForVideo(video: HTMLVideoElement) {
  return new Promise((resolve, reject) => {
    video.addEventListener("error", reject);
    video.requestVideoFrameCallback(resolve);
    video.play().catch(reject);
  });
}

const Example: FC = () => {
  const canvas = useWebGPUCanvas();
  const context = useWebGPUContext();

  const presentationFormat = usePresentationFormat();

  const kMatrixOffset = 0;

  const video = useAsyncResource(async (dispose) => {
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
  }, []);

  useGPUButBetter(
    function* () {
      if (video.type !== "success") return;
      const shader: GPUShaderModule = yield createShaderModule({
        label: "Dogege shader",
        code: /* wgsl */ `
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
      });

      const pipeline: GPURenderPipeline = yield createRenderPipeline({
        label: "Dogege pipeline",
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

      const size = getSourceSize(video.value.video);

      const texture: GPUTexture = yield createTexture({
        format: "rgba8unorm",
        // mipLevelCount: false ? numMipLevels(...size) : 1,
        mipLevelCount: 1,
        size,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

      const updateTexture = (queue: GPUQueue) => {
        const size = getSourceSize(video.value.video);
        queue.copyExternalImageToTexture(
          { source: video.value.video },
          { texture },
          { width: size[0], height: size[1] }
        );

        if (texture.mipLevelCount > 1) {
          // renderMips();
        }
      };

      const objectInfos = [] as {
        bindGroup: GPUBindGroup;
        matrix: Float32Array;
        uniformValues: Float32Array;
        uniformBuffer: H<GPUBuffer>;
      }[];

      for (let i = 0; i < 8; ++i) {
        const unkey: () => void = yield key(i);
        const sampler: GPUSampler = yield createSampler({
          label: `Sampler ${i} for dogege`,
          addressModeU: "repeat",
          addressModeV: "repeat",
        });

        const uniformBufferSize = 16 * 4;
        const uniformBuffer: H<GPUBuffer> = yield createBuffer({
          label: `uniforms buffer for quad ${i}`,
          size: uniformBufferSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const uniformValues = new Float32Array(uniformBufferSize / 4);
        const matrix = uniformValues.subarray(kMatrixOffset, 16);

        const bindGroup: GPUBindGroup = yield createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: texture.createView() },
            { binding: 2, resource: { buffer: uniformBuffer } },
          ],
        });

        const info = {
          bindGroup,
          matrix,
          uniformValues,
          uniformBuffer,
        };
        objectInfos.push(info);
        unkey();
      }

      yield pushFrame(({ queue, encoder }) => {
        updateTexture(queue);

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

            queue.writeBuffer(uniformBuffer, 0, uniformValues);

            pass.setBindGroup(0, bindGroup);
            pass.draw(6);
          }
        );
        pass.end();
      });
    },
    [presentationFormat, video.type]
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

      <WebGPUApp fullscreen>
        <Example />
      </WebGPUApp>
    </>
  );
};

export default Home;
