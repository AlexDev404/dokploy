import { dbUrl } from "@dokploy/server/db/constants";
import { sanitizeDbUrl } from "@dokploy/server/db/utils";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Define and run the migration function
export const migration = async () => {
  const sql = postgres(dbUrl, { max: 1 });
  const db = drizzle(sql);
  console.log(
    `[SERVER MIGRATION] Connecting to database: ${sanitizeDbUrl(dbUrl)}`,
  );
  await migrate(db, { migrationsFolder: "drizzle" })
    .then(() => {
      console.log("Migration complete");
      sql.end();
    })
    .catch((error) => {
      console.error("Migration error:", error);
      sql.end();
      throw new Error(error);
    });
};
