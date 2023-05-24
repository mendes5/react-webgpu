import {
  type FC,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  type PropsWithChildren,
  useRef,
  useCallback,
} from "react";
import { useIsClient, useIsMounted } from "usehooks-ts";
import { requestAdapter } from "./calls";
import { useAsyncH } from "~/utils/hooks";
import { match } from "ts-pattern";
import { log } from "./logger";
import { ToOverlay } from "~/utils/overlay";
import { type H, shortId } from "~/utils/other";
import {
  GPURendererContext,
  type ActionBag,
  GPUActionContext,
  type FrameCallback,
} from "./use-gpu";

const ReRenderContext = createContext((): void => undefined);

const GPUDeviceContext = createContext<H<GPUDevice> | null>(null);

export const useForceReRender = () => useContext(ReRenderContext);

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

  const frameRef = useRef<Map<string, FrameCallback>>();
  const actionRef = useRef<Set<(bag: ActionBag) => Promise<unknown>>>();

  const animationFrameRef = useRef(-1);

  if (!frameRef.current) {
    frameRef.current = new Map();
  }
  if (!actionRef.current) {
    actionRef.current = new Set();
  }

  const forceReRender = useCallback(() => {
    const frames = [...frameRef.current!.values()];

    for (const frame of frames) {
      frame.enabled = true;
    }
  }, []);

  useEffect(() => {
    if (asyncDeviceState.type !== "success") return;

    const device = asyncDeviceState.value;

    if (render) {
      const renderCb = (time: number) => {
        const actions = [...actionRef.current!.values()];
        const frames = [...frameRef.current!.values()];

        if (actions.length || frames.filter((x) => x.enabled).length) {
          const encoder = device.createCommandEncoder({
            label: "Main render loop encoder",
          });

          let finishRender = (_: number | PromiseLike<number>): void =>
            undefined;

          const renderToken = new Promise<number>(
            (res) => (finishRender = res)
          );

          for (const action of actions) {
            action({ time, encoder, renderToken }).catch(console.error);
            actionRef.current!.delete(action);
          }

          for (const frame of frames) {
            if (frame.enabled) {
              frame.callback({ time, encoder });
            }
            if (frame.kind === "once") {
              frame.enabled = false;
            }
          }

          const commandBuffer = encoder.finish();

          device.queue.submit([commandBuffer]);

          finishRender(performance.now());
        }

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
              <GPUActionContext.Provider value={actionRef.current!}>
                <ReRenderContext.Provider value={forceReRender}>
                  {children}
                </ReRenderContext.Provider>
              </GPUActionContext.Provider>
            </GPURendererContext.Provider>
            {loading}
          </GPUDeviceContext.Provider>
        ))
        .with({ type: "error" }, () => (
          <GPUDeviceContext.Provider value={null}>
            <GPURendererContext.Provider value={frameRef.current!}>
              <GPUActionContext.Provider value={actionRef.current!}>
                <ReRenderContext.Provider value={forceReRender}>
                  {children}
                </ReRenderContext.Provider>
              </GPUActionContext.Provider>
            </GPURendererContext.Provider>
            {fallback}
          </GPUDeviceContext.Provider>
        ))
        .with({ type: "success" }, ({ value }) => (
          <GPUDeviceContext.Provider value={value}>
            <GPURendererContext.Provider value={frameRef.current!}>
              <GPUActionContext.Provider value={actionRef.current!}>
                <ReRenderContext.Provider value={forceReRender}>
                  {children}
                </ReRenderContext.Provider>
              </GPUActionContext.Provider>
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
