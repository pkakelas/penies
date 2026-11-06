"use server";

import { updateTag } from "next/cache";

/** Make the public pages re-read the songs. /admin calls this after a change. */
export async function refreshSongs(): Promise<void> {
  updateTag("songs");
}
