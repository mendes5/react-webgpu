import { type NextPage } from "next";
import Head from "next/head";

import { useRef, type FC } from "react";
import { createCircleVerticesNonShadow } from "~/utils/geometry";

import { rand } from "~/utils/other";

import { WebGPUApp } from "~/utils/webgpu-app";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import {
  usePresentationFormat,
  useWebGPUCanvas,
  useWebGPUContext,
} from "~/webgpu/canvas";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useFrame } from "~/webgpu/per-frame";
import { useGPU } from "~/webgpu/use-gpu";

const Example: FC = () => {
  const device = useGPUDevice();
  const canvas = useWebGPUCanvas();
  const context = useWebGPUContext();

  const frameRef = useRef<(time: number) => void>();
  useFrame((time) => {
    frameRef.current?.(time);
  });
  const presentationFormat = usePresentationFormat();

  useGPU(
    { device },
    (gpu, { device }) => {
      const shader = gpu.createShaderModule({
        label: "Storage buffers shader module",
        code: /*wgsl*/ `
        struct OurStruct {
          color: vec4f,
          offset: vec2f,
        };
    
        struct OtherStruct {
          scale: vec2f,
        };
    
        struct Vertex {
          position: vec2f,
        };
    
        struct VSOutput {
          @builtin(position) position: vec4f,
          @location(0) color: vec4f,
        };
    
        @group(0) @binding(0) var<storage, read> ourStructs: array<OurStruct>;
        @group(0) @binding(1) var<storage, read> otherStructs: array<OtherStruct>;
        @group(0) @binding(2) var<storage, read> pos: array<Vertex>;
    
        @vertex fn vsMain(
          @builtin(vertex_index) vertexIndex : u32,
          @builtin(instance_index) instanceIndex: u32
        ) -> VSOutput {
          let otherStruct = otherStructs[instanceIndex];
          let ourStruct = ourStructs[instanceIndex];
    
          var vsOut: VSOutput;
          vsOut.position = vec4f(
              pos[vertexIndex].position * otherStruct.scale + ourStruct.offset, 0.0, 1.0);
          vsOut.color = ourStruct.color;
          return vsOut;
        }
    
        @fragment fn fsMain(vsOut: VSOutput) -> @location(0) vec4f {
          return vsOut.color;
        }
      `,
      });

      const pipeline = gpu.createRenderPipeline({
        label: "Storage buffers render pipeline",
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

      const kNumObjects = 100;

      // create 2 storage buffers
      const staticUnitSize =
        4 * 4 + // color is 4 32bit floats (4bytes each)
        2 * 4 + // offset is 2 32bit floats (4bytes each)
        2 * 4; // padding

      const changingUnitSize = 2 * 4; // scale is 2 32bit floats (4bytes each)
      const staticStorageBufferSize = staticUnitSize * kNumObjects;
      const changingStorageBufferSize = changingUnitSize * kNumObjects;

      // offsets to the various uniform values in float32 indices
      const kColorOffset = 0;
      const kOffsetOffset = 4;

      const kScaleOffset = 0;

      const objectInfos = [] as { scale: number }[];
      const staticStorageValues = new Float32Array(staticStorageBufferSize / 4);

      const storageValues = new Float32Array(changingStorageBufferSize / 4);

      const staticStorageBuffer = gpu.createBuffer({
        label: "static storage for objects",
        size: staticStorageBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const changingStorageBuffer = gpu.createBuffer({
        label: "changing storage for objects",
        size: changingStorageBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      for (let i = 0; i < kNumObjects; ++i) {
        const staticOffset = i * (staticUnitSize / 4);

        // These are only set once so set them now
        staticStorageValues.set(
          [rand(), rand(), rand(), 1],
          staticOffset + kColorOffset
        ); // set the color
        staticStorageValues.set(
          [rand(-0.9, 0.9), rand(-0.9, 0.9)],
          staticOffset + kOffsetOffset
        ); // set the offset

        objectInfos.push({
          scale: rand(0.2, 0.5),
        });
      }

      device.queue.writeBuffer(staticStorageBuffer, 0, staticStorageValues);

      const { vertexData, numVertices } = createCircleVerticesNonShadow({
        radius: 0.5,
        innerRadius: 0.25,
      });

      const vertexStorageBuffer = gpu.createBuffer({
        label: "storage buffer vertices",
        size: vertexData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      device.queue.writeBuffer(vertexStorageBuffer, 0, vertexData);

      const bindGroup = device.createBindGroup({
        label: "bind group for objects",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: staticStorageBuffer } },
          { binding: 1, resource: { buffer: changingStorageBuffer } },
          { binding: 2, resource: { buffer: vertexStorageBuffer } },
        ],
      });

      frameRef.current = () => {
        const renderPassDescriptor = {
          label: "our basic canvas renderPass",
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: [0.3, 0.3, 0.3, 1],
              loadOp: "clear",
              storeOp: "store",
            } as const,
          ],
        };

        immediateRenderPass(device, "example", (encoder) => {
          renderPass(encoder, renderPassDescriptor, (pass) => {
            pass.setPipeline(pipeline);

            const aspect = canvas.width / canvas.height;

            // set the scales for each object
            objectInfos.forEach(({ scale }, ndx) => {
              const offset = ndx * (changingUnitSize / 4);
              storageValues.set([scale / aspect, scale], offset + kScaleOffset); // set the scale
            });
            // upload all scales at once
            device.queue.writeBuffer(changingStorageBuffer, 0, storageValues);

            pass.setBindGroup(0, bindGroup);
            pass.draw(numVertices, kNumObjects);
          });
        });
      };
    },
    []
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
