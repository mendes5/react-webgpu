import { createTRPCRouter } from "~/server/api/trpc";
import { meta } from "~/server/api/routers/meta";

export const appRouter = createTRPCRouter({
  meta,
});

export type AppRouter = typeof appRouter;
