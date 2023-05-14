import { type FC, type PropsWithChildren } from "react";
import { WebGPUCanvas } from "~/webgpu/canvas";
import { Inspector } from "~/webgpu/debug";
import { WebGPUDevice } from "~/webgpu/gpu-device";
import { RenderController } from "~/webgpu/per-frame";
import { Overlay } from "./overlay";

type Props = {
  canvas?: boolean;
  fullscreen?: boolean;
  width?: number;
  height?: number;
  downscale?: number;
};

export const WebGPUApp: FC<PropsWithChildren<Props>> = ({
  children,
  canvas = true,
  fullscreen,
  width,
  height,
  downscale,
}) => {
  return (
    <Inspector name="root">
      <RenderController enabled>
        <WebGPUDevice fallback={<h1>Failed to create GPUDevice</h1>}>
          {canvas ? (
            <WebGPUCanvas
              downscale={downscale}
              fullscreen={fullscreen}
              fallback={<h1>Failed to create Canvas</h1>}
              width={width}
              height={height}
            >
              {children}
            </WebGPUCanvas>
          ) : (
            children
          )}
        </WebGPUDevice>
      </RenderController>
      <Overlay />
    </Inspector>
  );
};
