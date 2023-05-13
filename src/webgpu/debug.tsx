import {
  type FC,
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
} from "react";

type DebugStore = Map<string, unknown>;

const DebugContext = createContext<DebugStore>(new Map());

const DEBUG: Record<string, DebugStore> = {};

const getDebugStore = (name: string): DebugStore => {
  const store = DEBUG[name];
  if (store) {
    return store;
  }

  const newStore: DebugStore = new Map();
  DEBUG[name] = newStore;
  return newStore;
};

if (typeof window !== "undefined") {
  Object.assign(window, { DEBUG });
}

export const Inspector: FC<PropsWithChildren<{ name: string }>> = ({
  children,
  name = "default",
}) => {
  return (
    <DebugContext.Provider value={getDebugStore(name)}>
      {children}
    </DebugContext.Provider>
  );
};

const buildKey = (name: string, id: string) => `${name}@${id}`;

export const useInspector = <T,>(name: string) => {
  const id = useId();
  const inpsector = useContext(DebugContext);

  return [
    useCallback(
      (value: T) => {
        const key = buildKey(name, id);
        inpsector.set(key, value);

        return () => {
          inpsector.delete(key);
        };
      },
      [name, id, inpsector]
    ),
    useCallback(() => {
      const key = buildKey(name, id);
      inpsector.delete(key);
    }, [name, id, inpsector]),
  ] as const;
};

export const useInspect = <T,>(name: string, value: T) => {
  const id = useId();
  const inpsector = useContext(DebugContext);

  useEffect(() => {
    const key = buildKey(name, id);
    inpsector.set(key, value);
    return () => {
      inpsector.delete(key);
    };
  }, [id, inpsector, name, value]);
};
