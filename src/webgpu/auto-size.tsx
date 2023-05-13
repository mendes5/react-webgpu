import { useEffect, useRef } from "react";
import { useGPUDevice } from "./gpu-device";

export const useAutoSize = () => {
  const device = useGPUDevice();

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (!entry.contentBoxSize[0]) continue;

        const canvas = entry.target as HTMLCanvasElement;
        const width = entry.contentBoxSize[0].inlineSize;
        const height = entry.contentBoxSize[0].blockSize;
        canvas.width = Math.min(width, device.limits.maxTextureDimension2D);
        canvas.height = Math.min(height, device.limits.maxTextureDimension2D);
      }
    });

    if (canvasRef.current) {
      observer.observe(canvasRef.current);
    }
  }, [device.limits.maxTextureDimension2D]);

  return canvasRef;
};
