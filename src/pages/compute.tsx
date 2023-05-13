import { type NextPage } from "next";
import Head from "next/head";

import { useMemo, type FC, useState } from "react";
import { useGPUDevice } from "~/webgpu/gpu-device";
import { useComputePipeline, useShaderModule } from "~/webgpu/shader";
import { computePass, immediateRenderPass } from "~/webgpu/calls";
import { WebGPUApp } from "~/helpers/webgpu-app";
import { useConsoleHook } from "~/webgpu/console-hook";
import { useMutation } from "@tanstack/react-query";

const Example: FC = () => {
  const entireShaderApparently = useShaderModule(
    /* wgsl */ `
      @group(0) @binding(0) var<storage, read_write> data: array<f32>;
 
      @compute @workgroup_size(1) fn computeMain(
        @builtin(global_invocation_id) id: vec3<u32>
      ) {
        let i = id.x;
        data[i] = data[i] * 2.0;
      }
    `,
    "doubling compute module"
  );

  const pipeline = useComputePipeline(
    entireShaderApparently,
    "Main compute pipeline"
  );

  const device = useGPUDevice();

  const input = useMemo(() => new Float32Array([1, 3, 5]), []);

  const { resultBuffer, bindGroup, workBuffer } = useMemo(() => {
    const workBuffer = device.createBuffer({
      label: "work buffer",
      size: input.byteLength,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(workBuffer, 0, input);

    const resultBuffer = device.createBuffer({
      label: "result buffer",
      size: input.byteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
      label: "bindGroup for work buffer",
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: workBuffer } }],
    });

    return { resultBuffer, bindGroup, workBuffer };
  }, [device, input, pipeline]);

  const doCompute = useConsoleHook("doCompute", async () => {
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
  });

  const doComputeMutation = useMutation(doCompute);

  const [result, setResult] = useState("");

  return (
    <div className="flex w-1/5 flex-col gap-4">
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        disabled={doComputeMutation.isLoading}
        onClick={() => {
          doCompute()
            ?.then(({ input, result, elapsed }) => {
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
      <textarea
        className="h-2/3 min-h-[500px] w-full font-mono"
        readOnly
        disabled
        value={result}
      />
    </div>
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