import { useContext, useEffect, useRef } from "react";
import { type SyncFiberGenerator, createSyncFiberRoot } from "~/trace";
import { useGPUDevice } from "./gpu-device";
import { GPURendererContext } from "./use-gpu";
import { webGPUPluginCreator } from "./web-gpu-plugin";

export function useGPUButBetter<T extends unknown[]>(
  handler: () => Generator<any, any, any>,
  args: T
) {
  const instanceRef = useRef<SyncFiberGenerator>();
  const rendererContext = useContext(GPURendererContext);

  const device = useGPUDevice();

  // TODO: review deps

  useEffect(() => {
    if (device) {
      instanceRef.current = createSyncFiberRoot(handler, [
        webGPUPluginCreator(device, rendererContext),
      ]);
    }
  }, [device]);

  useEffect(() => {
    instanceRef.current?.();
  }, args);

  useEffect(
    () => () => {
      instanceRef.current?.dispose();
    },
    [device]
  );
}
