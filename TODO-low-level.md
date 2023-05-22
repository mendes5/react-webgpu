- Suss out the differences between per frame code, setup code, and action code.

  - Most examples use per frame code, this type of code depends on the `device`, which we are trying to hide.
  - The compute example has code that should be ran on demand, the setup is eager but the API should allow to make it lazy. The action code share many things with per frame code.
  - All examples have some kind of setup code, this code is allowed to use the `gpu` object.
    - How will we handle async code? async generators maybe?
    - What if i absolutely NEED the `gpu` object per frame?

- Create a better way to make per frame code.

  - Ideally we could wait all async stuff to finish before starting the render loop
  - And in one shot we could create a command encoder, gather all frame code requests, and with one sync call, render everything.
  - Currently having to sprinkle `useFrame` calls all over the code is a recipe for disaster
  - Not sure how we will do the ordering of the render calls, react does not have an API for sorting arrays based on fiber "position", what even is fiber position.

- Investigate how to integrate with suspense and error barriers

- Imperative hooks:

```js
useGPU(() => {

    // create this buffer once, and then never again
    const data = memo(() => new Float32Array(10), []);

    // this is already cached today
    const texture = gpu.createTexture({ ... });

    // don't re-write the texture on reRenders
    // only if the data or the texture changes
    // since both are immutable, this should
    // only render once
    imperativeEffect(() => {
        gpu.writeTexture({ data, texture, ... });
    }, [data, texture]);

}, [])
```
