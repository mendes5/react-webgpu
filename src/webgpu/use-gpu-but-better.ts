import { useContext, useEffect, useRef, useState } from "react";
import {
  type SyncClosureFiberGenerator,
  createSyncClosureFiberRoot,
} from "~/trace";
import { useGPUDevice } from "./gpu-device";
import { GPURendererContext } from "./use-gpu";
import { webGPUPluginCreator } from "./web-gpu-plugin";

export function useGPUButBetter<T>(
  handler: () => Generator<any, T, any>,
  deps: unknown[]
): T {
  const instanceRef = useRef<SyncClosureFiberGenerator<T>>();
  const rendererContext = useContext(GPURendererContext);

  const device = useGPUDevice();

  const [result, setResult] = useState<T>();

  useEffect(() => {
    if (device) {
      instanceRef.current = createSyncClosureFiberRoot([
        webGPUPluginCreator(device, rendererContext),
      ]);
    }
  }, [device, rendererContext]);

  useEffect(() => {
    // eslint-disable-next-line
    setResult(instanceRef.current?.(handler()));
  }, [device, ...deps]);

  useEffect(
    () => () => {
      instanceRef.current?.dispose();
    },
    [device]
  );

  return result;
}
