import { AppError } from "./errors.ts";

declare const tenantIdBrand: unique symbol;

/**
 * A validated tenant identifier. The brand means a plain string cannot be
 * passed where a tenant is required: the only way to obtain one is
 * `parseTenantId`, so every tenant-scoped call site has checked its input.
 */
export type TenantId = string & { readonly [tenantIdBrand]: "TenantId" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class InvalidTenantIdError extends AppError {
  readonly code = "TENANT_ID_INVALID";

  constructor() {
    super("A tenant id must be a UUID.");
    this.name = "InvalidTenantIdError";
  }
}

export function parseTenantId(value: string): TenantId {
  const normalised = value.toLowerCase();
  if (!UUID.test(normalised)) throw new InvalidTenantIdError();
  return normalised as TenantId;
}
