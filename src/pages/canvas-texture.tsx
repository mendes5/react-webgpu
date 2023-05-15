import { type NextPage } from "next";
import Head from "next/head";

import { type FC } from "react";
import { useWebGPUCanvas, useWebGPUContext } from "~/webgpu/canvas";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useFrame } from "~/webgpu/per-frame";
import { usePipeline, useShaderModule } from "~/webgpu/shader";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";
import { type Vec3, mat4 } from "~/utils/math";
import { numMipLevels } from "~/utils/mips";
import { useMemoBag } from "~/utils/hooks";
import { type H } from "~/utils/other";

const generateMips = (() => {
  let sampler: GPUSampler;
  let shaderModule: GPUShaderModule;
  let deviceUsedForModule: H<GPUDevice>;
  let deviceUsedForPipe: H<GPUDevice>;

  const pipelineByFormat = {} as Record<GPUTextureFormat, GPURenderPipeline>;

  return function generateMips(device: H<GPUDevice>, texture: GPUTexture) {
    if (
      !shaderModule ||
      deviceUsedForModule?.instanceId !== device.instanceId
    ) {
      deviceUsedForModule = device;
      shaderModule = device.createShaderModule({
        label: "textured quad shaders for mip level generation",
        code: `
          struct VSOutput {
            @builtin(position) position: vec4f,
            @location(0) texcoord: vec2f,
          };

          @vertex fn vs(
            @builtin(vertex_index) vertexIndex : u32
          ) -> VSOutput {
            var pos = array<vec2f, 6>(

              vec2f( 0.0,  0.0),  // center
              vec2f( 1.0,  0.0),  // right, center
              vec2f( 0.0,  1.0),  // center, top

              // 2st triangle
              vec2f( 0.0,  1.0),  // center, top
              vec2f( 1.0,  0.0),  // right, center
              vec2f( 1.0,  1.0),  // right, top
            );

            var vsOutput: VSOutput;
            let xy = pos[vertexIndex];
            vsOutput.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
            vsOutput.texcoord = vec2f(xy.x, 1.0 - xy.y);
            return vsOutput;
          }

          @group(0) @binding(0) var ourSampler: sampler;
          @group(0) @binding(1) var ourTexture: texture_2d<f32>;

          @fragment fn fs(fsInput: VSOutput) -> @location(0) vec4f {
            return textureSample(ourTexture, ourSampler, fsInput.texcoord);
          }
        `,
      });

      sampler = device.createSampler({
        minFilter: "linear",
      });
    }

    if (
      !pipelineByFormat[texture.format] ||
      deviceUsedForPipe?.instanceId !== device.instanceId
    ) {
      deviceUsedForPipe = device;
      pipelineByFormat[texture.format] = device.createRenderPipeline({
        label: "mip level generator pipeline",
        layout: "auto",
        vertex: {
          module: shaderModule,
          entryPoint: "vs",
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fs",
          targets: [{ format: texture.format }],
        },
      });
    }
    const pipeline = pipelineByFormat[texture.format];

    const encoder = device.createCommandEncoder({
      label: "mip gen encoder",
    });

    let width = texture.width;
    let height = texture.height;
    let baseMipLevel = 0;
    while (width > 1 || height > 1) {
      width = Math.max(1, (width / 2) | 0);
      height = Math.max(1, (height / 2) | 0);

      const bindGroup = device.createBindGroup({
        label: "Mipmap bind group layout",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          {
            binding: 1,
            resource: texture.createView({ baseMipLevel, mipLevelCount: 1 }),
          },
        ],
      });

      ++baseMipLevel;

      const renderPassDescriptor = {
        label: "our basic canvas renderPass",
        colorAttachments: [
          {
            view: texture.createView({ baseMipLevel, mipLevelCount: 1 }),
            loadOp: "clear",
            storeOp: "store",
          } as const,
        ],
      };

      const pass = encoder.beginRenderPass(renderPassDescriptor);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6); // call our vertex shader 6 times
      pass.end();
    }

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  };
})();

function copySourceToTexture(
  device: H<GPUDevice>,
  texture: GPUTexture,
  source: GPUImageCopyExternalImage["source"],
  { flipY }: { flipY?: boolean } = {}
) {
  device.queue.copyExternalImageToTexture(
    { source, flipY },
    { texture },
    { width: source.width, height: source.height }
  );

  if (texture.mipLevelCount > 1) {
    generateMips(device, texture);
  }
}

function createTextureFromSource(
  device: H<GPUDevice>,
  source: GPUImageCopyExternalImage["source"],
  options: { mips?: boolean; flipY?: boolean } = {}
) {
  const texture = device.createTexture({
    format: "rgba8unorm",
    mipLevelCount: options.mips ? numMipLevels(source.width, source.height) : 1,
    size: [source.width, source.height],
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  copySourceToTexture(device, texture, source, options);
  return texture;
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
          // 1st triangle
          vec2f( 0.0,  0.0),  // center
          vec2f( 1.0,  0.0),  // right, center
          vec2f( 0.0,  1.0),  // center, top
        
          // 2st triangle
          vec2f( 0.0,  1.0),  // center, top
          vec2f( 1.0,  0.0),  // right, center
          vec2f( 1.0,  1.0),  // right, top
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

  const { texture, update2DCanvas, ctx } =
    useMemoBag(
      { device },
      ({ device }) => {
        const size = 256;
        const half = size / 2;

        const ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) throw new Error("Error");

        ctx.canvas.width = size;
        ctx.canvas.height = size;

        const hsl = (h: number, s: number, l: number) =>
          `hsl(${(h * 360) | 0}, ${s * 100}%, ${(l * 100) | 0}%)`;

        function update2DCanvas(time: number) {
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
        }

        const texture = createTextureFromSource(device, ctx.canvas, {
          mips: true,
        });

        return { texture, update2DCanvas, ctx };
      },
      []
    ) ?? {};

  const { objectInfos } = useMemoBag(
    { device, pipeline, texture },
    ({ device, pipeline, texture }) => {
      const objectInfos = [];

      for (let i = 0; i < 8; ++i) {
        const sampler = device.createSampler({
          addressModeU: "repeat",
          addressModeV: "repeat",
          magFilter: i & 1 ? "linear" : "nearest",
          minFilter: i & 2 ? "linear" : "nearest",
          mipmapFilter: i & 4 ? "linear" : "nearest",
        });

        // create a buffer for the uniform values
        const uniformBufferSize = 16 * 4; // matrix is 16 32bit floats (4bytes each)
        const uniformBuffer = device.createBuffer({
          label: "uniforms for quad",
          size: uniformBufferSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // create a typedarray to hold the values for the uniforms in JavaScript
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

        // Save the data we need to render this object.
        objectInfos.push({
          bindGroup,
          matrix,
          uniformValues,
          uniformBuffer,
        });
      }

      return { objectInfos };
    },
    []
  ) ?? { objectInfos: [] };

  const canvas = useWebGPUCanvas();

  useFrame((time) => {
    if (!device || !ctx || !texture || !pipeline) return;

    update2DCanvas?.(time);
    copySourceToTexture(device, texture, ctx.canvas);

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
