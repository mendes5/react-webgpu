# React WebGPU

This is a work in progress research project trying to evaluate how a declarative/reactive graphics engine would work.

It's basically following the [WebGPU Fundamentals](https://webgpufundamentals.org/) guide, while applying the preachings of [Steven Wittens](https://acko.net/about/) at [acko.net](https://acko.net) _(the site with the cool banner)_.

![X](./screenshots/6.png)

See it live:

[react-webgpu.vercel.app](https://react-webgpu.vercel.app/)

### Running the demo:

```
git clone git@github.com:mendes5/web-gpu-react.git
cd web-gpu-react
cp .env.example .env
nvm use
yarn
yarn dev
```

# The Basics

We have a `useGPU` hook, and use it to basically to everything GPU related.

Example:

```ts
const instanceCount = useRefTrap(10);

const { updateBuffers } = useGPU(({ gpu, frame, action }) => {
  // Setup code
  const pipeline = gpu.createRenderPipeline({ ... });

  // Rendering code uses `frame`
  const main = frame.main(({ encoder }) => {
    ...
    encoder.setPipeline(shader);
    pass.draw(instanceCount.current)
    ...
  }, [pipeline]);

  // Non-rendering code uses action
  const updateBuffers = action(({ invalidates, queue }) => {
    invalidates(main);
    queue.copyExternalImageToTexture(...);
  });

  return { updateBuffers };
}, []);

return <button onClick={updateBuffers} />
```

The idea is not to go to the lengths of [usegpu.live](https://usegpu.live/) and create helpers for lightning, animation, loading GLTF etc... I only want a single efficient, declarative, reactive way to manage GPU resources, the most low level building block. With that done we can do everything else in other packages.

By using the `useGPU` a lot stuff is already done for you:

- Resource management:
  - Sharing and caching of resources that can be global like samplers, and pipelines, kinda like react query, but for GPU stuff.
  - Automatic setup/teardown of local resources like buffers and textures.
- Device management
  - If the device is lost, then everything in the whole application will be re-created automatically.
  - Multiple devices.
- Lazy rendering
  - Only rerender if data changes
  - Rerender if the screen gets resized
  - `useRefTrap` makes the frames that depends on it re-render on mutations, so no `useState` is required to update stuff.
- Frame scheduling
  - Actions always ran before render, but can also wait the render to finish to download GPU buffers.
  - Runs frame callbacks at the desired frame rate if necessary, or only on data changes.

When your application is running at 60FPS no react code is actually running, all React does is wire up a bunch of resources on one render, and then if everything is memoized correctly, it should only re-render when the GPU resources needs to be created/destroyed.

It can become quite heavy if you code without care, but paths to optimize such code do exist.

That way you probably could create an FPS game, and react could be used as an kind of `GPUResourceManager` class. But my idea is to put everything else in react too, like using JSX to build scene graphs, DSLs, visibility toggles etc... Thay way you could easily create data driven apps using the GPU.

## Checklist:

#### General

#### `useGPU`

- [x] Support SSR (we aren't using the GPU there, but the `GPUDevice` components, and all other components should not block rendering of HTML on the server)
- [x] Support react strict mode
- [x] Cache GPU calls so two `createBuffers` calls with the same parameters on the same component only create one buffer.
- [x] Support rendering without canvas.
- [x] Create a frame scheduler
- [x] Rerender on canvas resize
- [x] Make the frame scheduler support lazy rendering
- [ ] Make the frame scheduler render in tree order.
- [ ] Make the frame scheduler support custom update timing.
- [x] Make react `useRef` rerender lazy frames
- [x] Support async `useGPU` to allow for `createRenderPipelineAsync`
- [x] Add "actions" to run imperative code on demand, before rendering
- [ ] Hide away the `device` entirely
- [ ] Add a resource debugger
- [ ] Support multiple command encoders
- [ ] Improve async action support
- [ ] Add `memo` function, to cache CPU resource creation inside `useGPU` (i guess you can do it outside with `useMemo` but will make porting existing code easier)
- [ ] Add a shader linker (probably use from `@use-gpu/shader`)
- [ ] Adds better way to `createBindGroup`
- [ ] Adds better way to use the `device.queue`
- [ ] Adds better way to render to the `screen`
- [ ] Adds better way to render to use the default presentation format.
