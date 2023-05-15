import { type NextPage } from "next";
import Head from "next/head";

import { type FC, useRef, useMemo } from "react";
import { useWebGPUCanvas, useWebGPUContext } from "~/webgpu/canvas";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useFrame } from "~/webgpu/per-frame";
import { usePipeline, useShaderModule } from "~/webgpu/shader";
import { immediateRenderPass, renderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";
import { ToOverlay } from "~/utils/overlay";
import { rand, range } from "~/utils/other";
import { useAction, useMemoBag, useV } from "~/utils/hooks";

export function createCircleVerticesIndexed({
  radius = 1,
  numSubdivisions = 24,
  innerRadius = 0,
  startAngle = 0,
  endAngle = Math.PI * 2,
} = {}) {
  // 2 triangles per subdivision, 3 verts per tri, 2 values (xy) each.
  const numVertices = numSubdivisions * 3 * 2;
  const vertexData = new Float32Array(numVertices * (2 + 3));

  let offset = 0;
  const addVertex = (x: number, y: number, r: number, g: number, b: number) => {
    vertexData[offset++] = x;
    vertexData[offset++] = y;
    vertexData[offset++] = r;
    vertexData[offset++] = g;
    vertexData[offset++] = b;
  };

  const innerColor = [0.1, 0.1, 0.1] as const;
  const outerColor = [1, 1, 1] as const;

  // 2 vertices per subdivision
  //
  // 0--1 4
  // | / /|
  // |/ / |
  // 2 3--5
  // 2 vertices per subdivision
  //
  // 0  2  4  6  8 ...
  //
  // 1  3  5  7  9 ...
  for (let i = 0; i <= numSubdivisions; ++i) {
    const angle =
      startAngle + ((i + 0) * (endAngle - startAngle)) / numSubdivisions;

    const c1 = Math.cos(angle);
    const s1 = Math.sin(angle);

    addVertex(c1 * radius, s1 * radius, ...outerColor);
    addVertex(c1 * innerRadius, s1 * innerRadius, ...innerColor);
  }

  const indexData = new Uint32Array(numSubdivisions * 6);
  let ndx = 0;

  // 0---2---4---...
  // | //| //|
  // |// |// |//
  // 1---3-- 5---...
  for (let i = 0; i < numSubdivisions; ++i) {
    const ndxOffset = i * 2;

    // first triangle
    indexData[ndx++] = ndxOffset;
    indexData[ndx++] = ndxOffset + 1;
    indexData[ndx++] = ndxOffset + 2;

    // second triangle
    indexData[ndx++] = ndxOffset + 2;
    indexData[ndx++] = ndxOffset + 1;
    indexData[ndx++] = ndxOffset + 3;
  }

  return {
    vertexData,
    indexData,
    numVertices,
  };
}

/**
 * Differences betwen uniform buffers and storage buffers
 * - Uniform buffers can be faster for their typical use-case
 * - Storage buffers are large and W I D E
 *   - The minimum maximum size of a uniform buffer is 64k
 *   - The minimum maximum size of a storage buffer is 128meg!
 * - Storage buffers can be read/write, Uniform buffers are read-only
 */

/**
 *
 */
const Example: FC = () => {
  const shader = useShaderModule(
    /* wgsl */ `
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

        struct Vertex {
          // This zero links with the first element of the buffers
          // array on the useVersion below
          @location(0) position: vec2f,
          @location(1) color: vec3f,
        };


        @vertex fn vsMain(
          vert: Vertex,
          @builtin(instance_index) instanceIndex: u32
        ) ->  VSOutput  {
          let otherStruct = otherStructs[instanceIndex];
          let ourStruct = ourStructs[instanceIndex];

          var vsOut: VSOutput;
          vsOut.position = vec4f(
            vert.position * otherStruct.scale + ourStruct.offset, 0.0, 1.0);
          vsOut.color = ourStruct.color * vec4f(vert.color, 1);

          return vsOut;
        }
      
        @fragment fn fsMain(vsOut: VSOutput) -> @location(0) vec4f {
          return vsOut.color;
        }
      `,
    "rgb  triangle shader"
  );

  const [buffers] = useV(
    () => [
      {
        arrayStride: (2 + 3) * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 1, offset: 8, format: "float32x3" },
        ] as const,
      },
    ],
    []
  );

  const pipeline = usePipeline(shader, "Main render pipeline", buffers);

  const device = useGPUDevice();
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

  const staticStorageValues = useMemo(
    () => new Float32Array(staticStorageBufferSize / 4),
    [staticStorageBufferSize]
  );
  const initRef = useRef(false);

  const objectInfos = useRef([] as { scale: number }[]);

  const {
    storageValues,
    indexBuffer,
    changingStorageBuffer,
    bindGroup,

    numVertices,
    staticStorageBuffer,
    vertexBuffer,
  } =
    useMemoBag(
      { device, pipeline },
      ({ device, pipeline }) => {
        // create 2 storage buffers
        const staticStorageBuffer = device.createBuffer({
          label: "static storage for objects",
          size: staticStorageBufferSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const changingStorageBuffer = device.createBuffer({
          label: "changing storage for objects",
          size: changingStorageBufferSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        if (!initRef.current) {
          initRef.current = true;

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

            objectInfos.current.push({
              scale: rand(0.2, 0.5),
            });
          }
        }

        device.queue.writeBuffer(staticStorageBuffer, 0, staticStorageValues);

        const storageValues = new Float32Array(changingStorageBufferSize / 4);

        // Vertex buffer setup

        const { vertexData, indexData, numVertices } =
          createCircleVerticesIndexed({
            radius: 1,
            innerRadius: 0.5,
            numSubdivisions: 360,
          });

        const vertexBuffer = device.createBuffer({
          label: "storage buffer vertices",
          size: vertexData.byteLength,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        const indexBuffer = device.createBuffer({
          label: "index buffer",
          size: indexData.byteLength,
          usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(indexBuffer, 0, indexData);

        const bindGroup = device.createBindGroup({
          label: "bind group for objects",
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: staticStorageBuffer } },
            { binding: 1, resource: { buffer: changingStorageBuffer } },
          ],
        });

        return {
          indexBuffer,
          vertexBuffer,
          numVertices,
          staticStorageValues,

          storageValues,
          changingStorageBuffer,
          staticStorageBuffer,
          bindGroup,
        };
      },
      [
        device,
        pipeline,
        changingStorageBufferSize,
        staticStorageBufferSize,
        staticUnitSize,
      ]
    ) ?? {};

  const { locked, execute } = useAction(
    { device, staticStorageValues, staticStorageBuffer },
    ({ device, staticStorageValues, staticStorageBuffer }) => {
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
    },
    []
  );

  const canvas = useWebGPUCanvas();

  const objectCountRef = useRef(kNumObjects);

  useFrame(() => {
    if (
      !device ||
      !pipeline ||
      !vertexBuffer ||
      !indexBuffer ||
      !objectInfos ||
      !storageValues ||
      !changingStorageBuffer ||
      !bindGroup ||
      !numVertices
    )
      return;
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
        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setIndexBuffer(indexBuffer, "uint32");

        const aspect = canvas.width / canvas.height;

        objectInfos.current.forEach(({ scale }, ndx) => {
          const offset = ndx * (changingUnitSize / 4);
          storageValues.set([scale / aspect, scale], offset + kScaleOffset);
        });
        device.queue.writeBuffer(changingStorageBuffer, 0, storageValues);

        pass.setBindGroup(0, bindGroup);
        pass.drawIndexed(numVertices, objectCountRef.current);
      });
    });
  });

  const spanRef = useRef<HTMLSpanElement>(null);

  return (
    <ToOverlay>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        disabled={locked}
        onClick={execute}
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
