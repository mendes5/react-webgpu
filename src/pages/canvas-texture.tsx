import { type NextPage } from "next";
import Head from "next/head";

import { useRef, type FC } from "react";
import {
  usePresentationFormat,
  useWebGPUCanvas,
  useWebGPUContext,
} from "~/webgpu/canvas";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useFrame } from "~/webgpu/per-frame";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";
import { type Vec3, mat4 } from "~/utils/math";
import { useCanvas } from "~/webgpu/use-canvas";
import { useToggle } from "usehooks-ts";
import { ToOverlay } from "~/utils/overlay";
import { gpu, useGPU } from "~/webgpu/use-gpu";
import { getSourceSize, numMipLevels } from "~/utils/mips";
import { makeWithMips } from "~/webgpu/gpu-mipmap";
import { range } from "~/utils/other";

const Example: FC = () => {
  const device = useGPUDevice();

  const context = useWebGPUContext();

  const kMatrixOffset = 0;

  const [ctx, updateCanvas] = useCanvas(
    (ctx, time: number) => {
      const hsl = (h: number, s: number, l: number) =>
        `hsl(${(h * 360) | 0}, ${s * 100}%, ${(l * 100) | 0}%)`;

      const size = 256;
      const half = size / 2;

      time *= 0.0001;
      if (!ctx) throw new Error("Error");
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(half, half);
      const num = 20;
      for (let i = 0; i < num; ++i) {
        ctx.fillStyle = hsl((i / num) * 0.2 + time * 0.1, 1, (i % 2) * 0.5);
        ctx.fillRect(-half, -half, size, size);
        ctx.rotate(time * 0.5);
        ctx.scale(0.85, 0.85);
        ctx.translate(size / 16, 0);
      }
      ctx.restore();
    },
    { size: 256 }
  );

  const [mips, toggleMips] = useToggle(true);

  const presentationFormat = usePresentationFormat();

  const frameRef = useRef<(time: number) => void>();

  useGPU(
    { presentationFormat, device },
    ({ presentationFormat, device }) => {
      const shader = gpu.createShaderModule({
        label: "Canvas texture shader",
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
            vec2f(0.0,  0.0),
            vec2f(1.0,  0.0),
            vec2f(0.0,  1.0),
            vec2f(0.0,  1.0),
            vec2f(1.0,  0.0),
            vec2f(1.0,  1.0),
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

      const pipeline = gpu.createRenderPipeline({
        label: "Canvas texture render pipeline",
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

      const size = getSourceSize(ctx.canvas);

      const texture = gpu.createTexture({
        label: "Canvas texture",
        format: "rgba8unorm",
        mipLevelCount: mips ? numMipLevels(...size) : 1,
        size,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

      const updateMips = makeWithMips(gpu, device, texture);

      const objectInfos = range(8).map((i) => {
        const sampler = gpu.createSampler({
          label: `Mip map sampler ${i}`,
          addressModeU: "repeat",
          addressModeV: "repeat",
          magFilter: i & 1 ? "linear" : "nearest",
          minFilter: i & 2 ? "linear" : "nearest",
          mipmapFilter: i & 4 ? "linear" : "nearest",
        });

        const uniformBufferSize = 16 * 4;
        const uniformBuffer = gpu.createBuffer({
          label: `Uniforms for quad ${i}`,
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

        return {
          bindGroup,
          matrix,
          texture,
          uniformValues,
          uniformBuffer,
        };
      });

      frameRef.current = (time) => {
        updateCanvas(time);

        device.queue.copyExternalImageToTexture(
          { source: ctx.canvas, flipY: true },
          { texture },
          { width: size[0], height: size[1] }
        );

        if (mips) {
          updateMips();
        }

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
            const fov = (60 * Math.PI) / 180; // 60 degrees in radians
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

                // copy the values from JavaScript to the GPU
                device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

                pass.setBindGroup(0, bindGroup);
                pass.draw(6); // call our vertex shader 6 times
              }
            );
          });
        });
      };
      return {};
    },
    [mips]
  );

  const canvas = useWebGPUCanvas();

  useFrame((time) => {
    frameRef.current?.(time);
  });

  return (
    <ToOverlay>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        onClick={toggleMips}
      >
        MipMaps:{" "}
        {mips ? (
          <span className="text-lime-600">ON</span>
        ) : (
          <span className="text-red-600">OFF</span>
        )}
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
