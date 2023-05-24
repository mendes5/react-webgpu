import {
  type FC,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  type PropsWithChildren,
  useRef,
} from "react";
import { useIsClient, useIsMounted } from "usehooks-ts";
import { requestAdapter } from "./calls";
import { useAsyncH } from "~/utils/hooks";
import { match } from "ts-pattern";
import { log } from "./logger";
import { ToOverlay } from "~/utils/overlay";
import { type H, shortId } from "~/utils/other";
import { type FrameBag, GPURendererContext } from "./use-gpu";

const GPUDeviceContext = createContext<H<GPUDevice> | null>(null);

export const useGPUDevice = (): H<GPUDevice> | null => {
  const device = useContext(GPUDeviceContext);

  if (typeof window === "undefined") {
    return null;
  }

  return device;
};

type Props = {
  fallback?: ReactNode | undefined;
  loading?: ReactNode | undefined;
  render?: boolean;
};

export const WebGPUDevice: FC<PropsWithChildren<Props>> = ({
  children,
  fallback,
  loading,
  render = true,
}) => {
  const isMounted = useIsMounted();

  const [asyncDeviceState, forceRecreate] = useAsyncH<GPUDevice>(
    async (dispose, hash) => {
      const device = await requestAdapter();

      log(`Device id ${shortId(hash)} created`);

      dispose(() => {
        log(`Device id ${shortId(hash)} disposed`);
        device.destroy();
      });

      return device;
    },
    []
  );

  useEffect(() => {
    if (asyncDeviceState.type === "success") {
      const device = asyncDeviceState.value;

      device.lost
        .then((info) => {
          if (isMounted()) {
            if (info.reason !== "destroyed") {
              forceRecreate();
              console.error(`WebGPU device was lost: ${info.message}`);
            }
          }
        })
        .catch(console.error);
    }
  }, [asyncDeviceState, isMounted, forceRecreate]);

  const isClient = useIsClient();

  const frameRef = useRef<Map<string, (bag: FrameBag) => void>>();

  const animationFrameRef = useRef(-1);

  if (!frameRef.current) {
    frameRef.current = new Map();
  }

  useEffect(() => {
    if (asyncDeviceState.type !== "success") return;

    const device = asyncDeviceState.value;

    if (render) {
      const renderCb = (time: number) => {
        const encoder = device.createCommandEncoder({
          label: "Main render loop encoder",
        });

        [...frameRef.current!.values()].forEach((fn) => {
          fn({ time, encoder });
        });

        const commandBuffer = encoder.finish();

        device.queue.submit([commandBuffer]);

        animationFrameRef.current = requestAnimationFrame(renderCb);
      };

      animationFrameRef.current = requestAnimationFrame(renderCb);

      return () => {
        cancelAnimationFrame(animationFrameRef.current);
      };
    }
  }, [render, asyncDeviceState]);

  if (!isClient) {
    return null;
  }

  return (
    <>
      {match(asyncDeviceState)
        .with({ type: "pending" }, () => (
          <GPUDeviceContext.Provider value={null}>
            <GPURendererContext.Provider value={frameRef.current!}>
              {children}
            </GPURendererContext.Provider>
            {loading}
          </GPUDeviceContext.Provider>
        ))
        .with({ type: "error" }, () => (
          <GPUDeviceContext.Provider value={null}>
            <GPURendererContext.Provider value={frameRef.current!}>
              {children}
            </GPURendererContext.Provider>
            {fallback}
          </GPUDeviceContext.Provider>
        ))
        .with({ type: "success" }, ({ value }) => (
          <GPUDeviceContext.Provider value={value}>
            <GPURendererContext.Provider value={frameRef.current!}>
              {children}
            </GPURendererContext.Provider>
          </GPUDeviceContext.Provider>
        ))
        .exhaustive()}
      <ToOverlay key="2">
        <button
          className="rounded bg-slate-900 px-4 py-2 font-bold text-white"
          onClick={forceRecreate}
        >
          ReCreate device
        </button>
      </ToOverlay>
    </>
  );
};
