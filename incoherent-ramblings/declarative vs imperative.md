# On declarative vs imperative code

One problem this architecture is that: if everything is a hook, then you don't have the same liberties that you have with imperative code.

For example, you could want to have an array of samplers.

```js
for (const i of range(10)) {
  objectInfos.push(device.createSampler({ ... }));
}
```

How would you do that with hooks?

```js
for (const i of range(10)) {
  useSampler({{ ... }});
}
```

Yeah, thats not going to work... React will crash your app if you try to do this, it should work in this case since 10 is constant, but we want to be declarative, if I change that `10` to an `useCounter` result, it should create and destroy samplers as needed, without even touching the ones that are not changed.

This looks a lot like classic React rendering, if you do something like this:

```jsx
<div>
  {data.map((user)) => (
    <User key={user.id} {...user} />
  )}
</div>
```

React will manage that list for you, if new keys are added, they are rendered, without touching the elements whose key didn't change (on the DOM at least, they will still get rendered).

But we cant use that mechanism here, this works only for components, and we are developing a hook-based API.

The solution: manual reconciliation.

```js
const { samplers, buffer } = useGPU({}, (gpu) => {
  const samplers = range(i).map((idx) =>
    gpu.createSampler({ label: `Sampler ${i}`, ... });
  )

  const buffer = gpu.createBuffer({
    label: `Buffer for ${toggle ? 'UI' : 'Debug'}`,
    ...
  });

  return { samplers, buffer };
}, [i, toggle]);
```

While it looks like a terrible idea to do this, it is not doing what it looks like.

Just like React is not re-running your useMemo function on each re-render, im not actually creating those buffers and samplers on each re-render.

The function still get ran on every re-render, but if the `GPUSamplerDescriptor`s and `GPUBufferDescriptors` still have the same values, they will not be created, they will get fetched from a cache.

For example:

1. First render, `i` samplers are created, and a buffer is created.
2. The `toggle` value gets updated from `true` to `false`, making the component to re-render.
3. The `gpu.createSampler` calls gets executed, but since their descriptors didn't change, all that `.map` does is rewire the already existing samplers back to the `samplers` array.
4. The `gpu.createBuffer` call gets executed, since its label changed from `"Buffer for UI"` to `"Buffer for Debug"`, its descriptor structural hash is not the same, so a new buffer will be created (yes even the labels are counted in the structural hash), and since this computation of the `useGPU` didn't "render" the call for `"Buffer for UI"`, that buffer will be promptly destroyed.

Another example:

1. First render, `i` samplers are created, and a buffer is created.
2. The `i` value gets updated from `10` to `5`, making the component to re-render.
3. The `gpu.createSampler` calls gets executed, the samplers from `0` to `5` are requested, but their descriptors are the same, noting happens.
4. The `gpu.createBuffer` call gets executed, nothing from it changed, so nothing happens again.
5. The callback returns and since samplers `6` to `10` were not used, they are destroyed too.

Last one:

1. First render, `i` samplers are created, and a buffer is created.
2. The `i` value gets updated from `10` to `20`, making the component to re-render.
3. The `gpu.createSampler` calls gets executed, the samplers from `0` to `10` are requested, but their descriptors are the same, noting happens.
4. The `gpu.createSampler` calls keeps getting executed, and now `11` to `20` are requested, those samplers are not in the cache so they are created.
5. The `gpu.createBuffer` call gets executed, nothing from it changed, so nothing happens again.

> Note: samplers are actually cached globally since they are not owned by a pipeline or shader or instance specifically, and can be reused anywhere, but the point remains.

So we kinda roll out our own reconciler for imperative code that:

- If resources are described that are not in the cache, they are created immediately
- If resources are described that are in the cache, they just are returned
- If the callback returns but, some resources are not described, they are deleted before `useGPU` is returned.

The compute example uses this `useGPU` hook already, and it works like a charm, you can even create additional resources in the same `useGPU` hook, but you will need to reconcile them yourself.

> Possible `makeMemo`, `makeRef` and `makeState` functions for imperative code?

So this `useGPU` can be the definitive low level hook used for managing GPU resources, and you still can have your more declarative `useSampler` `usePipeline` etc... if you want, but should be the same thing, just more declarative.
