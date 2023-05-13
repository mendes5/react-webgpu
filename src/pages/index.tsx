import { type NextPage } from "next";
import Head from "next/head";

import { api } from "~/utils/api";

import Link from "next/link";

const Home: NextPage = () => {
  const version = api.meta.version.useQuery();

  return (
    <>
      <Head>
        <title>WebGPU Index</title>
        <link rel="icon" href="/favicon.svg" />
        <meta rel="app-version" content={version.data} />
      </Head>
      <ul>
        <li>
          <Link href="/hello-triangle">Hello Triangle</Link>
        </li>
        <li>
          <Link href="/compute">Compute Shader</Link>
        </li>
        <li>
          <Link href="/interstage">Interstage Variables</Link>
        </li>
      </ul>
    </>
  );
};

export default Home;
