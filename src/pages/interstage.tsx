import { type NextPage } from "next";
import Head from "next/head";

import { useState, type FC } from "react";
import { usePresentationFormat, useWebGPUContext } from "~/webgpu/canvas";
import { WebGPUApp } from "~/utils/webgpu-app";
import { useToggle } from "usehooks-ts";
import { ToOverlay } from "~/utils/overlay";
import { match } from "ts-pattern";
import { useGPU } from "~/webgpu/use-gpu";
import {
  createRenderPipeline,
  createShaderModule,
  pushFrame,
} from "~/webgpu/web-gpu-plugin";

const InterpolationType = {
  /**
   * perspective: Values are interpolated in
   * a perspective correct manner (default)
   */
  perspective: "perspective",
  /**
   * linear: Values are interpolated in a
   * linear, non-perspective correct manner.
   */
  linear: "linear",
  /**
   * flat: Values are not interpolated.
   * Interpolation sampling is not used with
   * flat interpolated
   */
  flat: "flat",
} as const;

const InterpolationSampling = {
  /**
   * Interpolation is performed at the center
   * of the pixel (default)
   */
  center: "center",
  /**
   * Interpolation is performed at a point that
   * lies within all the samples covered by the
   * fragment within the current primitive. This value is the same for all samples in the primitive.
   */
  centroid: "centroid",
  /**
   * Interpolation is performed per sample. The
   * fragment shader is invoked once per sample
   * when this attribute is applied.
   */
  sample: "sample",
} as const;

const Example: FC = () => {
  const [value, toggle] = useToggle();

  const [type, setType] = useState<string>(InterpolationType.perspective);
  const [sampling, setSampling] = useState<string>(
    InterpolationSampling.center
  );

  const formatInterpolation = (type: string, sampling: string) =>
    match(type)
      .with("flat", (type) => type)
      .otherwise(() => `${type}, ${sampling}`);

  const presentationFormat = usePresentationFormat();

  const context = useWebGPUContext();

  useGPU(
    function* () {
      const $interpolate = formatInterpolation(type, sampling);
      const shader: GPUShaderModule = yield createShaderModule({
        label: "rgb  triangle shader",
        code: value
          ? /* wgsl */ `
            struct OurVertexShaderOutput {
              @builtin(position) position: vec4f,
              @location(0) @interpolate(${$interpolate}) color: vec4f,
            };
            
            @vertex fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> OurVertexShaderOutput {
              var pos = array<vec2f, 3>(
                vec2f( 0.0,  0.5),  // top center
                vec2f(-0.5, -0.5),  // bottom left
                vec2f( 0.5, -0.5)   // bottom right
              );
              var color = array<vec4f, 3>(
                vec4f(1, 0, 0, 1), // red
                vec4f(0, 1, 0, 1), // green
                vec4f(0, 0, 1, 1), // blue
              );
              var vsOutput: OurVertexShaderOutput;
                vsOutput.position = vec4f(pos[vertexIndex], 0.0, 1.0);
                vsOutput.color = color[vertexIndex];
                return vsOutput;
            }
    
            @fragment fn fsMain(@location(0) @interpolate(${formatInterpolation(
              type,
              sampling
            )}) color: vec4f) -> @location(0) vec4f {
              return color;
            }
          `
          : /* wgsl */ `
            struct OurVertexShaderOutput {
              @builtin(position) position: vec4f,
            };
            
            @vertex fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> OurVertexShaderOutput {
              var pos = array<vec2f, 3>(
                vec2f( 0.0,  1.5),  // top center
                vec2f(-0.5, -0.5),  // bottom left
                vec2f( 0.5, -0.5)   // bottom right
              );
              var vsOutput: OurVertexShaderOutput;
                vsOutput.position = vec4f(pos[vertexIndex], 0.0, 1.0);
                return vsOutput;
            }
    
            @fragment fn fsMain(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
              let red = vec4f(1, 0, 0, 1);
              let cyan = vec4f(0, 1, 1, 1);
    
              let grid = vec2u(fsInput.position.xy) / 100;
              let checker = (grid.x + grid.y) % 2 == 1;
    
              return select(red, cyan, checker);
            }
      `,
      });

      const pipeline: GPURenderPipeline = yield createRenderPipeline({
        label: "Main render pipeline",
        layout: "auto",
        vertex: {
          module: shader,
          buffers: [],
          entryPoint: "vsMain",
        },
        fragment: {
          module: shader,
          entryPoint: "fsMain",
          targets: [{ format: presentationFormat }],
        },
      });

      yield pushFrame(
        ({ encoder }) => {
          const renderPassDescriptor: GPURenderPassDescriptor = {
            label: "our basic canvas  renderPass",
            colorAttachments: [
              {
                view: context.getCurrentTexture().createView(),
                clearValue: [0.0, 0.0, 0.0, 1],
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          };

          const pass = encoder.beginRenderPass(renderPassDescriptor);
          pass.setPipeline(pipeline);
          pass.draw(3);
          pass.end();
        },
        [pipeline]
      );
    },
    [value, type, presentationFormat, sampling]
  );

  return (
    <ToOverlay>
      <button
        className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
        onClick={toggle}
      >
        Use {value ? "Checkers" : "RGB"}
      </button>
      {value && (
        <>
          <select
            value={type}
            onChange={(event) => setType(event.currentTarget.value)}
            className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
          >
            {Object.entries(InterpolationType).map(([key, value]) => (
              <option key={value} value={value}>
                Interpolation Type: {key}
              </option>
            ))}
          </select>

          {type !== "flat" && (
            <select
              value={sampling}
              onChange={(event) => setSampling(event.currentTarget.value)}
              className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
            >
              {Object.entries(InterpolationSampling).map(([key, value]) => (
                <option key={value} value={value}>
                  Interpolation Sampling: {key}
                </option>
              ))}
            </select>
          )}
        </>
      )}
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
