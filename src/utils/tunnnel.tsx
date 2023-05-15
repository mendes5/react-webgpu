import { type ReactNode } from "react";
import { useIsomorphicLayoutEffect } from "usehooks-ts";
import { create, type StoreApi } from "zustand";

type Props = { children: ReactNode };

type State = {
  current: Array<ReactNode>;
  version: number;
  set: StoreApi<State>["setState"];
};

/**
 * From https://github.com/pmndrs/tunnel-rat
 * With some changes to make render order it deterministic
 */
export const tunnel = () => {
  const useStore = create<State>((set) => ({
    current: new Array<ReactNode>(),
    version: 0,
    set,
  }));

  return {
    In: ({ children }: Props) => {
      const set = useStore((state) => state.set);
      const version = useStore((state) => state.version);

      useIsomorphicLayoutEffect(() => {
        set((state) => ({
          version: state.version + 1,
        }));
      }, []);

      useIsomorphicLayoutEffect(() => {
        set(({ current }) => {
          const next = [...current, children];

          // Find a way to make a somewhat stable sort
          // We don't care about render order anyways
          next.sort((a, b) => {
            if (a && typeof a === "object" && b && typeof b === "object") {
              if ("key" in a && "key" in b && a.key && b.key) {
                return String(a.key).localeCompare(String(b.key));
              }
            }
            return 0;
          });

          return {
            current: next,
          };
        });

        return () =>
          set(({ current }) => ({
            current: current.filter((c) => c !== children),
          }));
      }, [children, version]);

      return null;
    },

    Out: () => {
      const current = useStore((state) => state.current);
      return <>{current}</>;
    },
  };
};
