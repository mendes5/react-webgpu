import { r } from "~/trace";

const GetGPUDevice = Symbol("GetGPUDevice");

// BEHOLD: the most expensive getter ever

export const getGPUDevice = r(function* () {
  return yield { GetGPUDevice };
});

type PluginYield = {
  GetGPUDevice: typeof GetGPUDevice;
};

export const gpuDevicePluginCreator = (device: GPUDevice) => () => {
  return {
    matches: (value: unknown): value is PluginYield =>
      typeof value === "object" &&
      value !== null &&
      "GetGPUDevice" in value &&
      value.GetGPUDevice === GetGPUDevice,

    exec: () => device,
  };
};
