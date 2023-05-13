import {
  type MutableRefObject,
  useEffect,
  useRef,
  type FC,
  type PropsWithChildren,
} from "react";

const PER_FRAME_CONTEXT = new Set<MutableRefObject<(dt: number) => void>>();

export const useFrame = (callback: (dt: number) => void) => {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    PER_FRAME_CONTEXT.add(ref);
    return () => {
      PER_FRAME_CONTEXT.delete(ref);
    };
  }, []);
};

type Props = {
  enabled: boolean;
};

export const RenderController: FC<PropsWithChildren<Props>> = ({
  children,
  enabled,
}) => {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const animationFrameRef = useRef(0);

  useEffect(() => {
    if (enabled) {
      const frame = (dt: number) => {
        const fns = [...PER_FRAME_CONTEXT.values()];
        fns.forEach((fn) => fn.current(dt));
        if (enabledRef.current) {
          animationFrameRef.current = requestAnimationFrame(frame);
        }
      };

      animationFrameRef.current = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [enabled]);

  return <>{children}</>;
};

if (typeof window !== "undefined") {
  Object.assign(window, {
    PER_FRAME_CONTEXT,
    render() {
      const fns = [...PER_FRAME_CONTEXT.values()];
      fns.forEach((fn) => fn.current(0));
    },
  });
}
