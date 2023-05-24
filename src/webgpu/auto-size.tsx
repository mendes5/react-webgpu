import { useEffect, useRef } from "react";
import { useForceReRender, useGPUDevice } from "./gpu-device";

export const useAutoSize = (downscale = 0) => {
  const device = useGPUDevice();

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rerender = useForceReRender();

  useEffect(() => {
    if (device) {
      const observer = new ResizeObserver((entries) => {
        rerender();

        for (const entry of entries) {
          if (!entry.contentBoxSize[0]) continue;

          const canvas = entry.target as HTMLCanvasElement;
          if (downscale) {
            const width = (entry.contentBoxSize[0].inlineSize / downscale) | 0;
            const height = (entry.contentBoxSize[0].blockSize / downscale) | 0;
            canvas.width = Math.min(width, device.limits.maxTextureDimension2D);
            canvas.height = Math.min(
              height,
              device.limits.maxTextureDimension2D
            );
          } else {
            const width = entry.contentBoxSize[0].inlineSize;
            const height = entry.contentBoxSize[0].blockSize;
            canvas.width = Math.min(width, device.limits.maxTextureDimension2D);
            canvas.height = Math.min(
              height,
              device.limits.maxTextureDimension2D
            );
          }
        }
      });

      if (canvasRef.current) {
        observer.observe(canvasRef.current);
      }

      return () => {
        observer.disconnect();
      };
    }
  }, [rerender, device, downscale]);

  return canvasRef;
};
