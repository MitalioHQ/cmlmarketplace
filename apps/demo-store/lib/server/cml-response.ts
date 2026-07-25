import "server-only";

import type { Money } from "@cml-marketplace/core";

export type UnknownRecord = Record<string, unknown>;

export function extractCmlOrder(raw: unknown): UnknownRecord {
  const root = asRecord(raw);
  const success = asRecord(root.success);
  const candidates = [
    asRecord(root.data).order,
    asRecord(success.data).order,
    success.order,
    root.order,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const first = candidate[0];
      if (first && typeof first === "object") {
        return asRecord(first);
      }
      continue;
    }

    if (candidate && typeof candidate === "object") {
      const record = asRecord(candidate);
      const returning = Array.isArray(record.returning)
        ? record.returning[0]
        : undefined;
      return returning && typeof returning === "object"
        ? asRecord(returning)
        : record;
    }
  }

  return root;
}

export function extractCmlWarnings(raw: unknown): string[] {
  const root = asRecord(raw);
  const success = asRecord(root.success);
  const warnings = Array.isArray(root.warnings)
    ? root.warnings
    : Array.isArray(success.warnings)
      ? success.warnings
      : [];

  return warnings.filter(
    (value): value is string => typeof value === "string",
  );
}

export function parseCmlMoney(
  value: unknown,
  currency: string,
  fallbackMinor = 0,
): Money {
  if (value === undefined || value === null || value === "") {
    return { amountMinor: fallbackMinor, currency };
  }

  const normalized = String(value)
    .trim()
    .replaceAll(",", "")
    .replace(/[^\d.-]/g, "");
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,}))?$/);

  if (!match) {
    return { amountMinor: fallbackMinor, currency };
  }

  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2] ?? 0);
  const fraction = `${match[3] ?? ""}00`.slice(0, 2);
  return {
    amountMinor: sign * (whole * 100 + Number(fraction)),
    currency,
  };
}

export function formatCmlAmount(money: Money): string {
  const amountMinor = Number(money.amountMinor);

  if (!Number.isSafeInteger(amountMinor)) {
    throw new TypeError("CML payment money requires an integer minor amount.");
  }

  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  return `${sign}${Math.floor(absolute / 100)}.${String(
    absolute % 100,
  ).padStart(2, "0")}`;
}

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asPositiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}
