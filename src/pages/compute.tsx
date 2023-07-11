import { type NextPage } from "next";
import Head from "next/head";

import { useMemo, type FC, useState } from "react";
import { WebGPUApp } from "~/utils/webgpu-app";
import { useAsyncAction } from "~/utils/hooks";
import { ToOverlay } from "~/utils/overlay";
import { useToggle } from "usehooks-ts";
import { useGPUButBetter } from "~/webgpu/use-gpu-but-better";
import {
  type GPUAction,
  action,
  createBindGroup,
  createBindGroupLayout,
  createBuffer,
  createComputePipeline,
  createPipelineLayout,
  createShaderModule,
  queueEffect,
} from "~/webgpu/web-gpu-plugin";

const Example: FC = () => {
  const input = useMemo(() => new Float32Array([1, 3, 5, 5, 9, 7, 4, 5]), []);

  const [label, toggleLabel] = useToggle();

  const { double } =
    useGPUButBetter(
      function* () {
        const shader: GPUShaderModule = yield createShaderModule({
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

        const bindGroupLayout0: GPUBindGroupLayout =
          yield createBindGroupLayout({
            entries: [
              {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: "storage" },
              },
            ],
          });

        const pipelineLayout: GPUPipelineLayout = yield createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout0],
        });

        const pipeline: GPUComputePipeline = yield createComputePipeline({
          label: "Main compute pipeline",
          layout: pipelineLayout,
          compute: {
            module: shader,
            entryPoint: "computeMain",
          },
        });

        // TODO: (BUG) this is not destroying the old buffer
        // and possibly all local resources are not
        // being replaced in fiber position when they
        // are replaced
        const workBuffer: GPUBuffer = yield createBuffer({
          label: `work ${String(label)} buffer`,
          size: input.byteLength,
          usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST,
        });

        yield queueEffect(
          (q) => q.writeBuffer(workBuffer, 0, input),
          [workBuffer]
        );

        const resultBuffer: GPUBuffer = yield createBuffer({
          label: `result ${String(label)} buffer`,
          size: input.byteLength,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const bindGroup: GPUBindGroup = yield createBindGroup({
          label: "bindGroup for work buffer",
          layout: bindGroupLayout0,
          entries: [{ binding: 0, resource: { buffer: workBuffer } }],
        });

        type DoublingResult = {
          input: Float32Array;
          result: Float32Array;
          elapsed: number;
        };

        const double: GPUAction<DoublingResult> = yield action(
          async ({ encoder, renderToken, time: start }) => {
            const pass = encoder.beginComputePass({
              label: "compute pass",
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(input.length);
            pass.end();
            encoder.copyBufferToBuffer(
              workBuffer,
              0,
              resultBuffer,
              0,
              resultBuffer.size
            );

            const end = await renderToken;
            await resultBuffer.mapAsync(GPUMapMode.READ);
            const result = new Float32Array(
              // eslint-disable-next-line
              // @ts-ignore
              resultBuffer.getMappedRange().slice()
            );
            resultBuffer.unmap();

            return { input, result, elapsed: end - start };
          }
        );

        return { double };
      },
      [label]
    ) ?? {};

  const { execute, locked } = useAsyncAction(
    { double },
    async ({ double }) => double().catch(console.error),
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
