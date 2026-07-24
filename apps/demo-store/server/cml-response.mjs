export function extractCmlOrder(raw) {
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
        return first;
      }
      continue;
    }

    if (candidate && typeof candidate === "object") {
      const record = asRecord(candidate);
      const returning = Array.isArray(record.returning)
        ? record.returning[0]
        : undefined;
      return returning && typeof returning === "object"
        ? returning
        : record;
    }
  }

  return root;
}

export function extractCmlWarnings(raw) {
  const root = asRecord(raw);
  const success = asRecord(root.success);
  const warnings = Array.isArray(root.warnings)
    ? root.warnings
    : Array.isArray(success.warnings)
      ? success.warnings
      : [];

  return warnings.filter((value) => typeof value === "string");
}

export function parseCmlMoney(value, currency, fallbackMinor = 0) {
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
  const fraction = `${match[3] ?? ""}00`.slice(0, 2);
  return {
    amountMinor: sign * (Number(match[2]) * 100 + Number(fraction)),
    currency,
  };
}

export function formatCmlAmount(money) {
  const amountMinor = Number(money?.amountMinor);

  if (!Number.isSafeInteger(amountMinor)) {
    throw new TypeError("CML payment money requires an integer minor amount.");
  }

  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  return `${sign}${Math.floor(absolute / 100)}.${String(
    absolute % 100,
  ).padStart(2, "0")}`;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
