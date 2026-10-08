import { Status, type HistoryEntry, type Laptop } from "./models.js";
import { addHistoryEntry, updateLaptop } from "./persistence.js";

export type ChangeStatusResult =
  | { ok: true; laptop: Laptop; historyEntry: HistoryEntry }
  | { ok: false; error: string };

const transitions: Record<Status, readonly Status[]> = {
  [Status.IN_STOCK]: [Status.RESERVED, Status.SOLD, Status.WRITTEN_OFF],
  [Status.RESERVED]: [Status.IN_STOCK, Status.SOLD],
  [Status.SOLD]: [Status.IN_STOCK],
  [Status.WRITTEN_OFF]: [],
};

const RETURN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** History is supplied in chronological order, oldest first. Inputs are not mutated. */
export async function changeStatus(
  laptop: Laptop,
  nextStatus: Status,
  history: readonly HistoryEntry[],
  now: Date = new Date(),
): Promise<ChangeStatusResult> {
  if (!transitions[laptop.status].includes(nextStatus)) {
    return {
      ok: false,
      error: `Недопустимый переход: ${laptop.status} → ${nextStatus}.`,
    };
  }

  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) {
    return { ok: false, error: "Некорректная дата изменения статуса." };
  }

  if (laptop.status === Status.SOLD) {
    const sale = history.findLast(
      (entry) => entry.laptopUuid === laptop.uuid && entry.to === Status.SOLD,
    );
    const soldAt = sale ? Date.parse(sale.date) : NaN;
    if (!Number.isFinite(soldAt)) {
      return { ok: false, error: "Дата последней продажи отсутствует или некорректна." };
    }
    if (timestamp < soldAt) {
      return { ok: false, error: "Дата возврата не может быть раньше даты продажи." };
    }
    if (timestamp - soldAt > RETURN_WINDOW_MS) {
      return { ok: false, error: "Возврат возможен не позднее 14 дней после продажи." };
    }
  }

  const updatedLaptop: Laptop = { ...laptop, status: nextStatus };
  const historyEntry: HistoryEntry = {
    laptopUuid: laptop.uuid,
    from: laptop.status,
    to: nextStatus,
    date: now.toISOString(),
  };

  // With real persistence, both writes must share a transaction.
  await updateLaptop(updatedLaptop);
  await addHistoryEntry(historyEntry);

  return { ok: true, laptop: updatedLaptop, historyEntry };
}
