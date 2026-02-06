import { dbUrl } from "@dokploy/server/db";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Log database connection for debugging
const sanitizedUrl = dbUrl.replace(/:[^:@]+@/, ':***@');
console.log(`[MIGRATION] Connecting to database: ${sanitizedUrl}`);

const sql = postgres(dbUrl, { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder: join(__dirname, "drizzle") })
	.then(() => {
		console.log("Migration complete");
		sql.end();
	})
	.catch((error) => {
		console.log("Migration failed", error);
	})
	.finally(() => {
		sql.end();
	});
