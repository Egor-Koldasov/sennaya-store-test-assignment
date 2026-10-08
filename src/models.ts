export enum Status {
  IN_STOCK = "IN_STOCK",
  RESERVED = "RESERVED",
  SOLD = "SOLD",
  WRITTEN_OFF = "WRITTEN_OFF",
}

export interface Laptop {
  readonly uuid: string;
  readonly status: Status;
}

export interface HistoryEntry {
  readonly laptopUuid: string;
  readonly from: Status;
  readonly to: Status;
  /** ISO 8601 timestamp in UTC. */
  readonly date: string;
}
