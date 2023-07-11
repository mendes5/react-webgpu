import {
  createFiber,
  disposeRecursive,
  enterScopeSync,
  enterScopeAsync,
  type Plugin,
} from "./core";
import { keyPlugin } from "./plugins/key-plugin";
import { memoPlugin } from "./plugins/memo-plugin";
import { refPlugin } from "./plugins/ref-plugin";
import { usePlugin } from "./plugins/use-plugin";
import { createLock } from "./utils";

export type AsyncFiberGenerator<T extends unknown[] = [], R = undefined> = {
  (...args: T): Promise<R>;
  dispose(): Promise<void>;
};

export const createAsyncFiberRoot = <T extends unknown[], R>(
  gen: (...args: T) => Generator<any, R>,
  plugins: Plugin[] = []
): AsyncFiberGenerator<T, R> => {
  const fiber = createFiber();
  const lock = createLock<R>();

  const instantiatedPlugins = [
    ...plugins,
    refPlugin,
    usePlugin,
    keyPlugin,
    memoPlugin,
  ].map((plugin) => plugin(fiber));

  const tick = (...args: T) =>
    lock(
      async () =>
        enterScopeAsync(gen(...args), fiber, instantiatedPlugins) as Promise<R>
    );

  tick.dispose = () => {
    return lock(
      async () =>
        disposeRecursive(fiber.traceHead, instantiatedPlugins) as unknown as R
    ).then(() => undefined);
  };

  return tick;
};

export type SyncFiberGenerator<T extends unknown[] = [], R = undefined> = {
  (...args: T): R;
  dispose(): void;
};

export type SyncClosureFiberGenerator<R = undefined> = {
  (closure: Generator<any, R>): R;
  dispose(): void;
};

export const createSyncFiberRoot = <T extends unknown[], R>(
  gen: (...args: T) => Generator<any, R>,
  plugins: Plugin[] = []
): SyncFiberGenerator<T, R> => {
  const fiber = createFiber();

  const instantiatedPlugins = [
    ...plugins,
    refPlugin,
    usePlugin,
    keyPlugin,
    memoPlugin,
  ].map((plugin) => plugin(fiber));

  const tick = (...args: T): R => {
    return enterScopeSync(gen(...args), fiber, instantiatedPlugins) as R;
  };

  tick.dispose = () => disposeRecursive(fiber.traceHead, instantiatedPlugins);

  return tick;
};

export const createSyncClosureFiberRoot = <R>(
  plugins: Plugin[] = []
): SyncClosureFiberGenerator<R> => {
  const fiber = createFiber();

  const instantiatedPlugins = [
    ...plugins,
    refPlugin,
    usePlugin,
    keyPlugin,
    memoPlugin,
  ].map((plugin) => plugin(fiber));

  const tick = <R>(closure: Generator<any, R>): R => {
    return enterScopeSync(closure, fiber, instantiatedPlugins) as R;
  };

  tick.dispose = () => disposeRecursive(fiber.traceHead, instantiatedPlugins);

  return tick;
};

export { ref } from "./plugins/ref-plugin";
export { key } from "./plugins/key-plugin";
export { use } from "./plugins/use-plugin";
export { memo } from "./plugins/memo-plugin";
export { r } from "./core";
