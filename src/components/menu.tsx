import Link from "next/link";

export const Menu = () => {
  return (
    <div className="flex flex-col gap-1">
      <Link className="text-white underline" href={"/hello-triangle"}>
        Hello Triangle
      </Link>
      <Link className="text-white underline" href={"/compute"}>
        Compute
      </Link>
      <Link className="text-white underline" href={"/interstage"}>
        Interstage Variables
      </Link>
      <Link className="text-white underline" href={"/uniforms"}>
        Uniforms
      </Link>
      <Link className="text-white underline" href={"/storage-buffers"}>
        Storage Buffers
      </Link>
      <Link className="text-white underline" href={"/textures"}>
        Textures
      </Link>
      <Link className="text-white underline" href={"/canvas-texture"}>
        Canvas Texture
      </Link>
      <Link className="text-white underline" href={"/textures-cpu-mips"}>
        CPU Mipmapping
      </Link>
      <Link className="text-white underline" href={"/textures-gpu-mips"}>
        GPU Mipmapping
      </Link>
      <Link className="text-white underline" href={"/external-textures"}>
        External Textures
      </Link>
      <Link className="text-white underline" href={"/vertex-buffers"}>
        Vertex Buffers
      </Link>
      <Link className="text-white underline" href={"/index-buffers"}>
        Index Buffers
      </Link>
      <Link className="text-white underline" href={"/vertex-buffers-separate"}>
        Vertex Buffers Separate
      </Link>
      <Link className="text-white underline" href={"/video-texture"}>
        Video Texture (Broken)
      </Link>
    </div>
  );
};
