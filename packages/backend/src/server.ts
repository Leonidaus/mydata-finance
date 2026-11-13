import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { openDatabase } from "./db";

const db = openDatabase();
const port = Number(process.env.PORT ?? 8787);
// STATIC_DIR: the built web app to serve alongside the API (set in the Docker image).
const staticDir = process.env.STATIC_DIR;
if (staticDir && !existsSync(staticDir)) {
  throw new Error(`STATIC_DIR ${staticDir} does not exist. Build the app first: npm run build`);
}

serve({ fetch: createApp(db, { staticDir }).fetch, port }, (info) => {
  console.log(
    `Finance API on http://localhost:${info.port} ` +
      `(${db.meta.rows_customers} customers, today is ${db.today})` +
      (staticDir ? `, serving the app from ${staticDir}` : ""),
  );
});
