import { type NextPage } from "next";
import Head from "next/head";

import { type FC } from "react";
import {
  usePresentationFormat,
  useWebGPUCanvas,
  useWebGPUContext,
} from "~/webgpu/canvas";
import { WebGPUApp } from "~/utils/webgpu-app";
import { ToOverlay } from "~/utils/overlay";
import { type MipTexture, generateMips } from "~/utils/mips";
import { type Vec3, mat4 } from "~/utils/math";
import { useRefTrap } from "~/webgpu/use-gpu";
import { useGPUButBetter } from "~/webgpu/use-gpu-but-better";
import {
  createBindGroup,
  createBuffer,
  createRenderPipeline,
  createSampler,
  createShaderModule,
  createTexture,
  pushFrame,
  queueEffect,
} from "~/webgpu/web-gpu-plugin";
import { key, r } from "~/trace";
import { type H } from "~/utils/other";

const createTextureWithMips = r(function* (
  mips: (MipTexture | ImageData)[],
  label?: string
) {
  const texture: GPUTexture = yield createTexture({
    label,
    size: [mips[0]!.width, mips[0]!.height],
    mipLevelCount: mips.length,
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  let mipLevel = 0;
  for (const { data, width, height } of mips) {
    const unkey: () => void = yield key(mipLevel);
    yield queueEffect(
      (q) =>
        q.writeTexture(
          { texture, mipLevel },
          data,
          { bytesPerRow: width * 4 },
          { width, height }
        ),
      []
    );
    unkey();
    mipLevel++;
  }

  return texture;
});

const Example: FC = () => {
  const context = useWebGPUContext();
  const toggleRef = useRefTrap(true);
  const canvas = useWebGPUCanvas();

  const presentationFormat = usePresentationFormat();

  useGPUButBetter(
    function* () {
      const shader: GPUShaderModule = yield createShaderModule({
        label: "CPU Mips shader",
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
        }
      `,
      });

      const pipeline: GPURenderPipeline = yield createRenderPipeline({
        label: "CPU Mips render pipeline",
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

      const textures = [
        yield createTextureWithMips(createBlendedMipmap(), "blended"),
        yield createTextureWithMips(createCheckedMipmap(), "checker"),
      ] as H<GPUTexture>[];

      const kMatrixOffset = 0;
      const objectInfos = [] as {
        bindGroups: GPUBindGroup[];
        matrix: Float32Array;
        uniformValues: Float32Array;
        uniformBuffer: GPUBuffer;
      }[];

      for (let i = 0; i < 8; ++i) {
        const unkey: () => void = yield key(i);
        const sampler = yield createSampler({
          addressModeU: "repeat",
          addressModeV: "repeat",
          magFilter: i & 1 ? "linear" : "nearest",
          minFilter: i & 2 ? "linear" : "nearest",
          mipmapFilter: i & 4 ? "linear" : "nearest",
        });

        // create a buffer for the uniform values
        const uniformBufferSize = 16 * 4; // matrix is 16 32bit floats (4bytes each)
        const uniformBuffer = yield createBuffer({
          label: `uniforms for quad`,
          size: uniformBufferSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // create a typedarray to hold the values for the uniforms in JavaScript
        const uniformValues = new Float32Array(uniformBufferSize / 4);
        const matrix = uniformValues.subarray(kMatrixOffset, 16);

        const bindGroups: GPUBindGroup[] = [];
        for (const texture of textures) {
          const unkey: () => void = yield key(texture.instanceId);
          const group: GPUBindGroup = yield createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: sampler },
              { binding: 1, resource: texture.createView() },
              { binding: 2, resource: { buffer: uniformBuffer } },
            ],
          });
          bindGroups.push(group);
          unkey();
        }

        objectInfos.push({
          bindGroups,
          matrix,
          uniformValues,
          uniformBuffer,
        });
        unkey();
      }

      yield pushFrame(({ queue, encoder }) => {
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
          ({ bindGroups, matrix, uniformBuffer, uniformValues }, i) => {
            const bindGroup = bindGroups[toggleRef.current ? 0 : 1]!;

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
            queue.writeBuffer(uniformBuffer, 0, uniformValues);

            pass.setBindGroup(0, bindGroup);
            pass.draw(6); // call our vertex shader 6 times
          }
        );

        pass.end();
      }, []);
    },
    [presentationFormat]
  );

  return (
    <ToOverlay>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        onClick={() => {
          toggleRef.current = !toggleRef.current;
        }}
      >
        Change Texture
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

const createBlendedMipmap = () => {
  const w = [255, 255, 255, 255];
  const r = [255, 0, 0, 255];
  const b = [0, 28, 116, 255];
  const y = [255, 231, 0, 255];
  const g = [58, 181, 75, 255];
  const a = [38, 123, 167, 255];
  // prettier-ignore
  const data = new Uint8Array([
    w, r, r, r, r, r, r, a, a, r, r, r, r, r, r, w,
    w, w, r, r, r, r, r, a, a, r, r, r, r, r, w, w,
    w, w, w, r, r, r, r, a, a, r, r, r, r, w, w, w,
    w, w, w, w, r, r, r, a, a, r, r, r, w, w, w, w,
    w, w, w, w, w, r, r, a, a, r, r, w, w, w, w, w,
    w, w, w, w, w, w, r, a, a, r, w, w, w, w, w, w,
    w, w, w, w, w, w, w, a, a, w, w, w, w, w, w, w,
    b, b, b, b, b, b, b, b, a, y, y, y, y, y, y, y,
    b, b, b, b, b, b, b, g, y, y, y, y, y, y, y, y,
    w, w, w, w, w, w, w, g, g, w, w, w, w, w, w, w,
    w, w, w, w, w, w, r, g, g, r, w, w, w, w, w, w,
    w, w, w, w, w, r, r, g, g, r, r, w, w, w, w, w,
    w, w, w, w, r, r, r, g, g, r, r, r, w, w, w, w,
    w, w, w, r, r, r, r, g, g, r, r, r, r, w, w, w,
    w, w, r, r, r, r, r, g, g, r, r, r, r, r, w, w,
    w, r, r, r, r, r, r, g, g, r, r, r, r, r, r, w,
  ].flat());
  return generateMips(data, 16);
};

const createCheckedMipmap = () => {
  const ctx = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Failed to create canvas");
  }

  const levels = [
    { size: 64, color: "rgb(128,0,255)" },
    { size: 32, color: "rgb(0,255,0)" },
    { size: 16, color: "rgb(255,0,0)" },
    { size: 8, color: "rgb(255,255,0)" },
    { size: 4, color: "rgb(0,0,255)" },
    { size: 2, color: "rgb(0,255,255)" },
    { size: 1, color: "rgb(255,0,255)" },
  ];
  return levels.map(({ size, color }, i) => {
    ctx.canvas.width = size;
    ctx.canvas.height = size;
    ctx.fillStyle = i & 1 ? "#000" : "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size / 2, size / 2);
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
    return ctx.getImageData(0, 0, size, size);
  });
};
