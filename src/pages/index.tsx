import { type NextPage } from "next";
import Head from "next/head";

import { api } from "~/utils/api";
import { DarkMenu } from "~/components/menu";

const Home: NextPage = () => {
  const version = api.meta.version.useQuery();

  return (
    <>
      <Head>
        <title>WebGPU Index</title>
        <link rel="icon" href="/favicon.svg" />
        <meta rel="app-version" content={version.data} />
      </Head>
      <DarkMenu />
    </>
  );
};

export default Home;
