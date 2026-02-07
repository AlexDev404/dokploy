import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { dbUrl } from "./constants";
import * as schema from "./schema";
import { sanitizeDbUrl } from "./utils";

declare global {
  var db: PostgresJsDatabase<typeof schema> | undefined;
}

let _db: PostgresJsDatabase<typeof schema> | undefined;

function getDbInstance(): PostgresJsDatabase<typeof schema> {
  if (_db) return _db;

  try {
    if (process.env.NODE_ENV === "production") {
      if (process.env.DEBUG) {
        console.log(`[DB] Connecting to database: ${sanitizeDbUrl(dbUrl)}`);
      }
      _db = drizzle(postgres(dbUrl), { schema });
    } else {
      if (!global.db) {
        if (process.env.DEBUG || process.env.NODE_ENV !== "production") {
          console.log(
            `[RUNTIME] Connecting to database: ${sanitizeDbUrl(dbUrl)}`,
          );
        }
        global.db = drizzle(postgres(dbUrl), { schema });
      }
      _db = global.db;
    }
  } catch (error) {
    console.error(
      "[@DOKPLOY] A caller tried to connect to the database:",
      error,
    );
    throw error; // Rethrow to prevent starting the app in a broken state
  }
  return _db;
}

// Export as a getter - only runs when accessed
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_, prop) {
    return getDbInstance()[prop as keyof PostgresJsDatabase<typeof schema>];
  },
});

export { dbUrl };
