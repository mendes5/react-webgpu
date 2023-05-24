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
    memo(() => {
        gpu.writeTexture({ data, texture, ... });
    }, [data, texture]);
}, [])
```

Looks like `memo` should suffice, since:

- This code is already an effect.
- State should not be done here anyways.
- `memo` can become a discount useRef if you want

Actions and refs mutations should be able to force rerenders
