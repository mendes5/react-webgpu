import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const meta = createTRPCRouter({
  version: publicProcedure.query(() => "0.0.1"),
});
