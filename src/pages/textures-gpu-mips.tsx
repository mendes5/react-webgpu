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
import { type Vec3, mat4 } from "~/utils/math";
import { useAsyncResource } from "~/utils/hooks";
import { getSourceSize, loadImageBitmap, numMipLevels } from "~/utils/mips";
import { useRefTrap } from "~/webgpu/use-gpu";
import { key, r } from "~/trace";
import {
  createBindGroup,
  createBuffer,
  createRenderPipeline,
  createSampler,
  createShaderModule,
  createTexture,
  pushFrame,
  queueEffect,
  renderEffect,
} from "~/webgpu/web-gpu-plugin";
import { useGPU } from "~/webgpu/use-gpu";
import { type H } from "~/utils/other";

const renderMips = r(function* (texture: GPUTexture) {
  const shader: GPUShaderModule = yield createShaderModule({
    label: "GPU Mips generator shader",
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
    label: "GPU mips generator sampler",
    minFilter: "linear",
  });

  const pipeline: GPURenderPipeline = yield createRenderPipeline({
    label: "GPU mips generator render pipeline",
    layout: "auto",
    vertex: {
      entryPoint: "vsMain",
      module: shader,
    },
    fragment: {
      entryPoint: "fsMain",
      module: shader,
      targets: [{ format: texture.format }],
    },
  });

  const commands: ((encoder: GPUCommandEncoder) => void)[] = [];

  let width = texture.width;
  let height = texture.height;
  let baseMipLevel = 0;

  while (width > 1 || height > 1) {
    width = Math.max(1, (width / 2) | 0);
    height = Math.max(1, (height / 2) | 0);

    const bindGroup: GPUBindGroup = yield createBindGroup({
      label: `Mipmap bind group layout L=${baseMipLevel}`,
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
    commands.push((encoder) => {
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

      const pass = encoder.beginRenderPass(renderPassDescriptor);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6); // call our vertex shader 6 times
      pass.end();
    });
  }

  yield renderEffect(({ encoder }) => {
    commands.forEach((command) => command(encoder));
  }, []);
});

const Example: FC = () => {
  const canvas = useWebGPUCanvas();
  const context = useWebGPUContext();

  const presentationFormat = usePresentationFormat();

  const kMatrixOffset = 0;

  const texture1 = useAsyncResource(
    () => loadImageBitmap("/resources/f-texture.png"),
    []
  );

  const texture2 = useAsyncResource(
    () => loadImageBitmap("/resources/Granite_paving_tileable_512x512.jpeg"),
    []
  );

  const texture3 = useAsyncResource(
    () => loadImageBitmap("/resources/coins.jpg"),
    []
  );

  const toggleRef = useRefTrap(0);

  useGPU(
    function* () {
      if (
        texture1.type !== "success" ||
        texture2.type !== "success" ||
        texture3.type !== "success"
      )
        return;

      const shader: GPUShaderModule = yield createShaderModule({
        label: "GPU Mips renderer shader",
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
        label: "GPU Mips example render pipeline",
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

      const size1 = getSourceSize(texture1.value);
      const texture1R: H<GPUTexture> = yield createTexture({
        label: "F texture",
        size: size1,
        format: "rgba8unorm",
        mipLevelCount: numMipLevels(...size1),
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

      yield queueEffect(
        (q) =>
          q.copyExternalImageToTexture(
            { source: texture1.value, flipY: true },
            { texture: texture1R },
            { width: size1[0], height: size1[1] }
          ),
        [texture1]
      );
      yield renderMips(texture1R);

      const size2 = getSourceSize(texture2.value);
      const texture2R: H<GPUTexture> = yield createTexture({
        label: "Coins texture",
        size: size2,
        format: "rgba8unorm",
        mipLevelCount: numMipLevels(...size2),
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      yield queueEffect(
        (q) =>
          q.copyExternalImageToTexture(
            { source: texture2.value },
            { texture: texture2R },
            { width: size2[0], height: size2[1] }
          ),
        [texture2]
      );
      yield renderMips(texture2R);

      const size3 = getSourceSize(texture3.value);
      const texture3R: H<GPUTexture> = yield createTexture({
        label: "Cobble texture",
        size: size3,
        format: "rgba8unorm",
        mipLevelCount: numMipLevels(...size3),
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      yield queueEffect(
        (q) =>
          q.copyExternalImageToTexture(
            { source: texture3.value },
            { texture: texture3R },
            { width: size3[0], height: size3[1] }
          ),
        [texture3]
      );
      yield renderMips(texture3R);

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

        const uniformBufferSize = 16 * 4;
        const uniformBuffer = yield createBuffer({
          label: "uniforms for quad",
          size: uniformBufferSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const uniformValues = new Float32Array(uniformBufferSize / 4);
        const matrix = uniformValues.subarray(kMatrixOffset, 16);

        const bindGroups: GPUBindGroup[] = [];
        for (const texture of [texture1R, texture2R, texture3R]) {
          const unkey: () => void = yield key(texture.instanceId);
          const value: GPUBindGroup = yield createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: sampler },
              { binding: 1, resource: texture.createView() },
              { binding: 2, resource: { buffer: uniformBuffer } },
            ],
          });
          bindGroups.push(value);
          unkey();
        }

        // Save the data we need to render this object.
        const info = {
          bindGroups,
          matrix,
          uniformValues,
          uniformBuffer,
        };
        objectInfos.push(info);
        unkey();
      }

      yield pushFrame(({ encoder, queue }) => {
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
            const bindGroup = bindGroups[toggleRef.current];

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
            pass.draw(6); // call our vertex shader 6 times
          }
        );
        pass.end();
      }, []);
    },
    [presentationFormat, texture1.type, texture2.type, texture3.type]
  );

  return (
    <ToOverlay>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        onClick={() => {
          toggleRef.current = (toggleRef.current + 1) % 3;
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
