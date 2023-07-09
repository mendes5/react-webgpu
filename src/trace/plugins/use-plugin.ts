import { type FrameContext, r } from "../core";
import type { CallSite } from "../utils";

const Use = Symbol("Use");

export const use = r(function* (generator: () => Generator) {
  return yield { Use, generator };
});

type PluginYield = {
  Use: typeof Use;
  generator: () => Generator;
};

interface UseFrameContext extends FrameContext {
  uses?: Record<string, Generator>;
}

export const usePlugin = () => {
  return {
    matches: (value: unknown): value is PluginYield =>
      typeof value === "object" &&
      value !== null &&
      "Use" in value &&
      value.Use === Use,
    dispose: (ctx: UseFrameContext) => {
      for (const gen of Object.values(ctx.uses ?? {})) {
        gen.return(undefined);
      }
    },
    exec: (
      { generator }: PluginYield,
      callSite: CallSite[],
      ctx: UseFrameContext
    ) => {
      const key = callSite.join("@");

      if (!ctx.uses) {
        ctx.uses = {};
      }

      const cached = ctx.uses[key];

      if (cached) {
        return cached.next().value as unknown;
      } else {
        const newItem = generator();
        const result: unknown = newItem.next().value;
        ctx.uses[key] = newItem;
        return result;
      }
    },
  };
};
