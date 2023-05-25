import { type NextPage } from "next";
import Head from "next/head";

import { type FC, useRef } from "react";
import {
  usePresentationFormat,
  useWebGPUCanvas,
  useWebGPUContext,
} from "~/webgpu/canvas";
import { WebGPUApp } from "~/utils/webgpu-app";
import { ToOverlay } from "~/utils/overlay";
import { rand, range } from "~/utils/other";
import { useGPU } from "~/webgpu/use-gpu";

export function createCircleVerticesSeparate({
  radius = 1,
  numSubdivisions = 24,
  innerRadius = 0,
  startAngle = 0,
  endAngle = Math.PI * 2,
} = {}) {
  const numVertices = numSubdivisions * 3 * 2;
  const positionData = new Float32Array(numVertices * 2);
  const colorData = new Float32Array(numVertices * 3);

  let posOffset = 0;
  let colorOffset = 0;
  const addVertex = (x: number, y: number, r: number, g: number, b: number) => {
    positionData[posOffset++] = x;
    positionData[posOffset++] = y;
    colorData[colorOffset++] = r;
    colorData[colorOffset++] = g;
    colorData[colorOffset++] = b;
  };

  const innerColor = [0.1, 0.1, 0.1] as const;
  const outerColor = [1, 1, 1] as const;

  // 2 vertices per subdivision
  //
  // 0--1 4
  // | / /|
  // |/ / |
  // 2 3--5
  for (const i of range(numSubdivisions)) {
    const angle1 =
      startAngle + ((i + 0) * (endAngle - startAngle)) / numSubdivisions;
    const angle2 =
      startAngle + ((i + 1) * (endAngle - startAngle)) / numSubdivisions;

    const c1 = Math.cos(angle1);
    const s1 = Math.sin(angle1);
    const c2 = Math.cos(angle2);
    const s2 = Math.sin(angle2);

    // first triangle
    addVertex(c1 * radius, s1 * radius, ...outerColor);
    addVertex(c2 * radius, s2 * radius, ...outerColor);
    addVertex(c1 * innerRadius, s1 * innerRadius, ...innerColor);

    // second triangle
    addVertex(c1 * innerRadius, s1 * innerRadius, ...innerColor);
    addVertex(c2 * radius, s2 * radius, ...outerColor);
    addVertex(c2 * innerRadius, s2 * innerRadius, ...innerColor);
  }

  return {
    positionData,
    colorData,
    numVertices,
  };
}

const Example: FC = () => {
  const canvas = useWebGPUCanvas();
  const context = useWebGPUContext();

  const kScaleOffset = 0;

  const kNumObjects = 100;
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

  const presentationFormat = usePresentationFormat();

  const objectCountRef = useRef(kNumObjects);

  const randomize = useGPU(
    async ({ action, frame, gpu, device }) => {
      const shader = gpu.createShaderModule({
        label: "Separate vertex buffers",
        code: /* wgsl */ `
      struct OurStruct {
        color: vec4f,
        offset: vec2f,
      };

      struct OtherStruct {
        scale: vec2f,
      };

      struct VSOutput {
        @builtin(position) position: vec4f,
        @location(0) color: vec4f,
      }

      @group(0) @binding(0) var<storage, read> ourStructs: array<OurStruct>;
      @group(0) @binding(1) var<storage, read> otherStructs: array<OtherStruct>;

      @vertex fn vsMain(
        @location(0) position: vec2f,
        @location(1) color: vec3f,
        @builtin(instance_index) instanceIndex: u32
      ) ->  VSOutput  {
        let otherStruct = otherStructs[instanceIndex];
        let ourStruct = ourStructs[instanceIndex];

        var vsOut: VSOutput;
        vsOut.position = vec4f(
          position * otherStruct.scale + ourStruct.offset, 0.0, 1.0);
        vsOut.color = ourStruct.color * vec4f(color, 1);

        return vsOut;
      }
    
      @fragment fn fsMain(vsOut: VSOutput) -> @location(0) vec4f {
        return vsOut.color;
      }
    `,
      });

      const buffers = [
        {
          arrayStride: 2 * 4, // 2 floats, 4 bytes each
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" }, // position
          ] as const,
        },
        {
          arrayStride: 3 * 4, // 3 floats, 4 bytes each
          attributes: [
            { shaderLocation: 1, offset: 0, format: "float32x3" }, // color
          ] as const,
        },
      ];

      const pipeline = await gpu.createRenderPipelineAsync({
        label: "Vertex buffer separate example render pipeline",
        layout: "auto",
        vertex: {
          entryPoint: "vsMain",
          module: shader,
          buffers,
        },
        fragment: {
          entryPoint: "fsMain",
          module: shader,
          targets: [{ format: presentationFormat }],
        },
      });

      const objectInfos = [] as { scale: number }[];

      // create 2 storage buffers
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

      const staticStorageValues = new Float32Array(staticStorageBufferSize / 4);

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

      const storageValues = new Float32Array(changingStorageBufferSize / 4);

      // Vertex buffer setup

      const { numVertices, positionData, colorData } =
        createCircleVerticesSeparate({
          radius: 0.3,
          innerRadius: 0.7,
          numSubdivisions: 360,
        });

      const positionBuffer = gpu.createBuffer({
        label: "position buffer",
        size: positionData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(positionBuffer, 0, positionData);

      const colorBuffer = gpu.createBuffer({
        label: "color buffer",
        size: colorData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(colorBuffer, 0, colorData);

      const bindGroup = device.createBindGroup({
        label: "bind group for objects",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: staticStorageBuffer } },
          { binding: 1, resource: { buffer: changingStorageBuffer } },
        ],
      });

      const randomize = action(async () => {
        for (const i of range(kNumObjects)) {
          const staticOffset = i * (staticUnitSize / 4);

          staticStorageValues.set(
            [rand(), rand(), rand(), 1],
            staticOffset + kColorOffset
          );
          staticStorageValues.set(
            [rand(-0.9, 0.9), rand(-0.9, 0.9)],
            staticOffset + kOffsetOffset
          );
          device.queue.writeBuffer(staticStorageBuffer, 0, staticStorageValues);
        }
      });

      frame.main!(({ encoder }) => {
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
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, colorBuffer);

        const aspect = canvas.width / canvas.height;

        objectInfos.forEach(({ scale }, ndx) => {
          const offset = ndx * (changingUnitSize / 4);
          storageValues.set([scale / aspect, scale], offset + kScaleOffset);
        });
        device.queue.writeBuffer(changingStorageBuffer, 0, storageValues);

        pass.setBindGroup(0, bindGroup);
        pass.draw(numVertices, objectCountRef.current);
        pass.end();
      });
      return randomize;
    },
    [presentationFormat]
  );

  const spanRef = useRef<HTMLSpanElement>(null);

  return (
    <ToOverlay>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        disabled={!randomize}
        onClick={randomize}
      >
        Randomize
      </button>
      <label className="font-bold text-white">
        Number of instances:{" "}
        <input
          type="range"
          min={0}
          defaultValue={kNumObjects}
          max={kNumObjects}
          onInput={(event) => {
            objectCountRef.current = parseInt(event.currentTarget.value, 10);

            if (spanRef.current) {
              spanRef.current.innerText = String(objectCountRef.current);
            }
          }}
        />
        <span ref={spanRef}>{kNumObjects}</span>
      </label>
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
