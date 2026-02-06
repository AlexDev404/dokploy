import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { dbUrl } from "./constants";
import * as schema from "./schema";
import { sanitizeDbUrl } from "./utils";

declare global {
	var db: PostgresJsDatabase<typeof schema> | undefined;
}

// Log database connection for debugging (only in non-production or when DEBUG is set)
if (process.env.NODE_ENV !== "production" || process.env.DEBUG) {
	console.log(`[RUNTIME] Connecting to database: ${sanitizeDbUrl(dbUrl)}`);
}

export let db: PostgresJsDatabase<typeof schema>;
if (process.env.NODE_ENV === "production") {
	db = drizzle(postgres(dbUrl), {
		schema,
	});
} else {
	if (!global.db)
		global.db = drizzle(postgres(dbUrl), {
			schema,
		});

	db = global.db;
}

export { dbUrl };
