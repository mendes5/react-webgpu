import type { CallSite } from "../utils";

const Key = Symbol("Key");

type PluginYield = {
  Key: typeof Key;
  key: CallSite;
};

export type KeyMarker = () => void;

export const key = function* (key: number | string): Generator {
  return yield { Key, key: String(key) as CallSite };
};

export const keyPlugin = () => {
  return {
    matches: (value: unknown): value is PluginYield =>
      typeof value === "object" &&
      value !== null &&
      value &&
      "Key" in value &&
      value.Key === Key,
    exec: (param: PluginYield, key: CallSite[]): KeyMarker => {
      if (param.Key === Key) {
        key.push(param.key);
      }

      return () => key.pop();
    },
  };
};
