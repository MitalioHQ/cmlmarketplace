import { readFile } from "node:fs/promises";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run database migrations.");
}

const schemaUrl = new URL("../database/schema.sql", import.meta.url);
const schema = await readFile(schemaUrl, "utf8");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await sql.unsafe(schema);
  console.log("CML Marketplace database schema is ready.");
} finally {
  await sql.end();
}
