import { type CallSite, getStackFrame } from "./utils";

type GeneratorFunction<TArgs extends unknown[], T, TReturn, TNext> = (
  ...args: TArgs
) => Generator<T, TReturn, TNext>;

type EnhancedGenerator = Generator & { callSite: CallSite };

export const r =
  <TArgs extends unknown[], T, TReturn, TNext = any>(
    fn: GeneratorFunction<TArgs, T, TReturn, TNext>
  ) =>
  (...args: TArgs): Generator<T, TReturn, TNext> => {
    const callSite = getStackFrame(3);

    const generator = fn(...args);

    return Object.assign(generator, {
      callSite,
    });
  };

const isGenerator = (generator: unknown): generator is Generator =>
  Boolean(generator) &&
  typeof generator !== "undefined" &&
  generator !== null &&
  (generator.toString() === "[object Generator]" ||
    generator.toString() === "[object AsyncGenerator]");

const isEnhancedGenerator = (
  generator: unknown
): generator is EnhancedGenerator =>
  isGenerator(generator) &&
  "callSite" in generator &&
  typeof generator.callSite === "string";

export interface FrameContext {
  child: Record<CallSite, FrameContext>;
  unusedLanes: Set<CallSite>;
  tapCount: number;
}

const createFrameContext = (): FrameContext => ({
  child: {},
  unusedLanes: new Set(),
  tapCount: 0,
});

type Fiber = {
  disposed: boolean;
  traceRoot: FrameContext;
  traceHead: FrameContext;
  thread: CallSite[];
};

export const createFiber = (): Fiber => {
  const frameContext = createFrameContext();

  return {
    disposed: false,
    traceRoot: frameContext,
    traceHead: frameContext,
    thread: [],
  };
};

export type PluginInstance = {
  matches(value: unknown): boolean;
  exec(
    value: unknown,
    thread: CallSite[],
    frameContext: FrameContext,
    plugins: PluginInstance[]
  ): unknown;
  dispose?(frameContext: FrameContext): void;
};

export type Plugin = (fiber: Fiber) => PluginInstance;

export const disposeRecursive = (
  context: FrameContext,
  plugins: PluginInstance[]
) => {
  for (const plugin of plugins) {
    plugin.dispose?.(context);
  }

  for (const node of Object.values(context.child)) {
    disposeRecursive(node, plugins);
  }
};

const keys = <T extends Record<string, unknown>>(value: T) =>
  Object.keys(value) as (keyof typeof value)[];

export const enterScopeAsync = async (
  generator: unknown,
  ctx: Fiber,
  plugins: PluginInstance[]
) => {
  if (!isGenerator(generator))
    throw new Error(`Non generator passed to enterScope`);

  const parentFrameContext = ctx.traceHead;
  let frameContext: FrameContext;

  if (isEnhancedGenerator(generator)) {
    ctx.thread.push(generator.callSite);

    if (!ctx.traceHead.child[generator.callSite]) {
      frameContext = createFrameContext();
      ctx.traceHead.child[generator.callSite] = frameContext;
      ctx.traceHead = frameContext;
    } else {
      frameContext = ctx.traceHead.child[generator.callSite]!;
      frameContext.unusedLanes = new Set(keys(frameContext.child));
      frameContext.tapCount++;
      ctx.traceHead = frameContext;
    }

    parentFrameContext.unusedLanes.delete(generator.callSite);
  }

  const handlePlugins = (value: unknown, key: CallSite[]) => {
    if (value)
      for (const plugin of plugins) {
        if (plugin.matches(value)) {
          return plugin.exec(value, key, frameContext, plugins);
        }
      }
    return value;
  };

  try {
    let last;
    do {
      // eslint-disable-next-line
      last = await generator.next(last?.value);

      if (isGenerator(last?.value)) {
        // eslint-disable-next-line
        last.value = await enterScopeAsync(last.value, ctx, plugins);
      } else {
        last.value = handlePlugins(last.value, ctx.thread);
      }
    } while (last.done === false);
    // eslint-disable-next-line
    return last.value;
  } finally {
    if (isEnhancedGenerator(generator)) {
      ctx.traceHead = parentFrameContext;
      ctx.thread.pop();

      for (const lane of frameContext!.unusedLanes) {
        disposeRecursive(frameContext!.child[lane]!, plugins);
        delete frameContext!.child[lane];
      }
    }
  }
};

export const enterScopeSync = (
  generator: unknown,
  ctx: Fiber,
  plugins: PluginInstance[]
) => {
  if (!isGenerator(generator))
    throw new Error(`Non generator passed to enterScope`);

  const parentFrameContext = ctx.traceHead;
  let frameContext: FrameContext;

  if (isEnhancedGenerator(generator)) {
    ctx.thread.push(generator.callSite);

    if (!ctx.traceHead.child[generator.callSite]) {
      frameContext = createFrameContext();
      ctx.traceHead.child[generator.callSite] = frameContext;
      ctx.traceHead = frameContext;
    } else {
      frameContext = ctx.traceHead.child[generator.callSite]!;
      frameContext.unusedLanes = new Set(keys(frameContext.child));
      frameContext.tapCount++;
      ctx.traceHead = frameContext;
    }

    parentFrameContext.unusedLanes.delete(generator.callSite);
  }

  const handlePlugins = (value: unknown, key: CallSite[]) => {
    if (value)
      for (const plugin of plugins) {
        if (plugin.matches(value)) {
          return plugin.exec(value, key, frameContext, plugins);
        }
      }
    return value;
  };

  try {
    let last;
    do {
      last = generator.next(last?.value);

      if (isGenerator(last?.value)) {
        // eslint-disable-next-line
        last.value = enterScopeSync(last.value, ctx, plugins);
      } else {
        last.value = handlePlugins(last.value, ctx.thread);
      }
    } while (last.done === false);
    // eslint-disable-next-line
    return last.value;
  } finally {
    if (isEnhancedGenerator(generator)) {
      ctx.traceHead = parentFrameContext;
      ctx.thread.pop();

      for (const lane of frameContext!.unusedLanes) {
        disposeRecursive(frameContext!.child[lane]!, plugins);
        delete frameContext!.child[lane];
      }
    }
  }
};
