import { type NextPage } from "next";
import Head from "next/head";

import { api } from "~/utils/api";

import styles from "./style.module.css";

const Home: NextPage = () => {
  const version = api.meta.version.useQuery();

  return (
    <>
      <Head>
        <title>WebGPU Tests</title>
        <link rel="icon" href="/favicon.svg" />
        <meta rel="app-version" content={version.data} />
      </Head>
      <div className={styles.root}></div>
    </>
  );
};

export default Home;
