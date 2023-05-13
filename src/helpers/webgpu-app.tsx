import { type FC, type PropsWithChildren } from "react";
import { WebGPUCanvas } from "~/webgpu/canvas";
import { Inspector } from "~/webgpu/debug";
import { WebGPUDevice } from "~/webgpu/gpu-device";
import { RenderController } from "~/webgpu/per-frame";

type Props = {
  canvas?: boolean;
};

export const WebGPUApp: FC<PropsWithChildren<Props>> = ({
  children,
  canvas = true,
}) => {
  return (
    <Inspector name="root">
      <RenderController enabled>
        <WebGPUDevice fallback={<h1>Failed to create GPUDevice</h1>}>
          {canvas ? (
            <WebGPUCanvas
              fallback={<h1>Failed to create Canvas</h1>}
              width={500}
              height={500}
            >
              {children}
            </WebGPUCanvas>
          ) : (
            children
          )}
        </WebGPUDevice>
      </RenderController>
    </Inspector>
  );
};
