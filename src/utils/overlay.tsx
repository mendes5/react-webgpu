import { type FC, type PropsWithChildren, useId } from "react";
import { tunnel } from "~/utils/tunnnel";

const OverlayTunnel = tunnel();
const OverlayTunnelEnd = tunnel();

export const ToOverlay: FC<PropsWithChildren> = ({ children }) => {
  const id = useId();

  return (
    <OverlayTunnel.In key={id}>
      <div className="flex flex-col gap-4" key={id}>
        {children}
      </div>
    </OverlayTunnel.In>
  );
};

export const ToOverlayEnd: FC<PropsWithChildren> = ({ children }) => {
  const id = useId();

  return (
    <OverlayTunnelEnd.In key={id}>
      <div className="flex flex-col gap-4" key={id}>
        {children}
      </div>
    </OverlayTunnelEnd.In>
  );
};

export const Overlay = () => {
  return (
    <>
      <div className="fixed left-0 top-0 flex flex-col gap-4 bg-[#000000aa] p-4 opacity-25 hover:opacity-100">
        <OverlayTunnel.Out />
      </div>
      <div className="fixed right-0 top-0 flex flex-col gap-4 bg-[#000000aa] p-4 opacity-25 hover:opacity-100">
        <OverlayTunnelEnd.Out />
      </div>
    </>
  );
};
