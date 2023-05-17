import { useCallback, useEffect, useMemo, useRef } from "react";

export const useCanvas = <T>(
  render: (ctx: CanvasRenderingContext2D, arg: T) => void,
  {
    size,
    width,
    height,
  }: { size?: number; width?: number; height?: number } = {}
) => {
  const callback = useRef(render);
  callback.current = render;

  const ctx = useMemo(() => {
    const ctx = document.createElement("canvas").getContext("2d");

    if (!ctx) throw new Error("Error");

    ctx.canvas.width = size ?? width ?? 100;
    ctx.canvas.height = size ?? height ?? 100;

    return ctx;
  }, []);

  useEffect(() => {
    ctx.canvas.width = size ?? width ?? 100;
    ctx.canvas.height = size ?? height ?? 100;
  }, [ctx, size, width, height]);

  const update = useCallback(
    (arg: T) => {
      callback.current(ctx, arg);
    },
    [ctx]
  );

  return [ctx, update] as const;
};
