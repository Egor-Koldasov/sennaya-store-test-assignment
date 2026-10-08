import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeStatus } from "./change-status.js";
import { Status, type HistoryEntry, type Laptop } from "./models.js";
import * as persistence from "./persistence.js";

const uuid = "01dce7de-ea54-4b47-a6cd-a2c61b309fe5";
const otherUuid = "5c9e1655-4191-4017-aa8f-575bc681fa2a";
const saleDate = "2026-01-01T12:00:00.000Z";
const now = new Date("2026-01-02T12:00:00.000Z");
const saleHistory: readonly HistoryEntry[] = Object.freeze([
  Object.freeze({ laptopUuid: uuid, from: Status.IN_STOCK, to: Status.SOLD, date: saleDate }),
]);

function fixture(status: Status): Laptop {
  return Object.freeze({ uuid, status });
}

function expectNoWrites() {
  expect(persistence.updateLaptop).not.toHaveBeenCalled();
  expect(persistence.addHistoryEntry).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.spyOn(persistence, "updateLaptop");
  vi.spyOn(persistence, "addHistoryEntry");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("transition matrix", () => {
  const cases: [Status, Status, boolean][] = [
    [Status.IN_STOCK, Status.IN_STOCK, false],
    [Status.IN_STOCK, Status.RESERVED, true],
    [Status.IN_STOCK, Status.SOLD, true],
    [Status.IN_STOCK, Status.WRITTEN_OFF, true],
    [Status.RESERVED, Status.IN_STOCK, true],
    [Status.RESERVED, Status.RESERVED, false],
    [Status.RESERVED, Status.SOLD, true],
    [Status.RESERVED, Status.WRITTEN_OFF, false],
    [Status.SOLD, Status.IN_STOCK, true],
    [Status.SOLD, Status.RESERVED, false],
    [Status.SOLD, Status.SOLD, false],
    [Status.SOLD, Status.WRITTEN_OFF, false],
    [Status.WRITTEN_OFF, Status.IN_STOCK, false],
    [Status.WRITTEN_OFF, Status.RESERVED, false],
    [Status.WRITTEN_OFF, Status.SOLD, false],
    [Status.WRITTEN_OFF, Status.WRITTEN_OFF, false],
  ];

  it.each(cases)("%s → %s (allowed: %s)", async (from, to, allowed) => {
    const laptop = fixture(from);
    const historyBefore = structuredClone(saleHistory);
    const result = await changeStatus(laptop, to, saleHistory, now);

    expect(laptop).toEqual({ uuid, status: from });
    expect(saleHistory).toEqual(historyBefore);
    expect(result.ok).toBe(allowed);
    if (result.ok) {
      const historyEntry = { laptopUuid: uuid, from, to, date: now.toISOString() };
      expect(result.laptop).not.toBe(laptop);
      expect(result).toEqual({ ok: true, laptop: { uuid, status: to }, historyEntry });
      expect(persistence.updateLaptop).toHaveBeenCalledExactlyOnceWith({ uuid, status: to });
      expect(persistence.addHistoryEntry).toHaveBeenCalledExactlyOnceWith(historyEntry);
    } else {
      expect(result.error).toContain("Недопустимый переход");
      expect(result.error).toContain(`${from} → ${to}`);
      expectNoWrites();
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
  ])("%s", async (_label, date, allowed) => {
    const laptop = fixture(Status.SOLD);
    const before = structuredClone(saleHistory);
    const result = await changeStatus(laptop, Status.IN_STOCK, saleHistory, new Date(date));

    expect(laptop).toEqual(fixture(Status.SOLD));
    expect(saleHistory).toEqual(before);
    expect(result.ok).toBe(allowed);
    if (result.ok) {
      expect(result.historyEntry).toEqual({
        laptopUuid: uuid, from: Status.SOLD, to: Status.IN_STOCK, date,
      });
      expect(persistence.addHistoryEntry).toHaveBeenCalledExactlyOnceWith(result.historyEntry);
    } else {
      expect(result.error).toContain("14 дней");
      expectNoWrites();
    }
  });

  it("rejects a return before the sale", async () => {
    const result = await changeStatus(
      fixture(Status.SOLD), Status.IN_STOCK, saleHistory,
      new Date("2026-01-01T11:59:59.999Z"),
    );
    expect(result).toEqual({ ok: false, error: "Дата возврата не может быть раньше даты продажи." });
    expectNoWrites();
  });

  it.each([
    { history: [] },
    { history: [{ laptopUuid: uuid, from: Status.IN_STOCK, to: Status.RESERVED, date: saleDate }] },
    { history: [{ laptopUuid: otherUuid, from: Status.IN_STOCK, to: Status.SOLD, date: saleDate }] },
  ])("rejects missing sale history for this laptop: $history", async ({ history }) => {
    const before = structuredClone(history);
    expect(await changeStatus(fixture(Status.SOLD), Status.IN_STOCK, history, now)).toEqual({
      ok: false,
      error: "Дата последней продажи отсутствует или некорректна.",
    });
    expect(history).toEqual(before);
    expectNoWrites();
  });

  it("rejects an invalid latest sale date instead of using an earlier sale", async () => {
    const history: HistoryEntry[] = [
      ...saleHistory,
      { laptopUuid: uuid, from: Status.SOLD, to: Status.IN_STOCK, date: saleDate },
      { laptopUuid: uuid, from: Status.IN_STOCK, to: Status.SOLD, date: "invalid" },
    ];
    const before = structuredClone(history);
    expect(await changeStatus(fixture(Status.SOLD), Status.IN_STOCK, history, now)).toEqual({
      ok: false,
      error: "Дата последней продажи отсутствует или некорректна.",
    });
    expect(history).toEqual(before);
    expectNoWrites();
  });

  it("does not extend a return window using another laptop's sale", async () => {
    const history: HistoryEntry[] = [
      ...saleHistory,
      { laptopUuid: otherUuid, from: Status.IN_STOCK, to: Status.SOLD, date: "2026-02-01T12:00:00.000Z" },
    ];
    const result = await changeStatus(
      fixture(Status.SOLD), Status.IN_STOCK, history, new Date("2026-02-02T12:00:00.000Z"),
    );
    expect(result).toEqual({ ok: false, error: "Возврат возможен не позднее 14 дней после продажи." });
    expectNoWrites();
  });

  it("measures elapsed time across timezone offsets", async () => {
    const history: HistoryEntry[] = [{
      laptopUuid: uuid, from: Status.IN_STOCK, to: Status.SOLD, date: "2026-01-01T15:00:00+03:00",
    }];
    const result = await changeStatus(
      fixture(Status.SOLD), Status.IN_STOCK, history, new Date("2026-01-15T07:00:00-05:00"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.historyEntry.date).toBe("2026-01-15T12:00:00.000Z");
  });
});

describe("history and time", () => {
  it("records the full lifecycle and starts a fresh return window after resale", async () => {
    const initial = fixture(Status.IN_STOCK);
    const steps: [Status, string][] = [
      [Status.RESERVED, "2026-01-01T12:00:00.000Z"],
      [Status.SOLD, "2026-01-02T12:00:00.000Z"],
      [Status.IN_STOCK, "2026-01-03T12:00:00.000Z"],
      [Status.SOLD, "2026-02-01T12:00:00.000Z"],
      [Status.IN_STOCK, "2026-02-15T12:00:00.000Z"],
      [Status.WRITTEN_OFF, "2026-02-16T12:00:00.000Z"],
    ];
    let laptop = initial;
    const history: HistoryEntry[] = [];
    for (const [status, date] of steps) {
      const result = await changeStatus(laptop, status, history, new Date(date));
      if (!result.ok) throw new Error(result.error);
      laptop = result.laptop;
      history.push(result.historyEntry);
    }

    expect(initial).toEqual({ uuid, status: Status.IN_STOCK });
    expect(laptop).toEqual({ uuid, status: Status.WRITTEN_OFF });
    expect(history).toEqual([
      { laptopUuid: uuid, from: Status.IN_STOCK, to: Status.RESERVED, date: steps[0]![1] },
      { laptopUuid: uuid, from: Status.RESERVED, to: Status.SOLD, date: steps[1]![1] },
      { laptopUuid: uuid, from: Status.SOLD, to: Status.IN_STOCK, date: steps[2]![1] },
      { laptopUuid: uuid, from: Status.IN_STOCK, to: Status.SOLD, date: steps[3]![1] },
      { laptopUuid: uuid, from: Status.SOLD, to: Status.IN_STOCK, date: steps[4]![1] },
      { laptopUuid: uuid, from: Status.IN_STOCK, to: Status.WRITTEN_OFF, date: steps[5]![1] },
    ]);
    expect(persistence.updateLaptop).toHaveBeenCalledTimes(6);
    expect(vi.mocked(persistence.addHistoryEntry).mock.calls.map(([entry]) => entry)).toEqual(history);
  });

  it("uses the current time by default", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(await changeStatus(fixture(Status.IN_STOCK), Status.SOLD, [])).toEqual({
      ok: true,
      laptop: { uuid, status: Status.SOLD },
      historyEntry: { laptopUuid: uuid, from: Status.IN_STOCK, to: Status.SOLD, date: now.toISOString() },
    });
  });

  it("rejects an invalid change date without changing the input", async () => {
    const laptop = fixture(Status.IN_STOCK);
    expect(await changeStatus(laptop, Status.SOLD, [], new Date(NaN))).toEqual({
      ok: false, error: "Некорректная дата изменения статуса.",
    });
    expect(laptop).toEqual({ uuid, status: Status.IN_STOCK });
    expectNoWrites();
  });

  it("captures the timestamp before awaiting writes", async () => {
    const date = new Date(saleDate);
    const pending = changeStatus(fixture(Status.IN_STOCK), Status.RESERVED, [], date);
    date.setUTCFullYear(2030);
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.historyEntry.date).toBe(saleDate);
  });
});

describe("async persistence calls", () => {
  it("awaits the laptop update before history, and both writes before success", async () => {
    let finishUpdate!: (laptop: Laptop) => void;
    let finishHistory!: (entry: HistoryEntry) => void;
    vi.mocked(persistence.updateLaptop).mockReturnValue(new Promise((resolve) => { finishUpdate = resolve; }));
    vi.mocked(persistence.addHistoryEntry).mockReturnValue(new Promise((resolve) => { finishHistory = resolve; }));

    let settled = false;
    const pending = changeStatus(fixture(Status.IN_STOCK), Status.SOLD, [], now)
      .then((result) => { settled = true; return result; });

    expect(persistence.updateLaptop).toHaveBeenCalledExactlyOnceWith({ uuid, status: Status.SOLD });
    expect(persistence.addHistoryEntry).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    finishUpdate({ uuid, status: Status.SOLD });
    await vi.waitFor(() => expect(persistence.addHistoryEntry).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);

    const entry = { laptopUuid: uuid, from: Status.IN_STOCK, to: Status.SOLD, date: now.toISOString() };
    finishHistory(entry);
    await expect(pending).resolves.toEqual({ ok: true, laptop: { uuid, status: Status.SOLD }, historyEntry: entry });
  });

  it("propagates a laptop update failure without writing history", async () => {
    const error = new Error("Laptop update failed");
    vi.mocked(persistence.updateLaptop).mockRejectedValue(error);
    await expect(changeStatus(fixture(Status.IN_STOCK), Status.SOLD, [], now)).rejects.toBe(error);
    expect(persistence.addHistoryEntry).not.toHaveBeenCalled();
  });

  it("propagates a history write failure instead of reporting success", async () => {
    const error = new Error("History insert failed");
    vi.mocked(persistence.addHistoryEntry).mockRejectedValue(error);
    await expect(changeStatus(fixture(Status.IN_STOCK), Status.SOLD, [], now)).rejects.toBe(error);
    expect(persistence.updateLaptop).toHaveBeenCalledTimes(1);
    expect(persistence.addHistoryEntry).toHaveBeenCalledTimes(1);
  });
});
