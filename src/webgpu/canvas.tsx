import {
  type ReactNode,
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { useCombinedRefs } from "~/utils/hooks";
import { useInspector } from "./debug";
import { useGPUDevice } from "./gpu-device";
import { configureContextPresentation, getPresentationFormat } from "./calls";
import { useAutoSize } from "./auto-size";

const WebGPUCanvasContext = createContext<HTMLCanvasElement | null>(null);
const WebGPUContext = createContext<GPUCanvasContext | null>(null);
const PresentationFormatContext = createContext<GPUTextureFormat | null>(null);

export const useWebGPUCanvas = (): HTMLCanvasElement => {
  const canvas = useContext(WebGPUCanvasContext);

  if (!canvas) {
    throw new Error(
      "useWebGPUCanvas can only be used inside a WebGPUCanvas component"
    );
  }

  return canvas;
};

export const usePresentationFormat = (): GPUTextureFormat => {
  const format = useContext(PresentationFormatContext);

  if (!format) {
    throw new Error(
      "usePresentationFormat can only be used inside a WebGPUCanvas component"
    );
  }

  return format;
};

export const useWebGPUContext = (): GPUCanvasContext => {
  const context = useContext(WebGPUContext);

  if (!context) {
    throw new Error(
      "useWebGPUContext can only be used inside a WebGPUCanvas component"
    );
  }

  return context;
};

type Props = {
  width?: number;
  height?: number;
  fullscreen?: boolean;
  children?: ReactNode;
  fallback: ReactNode;
};

export const WebGPUCanvas = forwardRef<HTMLCanvasElement, Props>(
  ({ children, width, height, fullscreen = false }, ref) => {
    const ownRef = useRef<HTMLCanvasElement>(null);
    const autoSize = useAutoSize();
    const inner = useCombinedRefs<HTMLCanvasElement>(ref, ownRef, autoSize);
    const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
    const [context, setContext] = useState<GPUCanvasContext | null | Error>(
      null
    );
    const [presentationFormat, setPresentationFormat] =
      useState<GPUTextureFormat | null>(null);

    const device = useGPUDevice();

    const [inspectCanvas] = useInspector("Canvas");
    const [inspectContext, uninspectContext] = useInspector("GPUCanvasContext");

    useEffect(() => {
      setCanvas(ownRef.current);

      const uninspect = inspectCanvas(ownRef.current);

      if (ownRef.current) {
        const gpuContext = ownRef.current.getContext("webgpu");

        inspectContext(gpuContext);

        if (gpuContext) {
          setContext(gpuContext);
          configureContextPresentation(device, gpuContext);
          setPresentationFormat(getPresentationFormat());
        } else {
          setContext(new Error("Failed to request GPUCanvasContext"));
        }
      }

      return () => {
        uninspect();
        uninspectContext();
      };
    }, [inspectCanvas, uninspectContext, inspectContext, device]);

    const [className, size] = useMemo(() => {
      if (fullscreen) {
        return ["w-full h-full", { width: undefined, height: undefined }];
      } else {
        return ["", { width, height }];
      }
    }, [fullscreen, width, height]);

    return (
      <>
        <canvas
          className={className}
          width={size.width}
          height={size.height}
          ref={inner}
        ></canvas>

        {canvas && (
          <WebGPUCanvasContext.Provider value={canvas}>
            {context && !(context instanceof Error) && (
              <WebGPUContext.Provider value={context}>
                {typeof presentationFormat === "string" && (
                  <PresentationFormatContext.Provider
                    value={presentationFormat}
                  >
                    {children}
                  </PresentationFormatContext.Provider>
                )}
              </WebGPUContext.Provider>
            )}
          </WebGPUCanvasContext.Provider>
        )}
      </>
    );
  }
);

WebGPUCanvas.displayName = "WebGPUCanvas";
