import "server-only";

import { z } from "zod";

import { HttpError } from "./errors";

const optionalTrimmed = z.string().trim().max(500).optional();

const customerSchema = z
  .object({
    email: z.string().trim().email().max(320),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    countryCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase())
      .optional(),
    phone: optionalTrimmed,
    company: optionalTrimmed,
    addressLine1: optionalTrimmed,
    addressLine2: optionalTrimmed,
    city: optionalTrimmed,
    state: optionalTrimmed,
    postalCode: optionalTrimmed,
    taxId: optionalTrimmed,
  })
  .strict();

export const previewRequestSchema = z
  .object({
    channelSlug: z.string().trim().min(1).max(100),
    customer: customerSchema,
    items: z
      .array(
        z
          .object({
            productId: z.string().trim().min(1).max(100),
            quantity: z.number().int().min(1).max(100),
            targetId: optionalTrimmed,
            targetHost: optionalTrimmed,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    referralCode: z.string().trim().max(100).optional(),
  })
  .strict();

export const confirmRequestSchema = z
  .object({
    previewId: z.string().trim().min(1).max(100),
  })
  .strict();

export const paymentRequestSchema = z
  .object({
    orderId: z.string().trim().min(1).max(100),
  })
  .strict();

export function parseInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue?.path.length
      ? `${issue.path.join(".")}: `
      : "";
    throw new HttpError(
      400,
      "invalid_request",
      `${location}${issue?.message ?? "The request is invalid."}`,
    );
  }

  return result.data;
}
