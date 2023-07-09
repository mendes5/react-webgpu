import { type FrameContext, r } from "../core";
import { type CallSite, isSameDependencies } from "../utils";

const Memo = Symbol("Memo");

export const memo = r(function* <A, B, C, D extends unknown[]>(
  generator: (...args: D) => Generator<A, B, C>,
  args: D
) {
  return yield { Memo, generator, args };
});

type EnhancedGenerator = Generator & { value: unknown; args: unknown[] };

interface MemoFrameContext extends FrameContext {
  memos?: Record<string, EnhancedGenerator>;
}

type PluginYield = {
  Memo: typeof Memo;
  generator: (...args: unknown[]) => Generator;
  args: unknown[];
};

export const memoPlugin = () => {
  return {
    matches: (value: unknown): value is PluginYield =>
      typeof value === "object" &&
      value !== null &&
      "Memo" in value &&
      value.Memo === Memo,
    dispose: (ctx: MemoFrameContext) => {
      for (const gen of Object.values(ctx.memos ?? {})) {
        gen.next();
      }
    },
    exec: (
      { generator, args }: PluginYield,
      callSite: CallSite[],
      ctx: MemoFrameContext
    ) => {
      const key = callSite.join("@");

      if (!ctx.memos) {
        ctx.memos = {};
      }

      const cached = ctx.memos[key];

      if (cached) {
        if (isSameDependencies(cached.args, args)) {
          return cached.value;
        } else {
          cached.next();
        }
      }

      const newItem = generator(...args);
      const result: unknown = newItem.next().value;
      ctx.memos[key] = Object.assign(newItem, { args, value: result });
      return result;
    },
  };
};
