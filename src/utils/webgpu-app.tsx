import { type FC, type PropsWithChildren } from "react";
import { WebGPUCanvas } from "~/webgpu/canvas";
import { Inspector } from "~/webgpu/debug";
import { WebGPUDevice } from "~/webgpu/gpu-device";
import { Overlay, ToOverlayEnd } from "./overlay";
import { Menu } from "~/components/menu";

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
      <WebGPUDevice
        loading={<h1>Loading</h1>}
        fallback={<h1>Failed to create GPUDevice</h1>}
      >
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
      <Overlay />
      <ToOverlayEnd>
        <Menu />
      </ToOverlayEnd>
    </Inspector>
  );
};
