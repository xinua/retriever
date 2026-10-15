import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { subscription } from "../db/schema.js";

export async function getLastCheck() {
  const [row] = await db.select()
      .from(subscription)
      .where(sql`nextCheckAt IS NOT NULL AND enabled = 1`)
      .orderBy(sql`datetime(nextCheckAt) ASC`)
      .limit(1);

  if (!row) {
    return { ok: false };
  }

  return {
    ok: true,
    nextCheckAt: row.nextCheckAt,
    subscription: {
      id: row.id,
      name: row.name
    }
  };
};