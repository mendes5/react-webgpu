import {
  type MutableRefObject,
  createContext,
  useRef,
  useContext,
  useState,
  useEffect,
} from "react";
import { FRAME_CALLBACK, useGPUDevice } from "./gpu-device";
import { useMemo } from "react";
import {
  webGPUPluginCreator,
  type ActionBag,
  type FrameCallback,
} from "./web-gpu-plugin";
import {
  type SyncClosureFiberGenerator,
  createSyncClosureFiberRoot,
} from "~/trace";

export const GPURendererContext = createContext<Map<string, FrameCallback>>(
  new Map()
);

export const GPUActionContext = createContext<Set<(bag: ActionBag) => unknown>>(
  new Set()
);

export function useGPU<T>(
  handler: () => Generator<any, T, any>,
  deps: unknown[]
): T {
  const instanceRef = useRef<SyncClosureFiberGenerator<T>>();
  const rendererContext = useContext(GPURendererContext);
  const actionContext = useContext(GPUActionContext);

  const device = useGPUDevice();

  const [result, setResult] = useState<T>();

  useEffect(() => {
    if (device) {
      instanceRef.current = createSyncClosureFiberRoot([
        webGPUPluginCreator(device, rendererContext, actionContext),
      ]);
    }
  }, [device, rendererContext, actionContext]);

  useEffect(() => {
    // eslint-disable-next-line
    setResult(instanceRef.current?.(handler()));
  }, [device, ...deps]);

  useEffect(
    () => () => {
      instanceRef.current?.dispose();
    },
    [device, rendererContext, actionContext]
  );

  return result;
}

export const useRefTrap = <T>(ref?: T): MutableRefObject<T | undefined> => {
  const rendererRefs = useRef<Set<FrameCallback>>();

  if (!rendererRefs.current) {
    rendererRefs.current = new Set();
  }

  return useMemo(() => {
    const fake = { current: ref };
    const value = { current: ref };
    Object.defineProperty(value, "current", {
      set(value) {
        const renderers = rendererRefs.current;

        for (const frame of renderers) {
          if (!frame.valid) {
            renderers.delete(frame);
          } else {
            frame.enabled = true;
          }
        }

        // eslint-disable-next-line
        fake.current = value;
        return fake.current;
      },
      get() {
        const renderers = rendererRefs.current;

        if (FRAME_CALLBACK.current && FRAME_CALLBACK.current.kind === "once") {
          renderers.add(FRAME_CALLBACK.current);
        }

        // eslint-disable-next-line
        return fake.current;
      },
    });
    return value;
  }, []);
};
