import { type NextPage } from "next";
import Head from "next/head";

import { type FC, useRef } from "react";
import { useWebGPUCanvas, useWebGPUContext } from "~/webgpu/canvas";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useFrame } from "~/webgpu/per-frame";
import {
  useAsyncExternalTexture,
  usePipeline,
  useShaderModule,
} from "~/webgpu/resources";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";
import { ToOverlay } from "~/utils/overlay";
import { type Vec3, mat4 } from "~/utils/math";
import { useMemoBag } from "~/utils/hooks";

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

  const texture1 = useAsyncExternalTexture("/resources/f-texture.png", {
    mips: true,
    flipY: false,
  });

  const texture2 = useAsyncExternalTexture("/resources/coins.jpg", {
    mips: true,
  });

  const texture3 = useAsyncExternalTexture(
    "/resources/Granite_paving_tileable_512x512.jpeg",
    {
      mips: true,
    }
  );

  const loaded = texture1 && texture2 && texture3;

  const { objectInfos } =
    useMemoBag(
      { device, pipeline },
      ({ device, pipeline }) => {
        const objectInfos = [];

        if (loaded) {
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

            const bindGroups = [texture1, texture2, texture3].map((texture) =>
              device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                  { binding: 0, resource: sampler },
                  { binding: 1, resource: texture.createView() },
                  { binding: 2, resource: { buffer: uniformBuffer } },
                ],
              })
            );

            // Save the data we need to render this object.
            objectInfos.push({
              bindGroups,
              matrix,
              uniformValues,
              uniformBuffer,
            });
          }
        }

        return { objectInfos };
      },
      [device, texture1, texture2, texture3, loaded, pipeline]
    ) ?? {};

  const canvas = useWebGPUCanvas();

  const toggleRef = useRef(0);

  useFrame(() => {
    if (!device || !pipeline || !objectInfos) return null;

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
          ({ bindGroups, matrix, uniformBuffer, uniformValues }, i) => {
            const bindGroup = bindGroups[toggleRef.current]!;

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

  return (
    <ToOverlay>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        disabled={!loaded}
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
