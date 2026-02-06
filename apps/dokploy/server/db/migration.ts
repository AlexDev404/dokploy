import { dbUrl } from "@dokploy/server/db";
import { sanitizeDbUrl } from "@dokploy/server/db/utils";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Log database connection for debugging (only in non-production or when DEBUG is set)
if (process.env.NODE_ENV !== "production" || process.env.DEBUG) {
	console.log(`[SERVER MIGRATION] Connecting to database: ${sanitizeDbUrl(dbUrl)}`);
}

const sql = postgres(dbUrl, { max: 1 });
const db = drizzle(sql);

export const migration = async () =>
  await migrate(db, { migrationsFolder: "drizzle") })
    .then(() => {
      console.log("Migration complete");
      sql.end();
    })
    .catch((error) => {
      throw new Error(error.message);
    })
    .finally(() => {
      sql.end();
    });
