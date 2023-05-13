import {
  type FC,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { useIsClient, useIsMounted } from "usehooks-ts";
import { useInspector } from "./debug";
import { requestAdapter } from "./calls";
import { useEffectInvalidator } from "~/utils/hooks";

const GPUDeviceContext = createContext<GPUDevice | null>(null);

export const useGPUDevice = (): GPUDevice => {
  const device = useContext(GPUDeviceContext);

  if (typeof window === "undefined") {
    return {} as unknown as GPUDevice;
  }

  if (!device) {
    throw new Error(
      "useGPUDevice can only be used inside GPUDevice components"
    );
  }

  return device;
};

type Props = {
  children?: ReactNode;
  fallback: ReactNode;
};

export const WebGPUDevice: FC<Props> = ({ children, fallback }) => {
  const [device, setDevice] = useState<GPUDevice | null | Error>(null);

  const isMounted = useIsMounted();

  const [inpect, uninspect] = useInspector("WebGPUDevice");

  const [cacheBurst, invalidateDevice] = useEffectInvalidator();

  useEffect(() => {
    requestAdapter()
      .then((freshDevice) => {
        if (isMounted()) {
          inpect(freshDevice);
          setDevice(freshDevice);

          freshDevice.lost
            .then((info) => {
              console.error(`WebGPU device was lost: ${info.message}`);

              if (isMounted()) {
                if (info.reason !== "destroyed") {
                  invalidateDevice();
                }
              }
            })
            .catch(console.error);
        }
      })
      .catch((error: Error) => {
        if (isMounted()) {
          setDevice(error);
        }
      });

    return () => {
      uninspect();
    };
    // eslint-disable-next-line
  }, [isMounted, uninspect, inpect, cacheBurst, cacheBurst]);

  const isClient = useIsClient();

  if (!isClient) {
    return null;
  }

  return (
    <GPUDeviceContext.Provider value={device instanceof Error ? null : device}>
      {device instanceof Error && fallback}
      {device instanceof GPUDevice && children}
    </GPUDeviceContext.Provider>
  );
};
