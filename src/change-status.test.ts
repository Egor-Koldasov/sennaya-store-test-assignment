import { afterEach, describe, expect, it, vi } from "vitest";
import { changeStatus, type Laptop, type Status } from "./change-status.js";

const saleDate = "2026-01-01T12:00:00.000Z";
const now = new Date("2026-01-02T12:00:00.000Z");

function fixture(status: Status): Laptop {
  return Object.freeze({
    status,
    history: Object.freeze([
      Object.freeze({
        from: status === "На складе" ? "Бронь" as const : "На складе" as const,
        to: status,
        date: saleDate,
      }),
    ]),
  });
}

function changed(laptop: Laptop, status: Status, date: string): Laptop {
  const result = changeStatus(laptop, status, new Date(date));
  if (!result.ok) throw new Error(result.error);
  return result.laptop;
}

afterEach(() => vi.useRealTimers());

describe("transition matrix", () => {
  const cases: [Status, Status, boolean][] = [
    ["На складе", "На складе", false],
    ["На складе", "Бронь", true],
    ["На складе", "Продан", true],
    ["На складе", "Списан", true],
    ["Бронь", "На складе", true],
    ["Бронь", "Бронь", false],
    ["Бронь", "Продан", true],
    ["Бронь", "Списан", false],
    ["Продан", "На складе", true],
    ["Продан", "Бронь", false],
    ["Продан", "Продан", false],
    ["Продан", "Списан", false],
    ["Списан", "На складе", false],
    ["Списан", "Бронь", false],
    ["Списан", "Продан", false],
    ["Списан", "Списан", false],
  ];

  it.each(cases)("%s → %s (allowed: %s)", (from, to, allowed) => {
    const laptop = fixture(from);
    const before = structuredClone(laptop);
    const result = changeStatus(laptop, to, now);

    expect(laptop).toEqual(before);
    expect(result.ok).toBe(allowed);
    if (result.ok) {
      expect(result.laptop).not.toBe(laptop);
      expect(result.laptop.status).toBe(to);
      expect(result.laptop.history).toEqual([
        ...before.history,
        { from, to, date: now.toISOString() },
      ]);
    } else {
      expect(result.error).toContain("Недопустимый переход");
      expect(result.error).toContain(`${from} → ${to}`);
    }
  });
});

describe("returns", () => {
  it.each([
    ["at the sale time", "2026-01-01T12:00:00.000Z", true],
    ["one millisecond before the deadline", "2026-01-15T11:59:59.999Z", true],
    ["exactly at the deadline", "2026-01-15T12:00:00.000Z", true],
    ["one millisecond after the deadline", "2026-01-15T12:00:00.001Z", false],
    ["well after the deadline", "2026-02-01T12:00:00.000Z", false],
  ])("%s", (_label, date, allowed) => {
    const laptop = fixture("Продан");
    const before = structuredClone(laptop);
    const result = changeStatus(laptop, "На складе", new Date(date));

    expect(laptop).toEqual(before);
    expect(result.ok).toBe(allowed);
    if (result.ok) {
      expect(result.laptop.history).toEqual([
        ...before.history,
        { from: "Продан", to: "На складе", date },
      ]);
    } else {
      expect(result.error).toContain("14 дней");
    }
  });

  it("rejects a return before the sale", () => {
    const laptop = fixture("Продан");
    expect(changeStatus(laptop, "На складе", new Date("2026-01-01T11:59:59.999Z")))
      .toEqual({ ok: false, error: "Дата возврата не может быть раньше даты продажи." });
    expect(laptop).toEqual(fixture("Продан"));
  });

  it.each([
    { history: [] },
    { history: [{ from: "На складе" as const, to: "Бронь" as const, date: saleDate }] },
  ])(
    "rejects missing sale history: $history",
    ({ history }) => {
      const laptop: Laptop = { status: "Продан", history };
      const before = structuredClone(laptop);
      expect(changeStatus(laptop, "На складе", now)).toEqual({
        ok: false,
        error: "Дата последней продажи отсутствует или некорректна.",
      });
      expect(laptop).toEqual(before);
    },
  );

  it("rejects an invalid latest sale date instead of using an earlier sale", () => {
    const laptop: Laptop = {
      status: "Продан",
      history: [
        { from: "На складе", to: "Продан", date: saleDate },
        { from: "Продан", to: "На складе", date: saleDate },
        { from: "На складе", to: "Продан", date: "invalid" },
      ],
    };
    const before = structuredClone(laptop);
    expect(changeStatus(laptop, "На складе", now)).toEqual({
      ok: false,
      error: "Дата последней продажи отсутствует или некорректна.",
    });
    expect(laptop).toEqual(before);
  });

  it("measures elapsed time across timezone offsets", () => {
    const laptop: Laptop = {
      status: "Продан",
      history: [{ from: "На складе", to: "Продан", date: "2026-01-01T15:00:00+03:00" }],
    };
    const result = changeStatus(laptop, "На складе", new Date("2026-01-15T07:00:00-05:00"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.laptop.history.at(-1)?.date).toBe("2026-01-15T12:00:00.000Z");
  });
});

describe("history and time", () => {
  it("records the full lifecycle and starts a fresh return window after resale", () => {
    const initial: Laptop = { status: "На складе", history: [] };
    const steps: [Status, string][] = [
      ["Бронь", "2026-01-01T12:00:00.000Z"],
      ["Продан", "2026-01-02T12:00:00.000Z"],
      ["На складе", "2026-01-03T12:00:00.000Z"],
      ["Продан", "2026-02-01T12:00:00.000Z"],
      ["На складе", "2026-02-15T12:00:00.000Z"],
      ["Списан", "2026-02-16T12:00:00.000Z"],
    ];
    let laptop = initial;
    for (const [status, date] of steps) laptop = changed(laptop, status, date);

    expect(initial).toEqual({ status: "На складе", history: [] });
    expect(laptop.status).toBe("Списан");
    expect(laptop.history).toEqual([
      { from: "На складе", to: "Бронь", date: steps[0]![1] },
      { from: "Бронь", to: "Продан", date: steps[1]![1] },
      { from: "Продан", to: "На складе", date: steps[2]![1] },
      { from: "На складе", to: "Продан", date: steps[3]![1] },
      { from: "Продан", to: "На складе", date: steps[4]![1] },
      { from: "На складе", to: "Списан", date: steps[5]![1] },
    ]);
  });

  it("uses the current time by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const result = changeStatus({ status: "На складе", history: [] }, "Продан");
    expect(result).toEqual({
      ok: true,
      laptop: {
        status: "Продан",
        history: [{ from: "На складе", to: "Продан", date: now.toISOString() }],
      },
    });
  });

  it("rejects an invalid change date without changing the input", () => {
    const laptop: Laptop = { status: "На складе", history: [] };
    expect(changeStatus(laptop, "Продан", new Date(NaN))).toEqual({
      ok: false,
      error: "Некорректная дата изменения статуса.",
    });
    expect(laptop).toEqual({ status: "На складе", history: [] });
  });

  it("keeps the recorded timestamp when the caller later changes its Date", () => {
    const date = new Date(saleDate);
    const result = changeStatus({ status: "На складе", history: [] }, "Бронь", date);
    date.setUTCFullYear(2030);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.laptop.history[0]?.date).toBe(saleDate);
  });
});
