import tunnel from "tunnel-rat";

const OverlayTunnel = tunnel();

export const ToOverlay = OverlayTunnel.In;

export const Overlay = () => {
  return (
    <div className="fixed left-0 top-0 flex flex-col gap-4 p-4 opacity-25 hover:opacity-100">
      <OverlayTunnel.Out />
    </div>
  );
};
