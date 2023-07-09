import { type FrameContext, r } from "../core";
import type { CallSite } from "../utils";

const Ref = Symbol("Ref");

export const ref = r(function* (current) {
  return yield { Ref, initial: { current } };
});

export type RefObject<T> = { current: T };

interface RefFrameContext extends FrameContext {
  refs?: Record<string, { current: unknown }>;
}

type PluginYield = {
  Ref: typeof Ref;
  initial: RefObject<unknown>;
};

export const refPlugin = () => {
  return {
    matches: (value: unknown): value is PluginYield =>
      typeof value === "object" &&
      value !== null &&
      "Ref" in value &&
      value.Ref === Ref,
    exec: (value: PluginYield, callSite: CallSite[], ctx: RefFrameContext) => {
      const key = callSite.join("@");

      if (!ctx.refs) {
        ctx.refs = {};
      }

      const cached = ctx.refs[key];

      if (cached) {
        return cached;
      } else {
        ctx.refs[key] = value.initial;
        return ctx.refs[key];
      }
    },
  };
};
