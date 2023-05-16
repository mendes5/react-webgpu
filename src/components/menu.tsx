import Link from "next/link";

const links = [
  { href: "/hello-triangle", label: "Hello Triangle" },
  { href: "/interstage", label: "Interstage Variables" },
  { href: "/compute", label: "Compute" },
  { href: "/uniforms", label: "Uniforms" },
  { href: "/storage-buffers", label: "Storage Buffers" },
  { href: "/textures", label: "Textures" },
  { href: "/canvas-texture", label: "Canvas Texture" },
  { href: "/textures-cpu-mips", label: "CPU Mipmapping" },
  { href: "/textures-gpu-mips", label: "GPU Mipmapping" },
  { href: "/external-textures", label: "External Textures" },
  { href: "/vertex-buffers", label: "Vertex Buffers" },
  { href: "/index-buffers", label: "Index Buffers" },
  { href: "/vertex-buffers-separate", label: "Vertex Buffers Separate" },
  { href: "/video-texture", label: "Video Texture (Broken)" },
];

export const Menu = () => {
  return (
    <div className="flex flex-col gap-1">
      {links.map(({ href, label }) => (
        <Link className="text-white underline" href={href}>
          {label}
        </Link>
      ))}
    </div>
  );
};

export const DarkMenu = () => {
  return (
    <div className="flex flex-col gap-1">
      {links.map(({ href, label }) => (
        <Link className="underline" href={href}>
          {label}
        </Link>
      ))}
    </div>
  );
};
