import { type NextPage } from "next";
import Head from "next/head";

import { useMemo, type FC, useState } from "react";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { computePass, immediateRenderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/utils/webgpu-app";
import { useAsyncAction } from "~/utils/hooks";
import { ToOverlay } from "~/utils/overlay";
import { useToggle } from "usehooks-ts";
import { useGPU } from "~/webgpu/use-gpu";

const Example: FC = () => {
  const input = useMemo(() => new Float32Array([1, 3, 5, 5, 9, 7, 4, 5]), []);

  const [label, toggleLabel] = useToggle();

  const device = useGPUDevice();

  const { bindGroup, workBuffer, resultBuffer, pipeline } = useGPU(
    { device },
    (gpu, { device }) => {
      const shader = gpu.createShaderModule({
        code: /* wgsl */ `
        @group(0) @binding(0) var<storage, read_write> data: array<f32>;
        
        @compute @workgroup_size(1) fn computeMain(
          @builtin(global_invocation_id) id: vec3<u32>
        ) {
          let i = id.x;
          data[i] = data[i] * 2.0;
        }
      `,
        label: "doubling compute module",
      });

      const pipeline = gpu.createComputePipeline({
        label: "Main compute pipeline",
        layout: "auto",
        compute: {
          module: shader,
          entryPoint: "computeMain",
        },
      });

      const workBuffer = gpu.createBuffer({
        label: "work buffer",
        size: input.byteLength,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      });

      device.queue.writeBuffer(workBuffer, 0, input);

      const resultBuffer = gpu.createBuffer({
        label: `result ${String(label)} buffer`,
        size: input.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });

      const bindGroup = device.createBindGroup({
        label: "bindGroup for work buffer",
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: workBuffer } }],
      });

      return { bindGroup, workBuffer, resultBuffer, pipeline };
    },
    [label]
  );

  const { execute, locked } = useAsyncAction(
    {
      device,
      pipeline,
      bindGroup,
      workBuffer,
      resultBuffer,
    },
    async ({ device, pipeline, bindGroup, workBuffer, resultBuffer }) => {
      const computeDescriptor: GPUComputePassDescriptor = {
        label: "our basic canvas renderPass",
      };

      const start = performance.now();

      immediateRenderPass(device, "doubling encoder", (encoder) => {
        computePass(encoder, computeDescriptor, (pass) => {
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(input.length);
        });

        encoder.copyBufferToBuffer(
          workBuffer,
          0,
          resultBuffer,
          0,
          resultBuffer.size
        );
      });

      await resultBuffer.mapAsync(GPUMapMode.READ);
      // eslint-disable-next-line
      // @ts-ignore
      const result = new Float32Array(resultBuffer.getMappedRange().slice());
      resultBuffer.unmap();

      const end = performance.now();

      return { input, result, elapsed: end - start };
    },
    []
  );

  const [result, setResult] = useState("");

  return (
    <>
      <ToOverlay key="1">
        <button
          className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
          disabled={locked}
          onClick={() => {
            execute()
              .then((maybe) => {
                if (!maybe) return;
                const { input, result, elapsed } = maybe;
                const out = {
                  input: [...input],
                  output: [...result],
                  elapsed,
                };

                setResult(JSON.stringify(out, null, "  "));
              })
              .catch(console.error);
          }}
        >
          Double by 2 using compute shader
        </button>
        <button
          className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
          disabled={locked}
          onClick={toggleLabel}
        >
          Toggle Label {label ? "ON" : "OFF"}
        </button>
      </ToOverlay>
      <textarea
        className="h-2/3 min-h-[500px] w-full font-mono"
        readOnly
        disabled
        value={result}
      />
    </>
  );
};

const Home: NextPage = () => {
  return (
    <>
      <Head>
        <title>WebGPU Compute</title>
        <link rel="icon" href="/favicon.svg" />
      </Head>
      <WebGPUApp canvas={false}>
        <Example />
      </WebGPUApp>
    </>
  );
};

export default Home;
