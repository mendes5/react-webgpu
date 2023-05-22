import { type H } from "~/utils/other";
import { type GPU_API } from "./use-gpu";

export const makeWithMips = (
  gpu: GPU_API,
  device: GPUDevice,
  texture: H<GPUTexture>
) => {
  const shader = gpu.createShaderModule({
    label: "mip-map shader",
    code: /* wgsl */ `
    struct VSOutput {
      @builtin(position) position: vec4f,
      @location(0) texcoord: vec2f,
    };

    @vertex fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VSOutput {
      var pos = array<vec2f, 6>(

        // 1st triangle
        vec2f( 0.0,  0.0),  // center
        vec2f( 1.0,  0.0),  // right, center
        vec2f( 0.0,  1.0),  // center, top

        // 2nd triangle
        vec2f( 0.0,  1.0),  // center, top
        vec2f( 1.0,  0.0),  // right, center
        vec2f( 1.0,  1.0),  // right, top
      );

      var vsOutput: VSOutput;
      let xy = pos[vertexIndex];
      vsOutput.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
      vsOutput.texcoord = vec2f(xy.x, 1.0 - xy.y);
      return vsOutput;
    }

    @group(0) @binding(0) var ourSampler: sampler;
    @group(0) @binding(1) var ourTexture: texture_2d<f32>;

    @fragment fn fsMain(fsInput: VSOutput) -> @location(0) vec4f {
      return textureSample(ourTexture, ourSampler, fsInput.texcoord);
    }
  `,
  });

  const sampler = gpu.createSampler({
    minFilter: "linear",
    label: "mip map sampler",
  });

  const pipeline = gpu.createRenderPipeline({
    label: "Mipmap pipeline",
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "vsMain",
    },
    fragment: {
      module: shader,
      entryPoint: "fsMain",
      targets: [{ format: texture.format }],
    },
  });

  const frame = () => {
    const encoder = device.createCommandEncoder({
      label: "mip gen encoder",
    });

    let width = texture.width;
    let height = texture.height;
    let baseMipLevel = 0;

    while (width > 1 || height > 1) {
      width = Math.max(1, (width / 2) | 0);
      height = Math.max(1, (height / 2) | 0);

      const bindGroup = device.createBindGroup({
        label: "Mipmap bind group layout",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          {
            binding: 1,
            resource: texture.createView({
              baseMipLevel,
              mipLevelCount: 1,
            }),
          },
        ],
      });

      ++baseMipLevel;

      const renderPassDescriptor = {
        label: "our basic canvas renderPass",
        colorAttachments: [
          {
            view: texture.createView({ baseMipLevel, mipLevelCount: 1 }),
            loadOp: "clear",
            storeOp: "store",
          } as const,
        ],
      };

      const pass = encoder.beginRenderPass(renderPassDescriptor);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6); // call our vertex shader 6 times
      pass.end();
    }

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  };

  return frame;
};
