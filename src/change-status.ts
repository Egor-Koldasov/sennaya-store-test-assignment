export type Status = "На складе" | "Бронь" | "Продан" | "Списан";

export interface HistoryEntry {
  readonly from: Status;
  readonly to: Status;
  /** ISO 8601 timestamp in UTC. */
  readonly date: string;
}

export interface Laptop {
  readonly status: Status;
  readonly history: readonly HistoryEntry[];
}

export type ChangeStatusResult =
  | { ok: true; laptop: Laptop }
  | { ok: false; error: string };

const transitions: Record<Status, readonly Status[]> = {
  "На складе": ["Бронь", "Продан", "Списан"],
  "Бронь": ["На складе", "Продан"],
  "Продан": ["На складе"],
  "Списан": [],
};

const RETURN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Returns a new laptop on success; never mutates the input. */
export function changeStatus(
  laptop: Laptop,
  nextStatus: Status,
  now: Date = new Date(),
): ChangeStatusResult {
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

  if (laptop.status === "Продан") {
    const sale = laptop.history.findLast((entry) => entry.to === "Продан");
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

  return {
    ok: true,
    laptop: {
      ...laptop,
      status: nextStatus,
      history: [
        ...laptop.history,
        { from: laptop.status, to: nextStatus, date: now.toISOString() },
      ],
    },
  };
}
