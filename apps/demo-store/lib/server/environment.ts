import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnvConfig } from "@next/env";

let environmentLoaded = false;

export interface DemoEnvironment {
  apiKey: string;
  apiSecret: string;
  apiBaseUrl?: string;
  channelSlug: string;
  defaultCountry: string;
  databaseUrl?: string;
  mutationsEnabled: boolean;
  allowedOrigins: readonly string[];
  production: boolean;
}

export function readEnvironment(): DemoEnvironment {
  loadWorkspaceEnvironment();
  const databaseUrl = optional("DATABASE_URL");

  return {
    apiKey: optional("CML_API_KEY") ?? "",
    apiSecret: optional("CML_API_SECRET") ?? "",
    ...(optional("CML_API_BASE_URL")
      ? { apiBaseUrl: optional("CML_API_BASE_URL") }
      : {}),
    channelSlug: optional("CML_CHANNEL_SLUG") ?? "northstar",
    defaultCountry: normalizeConfiguredCountry(
      optional("CML_DEFAULT_COUNTRY") ?? "FR",
    ),
    ...(databaseUrl ? { databaseUrl } : {}),
    mutationsEnabled:
      optional("CML_DEMO_MUTATIONS_ENABLED")?.toLowerCase() === "true",
    allowedOrigins: (optional("CML_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    production: process.env.NODE_ENV === "production",
  };
}

function loadWorkspaceEnvironment(): void {
  if (environmentLoaded) {
    return;
  }

  const currentDirectory = process.cwd();
  const workspaceCandidate = resolve(currentDirectory, "../..");
  const workspaceRoot = existsSync(
    resolve(currentDirectory, "packages/core/package.json"),
  )
    ? currentDirectory
    : existsSync(resolve(workspaceCandidate, "packages/core/package.json"))
      ? workspaceCandidate
      : currentDirectory;

  loadEnvConfig(
    workspaceRoot,
    process.env.NODE_ENV === "development",
    console,
    true,
  );
  environmentLoaded = true;
}

export function isCmlConfigured(environment = readEnvironment()): boolean {
  return Boolean(environment.apiKey && environment.apiSecret);
}

export function isCheckoutConfigured(
  environment = readEnvironment(),
): boolean {
  return Boolean(environment.databaseUrl || !environment.production);
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function normalizeConfiguredCountry(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "FR";
}
