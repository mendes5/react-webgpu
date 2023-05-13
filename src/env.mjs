import { z } from "zod";
import { createEnv } from "@t3-oss/env-nextjs";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    NODE_ENV: z.enum(["development", "test", "production"]),
  },

  client: {},

  runtimeEnv: {
    DATABASE_URL: process.env["DATABASE_URL"],
    NODE_ENV: process.env.NODE_ENV,
  },
});
