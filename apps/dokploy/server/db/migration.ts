import { dbUrl } from "@dokploy/server/db";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sql = postgres(dbUrl, { max: 1 });
const db = drizzle(sql);

export const migration = async () =>
  await migrate(db, { migrationsFolder: join(__dirname, "../../drizzle") })
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
