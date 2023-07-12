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
import { useCanvas } from "~/webgpu/use-canvas";
import { useToggle } from "usehooks-ts";
import { ToOverlay } from "~/utils/overlay";
import { getSourceSize, numMipLevels } from "~/utils/mips";
import { range } from "~/utils/other";
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
import { useGPU } from "~/webgpu/use-gpu";

const makeMipGenerator = function* (texture: GPUTexture) {
  const shader: GPUShaderModule = yield createShaderModule({
    label: "mip-map generation shader",
    code: /* wgsl */ `
    struct VSOutput {
      @builtin(position) position: vec4f,
      @location(0) texcoord: vec2f,
    };

    @vertex fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VSOutput {
      var pos = array<vec2f, 6>(

        // 1st triangle
        vec2f( 0.0,  0.0),  // center
        vec2f( 1.0,  0.0),  // right, center
        vec2f( 0.0,  1.0),  // center, top

        // 2nd triangle
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

    @fragment fn fsMain(fsInput: VSOutput) -> @location(0) vec4f {
      return textureSample(ourTexture, ourSampler, fsInput.texcoord);
    }
  `,
  });

  const sampler: GPUSampler = yield createSampler({
    minFilter: "linear",
    label: "mip map sampler",
  });

  const pipeline: GPURenderPipeline = yield createRenderPipeline({
    label: "Mipmap pipeline",
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "vsMain",
    },
    fragment: {
      module: shader,
      entryPoint: "fsMain",
      targets: [{ format: texture.format }],
    },
  });

  let width = texture.width;
  let height = texture.height;
  let baseMipLevel = 0;

  const renders: ((encoder: GPUCommandEncoder) => void)[] = [];

  while (width > 1 || height > 1) {
    const unkey: () => void = yield key(baseMipLevel);
    width = Math.max(1, (width / 2) | 0);
    height = Math.max(1, (height / 2) | 0);
    const bindGroup: GPUBindGroup = yield createBindGroup({
      label: "Mipmap bind group layout",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        {
          binding: 1,
          resource: texture.createView({
            baseMipLevel,
            mipLevelCount: 1,
          }),
        },
      ],
    });

    ++baseMipLevel;

    const copy = baseMipLevel;

    const renderPassDescriptor = {
      label: "our basic canvas renderPass",
      colorAttachments: [
        {
          view: texture.createView({ baseMipLevel: copy, mipLevelCount: 1 }),
          loadOp: "clear",
          storeOp: "store",
        } as const,
      ],
    };

    renders.push((encoder) => {
      const pass = encoder.beginRenderPass(renderPassDescriptor);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();
    });

    unkey();
  }

  return renders;
};

const Example: FC = () => {
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

  useGPU(
    function* () {
      const shader: GPUShaderModule = yield createShaderModule({
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

      const pipeline: GPURenderPipeline = yield createRenderPipeline({
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

      const texture: GPUTexture = yield createTexture({
        label: `Canvas texture ${mips ? "when the texture has mips" : ""}`,
        format: "rgba8unorm",
        mipLevelCount: mips ? numMipLevels(...size) : 1,
        size,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

      const updateMips: ((encoder: GPUCommandEncoder) => void)[] = mips
        ? yield makeMipGenerator(texture)
        : [];

      type ObjectInfo = {
        bindGroup: GPUBindGroup;
        matrix: Float32Array;
        texture: GPUTexture;
        uniformValues: Float32Array;
        uniformBuffer: GPUBuffer;
      };

      const objectInfos: ObjectInfo[] = [];
      for (const i of range(8)) {
        const unkey: () => void = yield key(i);
        const sampler: GPUSampler = yield createSampler({
          label: `Mip map sampler ${i}`,
          addressModeU: "repeat",
          addressModeV: "repeat",
          magFilter: i & 1 ? "linear" : "nearest",
          minFilter: i & 2 ? "linear" : "nearest",
          mipmapFilter: i & 4 ? "linear" : "nearest",
        });

        const uniformBufferSize = 16 * 4;
        const uniformBuffer: GPUBuffer = yield createBuffer({
          label: `Uniforms for quad ${i}`,
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
        objectInfos.push({
          bindGroup,
          matrix,
          texture,
          uniformValues,
          uniformBuffer,
        });

        unkey();
      }

      yield pushFrame(function ({ time, queue, encoder }) {
        updateCanvas(time);
        queue.copyExternalImageToTexture(
          { source: ctx.canvas, flipY: true },
          { texture },
          { width: size[0], height: size[1] }
        );

        updateMips.forEach((fn) => fn(encoder));

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
    [presentationFormat, mips]
  );

  const canvas = useWebGPUCanvas();

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
