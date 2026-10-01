import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { channel, settings } from "../db/schema.js";
import { broadcast } from "../routes/ws/websockets.js";
import { getLastCheck } from "./last-check.helper.js";
import { calculateNextCheck, isValidTimeZone } from "./schedule.helper.js";

/** The zone saved in settings, or null to schedule against the server's clock. */
export async function getSavedTimeZone(): Promise<string | null> {
  const [row] = await db
    .select({ timeZone: settings.timeZone })
    .from(settings)
    .where(eq(settings.id, 1));

  return row?.timeZone ?? null;
}

/**
 * What a request's time zone should be stored as: a zone this runtime knows,
 * or null. An unknown name is dropped rather than stored, so the scheduler
 * never has to guess what it meant.
 */
export function normalizeTimeZone(value: unknown): string | null {
  return isValidTimeZone(value) ? value.trim() : null;
}

/**
 * Every booked check was worked out in the old zone, so a "09:00" row would
 * keep firing at the old 09:00 until its next scan. Re-book them all now.
 */
export async function rescheduleAllChannels(timeZone: string | null): Promise<void> {
  const rows = await db.select().from(channel);
  const now = new Date();

  db.transaction((tx) => {
    for (const row of rows) {
      tx.update(channel)
        .set({ nextCheckAt: calculateNextCheck(row, now, timeZone) })
        .where(eq(channel.id, row.id))
        .run();
    }
  });

  broadcast("next-check", await getLastCheck());
}
