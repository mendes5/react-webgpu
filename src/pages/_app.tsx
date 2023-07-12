import { type AppType } from "next/app";

import { api } from "~/utils/api";

import "~/styles/globals.css";
import { Inspector } from "~/webgpu/debug";
import { WebGPUDevice } from "~/webgpu/gpu-device";

const MyApp: AppType = ({ Component, pageProps }) => {
  return (
    <Inspector name="root">
      <WebGPUDevice
        loading={<h1>Loading</h1>}
        fallback={<h1>Failed to create GPUDevice</h1>}
      >
        <Component {...pageProps} />
      </WebGPUDevice>
    </Inspector>
  );
};

export default api.withTRPC(MyApp);
