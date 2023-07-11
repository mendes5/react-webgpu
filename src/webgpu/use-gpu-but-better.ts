import { useContext, useEffect, useRef } from "react";
import {
  type SyncClosureFiberGenerator,
  createSyncClosureFiberRoot,
} from "~/trace";
import { useGPUDevice } from "./gpu-device";
import { GPURendererContext } from "./use-gpu";
import { webGPUPluginCreator } from "./web-gpu-plugin";

export function useGPUButBetter(
  handler: () => Generator<any, any, any>,
  deps: unknown[]
) {
  const instanceRef = useRef<SyncClosureFiberGenerator>();
  const rendererContext = useContext(GPURendererContext);

  const device = useGPUDevice();

  useEffect(() => {
    if (device) {
      instanceRef.current = createSyncClosureFiberRoot([
        webGPUPluginCreator(device, rendererContext),
      ]);
    }
  }, [device, rendererContext]);

  useEffect(() => {
    // eslint-disable-next-line
    instanceRef.current?.(handler());
  }, [device, ...deps]);

  useEffect(
    () => () => {
      instanceRef.current?.dispose();
    },
    [device]
  );
}
