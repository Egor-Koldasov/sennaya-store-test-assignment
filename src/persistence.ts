import type { HistoryEntry, Laptop } from "./models.js";

/** Dummy update: a real implementation would update the laptop by UUID. */
export async function updateLaptop(laptop: Laptop): Promise<Laptop> {
  return laptop;
}

/** Dummy insert: a real implementation would append a separate history row. */
export async function addHistoryEntry(entry: HistoryEntry): Promise<HistoryEntry> {
  return entry;
}
