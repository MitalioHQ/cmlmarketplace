import type { Money } from "./types.js";

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function assertMoney(money: Money): void {
  if (!Number.isSafeInteger(money.amountMinor)) {
    throw new TypeError("Money amountMinor must be a safe integer.");
  }

  if (!CURRENCY_PATTERN.test(money.currency)) {
    throw new TypeError("Money currency must be an uppercase ISO 4217 code.");
  }
}

export function createMoney(amountMinor: number, currency: string): Money {
  const money = {
    amountMinor,
    currency: currency.toUpperCase(),
  };

  assertMoney(money);
  return money;
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return createMoney(left.amountMinor + right.amountMinor, left.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return createMoney(left.amountMinor - right.amountMinor, left.currency);
}

export function multiplyMoney(money: Money, quantity: number): Money {
  assertMoney(money);

  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new TypeError("Money quantity must be a non-negative safe integer.");
  }

  return createMoney(money.amountMinor * quantity, money.currency);
}

export function zeroMoney(currency: string): Money {
  return createMoney(0, currency);
}

export function formatMoney(
  money: Money,
  locale = "en-US",
  options: Omit<Intl.NumberFormatOptions, "currency" | "style"> = {},
): string {
  assertMoney(money);

  return new Intl.NumberFormat(locale, {
    ...options,
    style: "currency",
    currency: money.currency,
  }).format(money.amountMinor / 100);
}

function assertSameCurrency(left: Money, right: Money): void {
  assertMoney(left);
  assertMoney(right);

  if (left.currency !== right.currency) {
    throw new TypeError(
      `Cannot combine ${left.currency} and ${right.currency} money values.`,
    );
  }
}

