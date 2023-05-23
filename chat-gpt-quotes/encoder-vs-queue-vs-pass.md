> Any insights on why during rendering some commands goes on the encoder object, like `copyBufferToTexture`, other goes on the render pass like `pass.draw` and others go directly on the `device.queue` like `device.queue.writeBuffer`?

1. **Encoder object**: The encoder object in WebGPU represents the early stages of the rendering pipeline, where you set up and configure the resources and operations that will be used for rendering. Commands performed on the encoder object are typically related to resource management, state configuration, and setting up the rendering environment.

   - An example of a command that operates on the encoder object is `copyBufferToTexture`, which copies data from a buffer to a texture. This command is performed before the actual rendering pass begins and is independent of the render target or the specific rendering operation.

2. **Render pass**: The render pass in WebGPU represents the main stage of the rendering pipeline, where the actual rendering operations take place. The render pass encompasses all the commands related to drawing geometry, applying shaders, and producing the final rendered output.

   - An example of a command within the render pass is `pass.draw`, which is used to draw geometry using the configured shaders and resources. This command specifies the vertices, indices, and other parameters required for rendering and produces the final rendered output based on the specified rendering techniques.

3. **Device queue**: WebGPU also allows commands to be directly executed on the device's queue. The device's queue represents the command submission and execution stage of the rendering pipeline. Commands executed on the queue are typically used for asynchronous operations, resource updates, and data transfers.

   - An example of a command executed directly on the device's queue is `device.queue.writeBuffer`, which writes data to a buffer. This command is useful for updating buffer contents, such as uploading new vertex data, transforming matrices, or modifying constant buffers. It can be performed independently of the render pass and the encoder object, allowing for efficient and asynchronous resource updates.

The device queue in WebGPU is primarily used for CPU to GPU communication and for managing asynchronous tasks and resource updates. It serves as the interface for submitting commands from the CPU to the GPU for execution.

Commands executed on the device queue, such as `device.queue.writeBuffer` or `device.queue.copyBufferToBuffer`, are typically used for data transfers between the CPU and the GPU. These commands allow you to efficiently update buffers or perform other data-related operations asynchronously.

On the other hand, the encoder object is mainly used for managing and configuring resources that reside on the GPU. Commands executed on the encoder object, such as setting up rendering states, binding resources, or defining render passes, are related to preparing the rendering environment and specifying the rendering operations that will be performed on the GPU.

The separation between the device queue and the encoder object helps in organizing and structuring the different stages of the rendering pipeline. It provides a clear division between CPU-GPU communication and GPU resource management, allowing for efficient data transfers and resource setup within a rendering workflow.
