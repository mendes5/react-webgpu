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

  useEffect(() => {
    requestAdapter()
      .then((freshDevice) => {
        if (isMounted()) {
          inpect(freshDevice);
          setDevice(freshDevice);
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
  }, [isMounted, uninspect, inpect]);

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
