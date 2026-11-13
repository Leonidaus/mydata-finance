import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { openDatabase } from "./db";

const db = openDatabase();
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp(db).fetch, port }, (info) => {
  console.log(
    `Finance API on http://localhost:${info.port} ` +
      `(${db.meta.rows_customers} customers, today is ${db.today})`,
  );
});
