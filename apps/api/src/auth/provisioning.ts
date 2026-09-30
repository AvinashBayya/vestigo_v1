import { parseTenantId, type TenantId, type TenantRegion } from "@repo/core";
import type { AuthStore } from "@repo/db";
import {
  issueEnrolmentToken,
  PROVISIONING_ENROLMENT_TTL_MS,
  provisioningContext,
  type Auth,
} from "./better-auth.ts";

export interface ProvisionTenantInput {
  readonly name: string;
  /** Unique, URL-safe tenant handle. */
  readonly slug: string;
  readonly region: TenantRegion;
  readonly owner: { readonly email: string; readonly name: string; readonly password: string };
  /** Who ran the provisioning, recorded in the tenant's audit log. */
  readonly operator: string;
}

export interface ProvisionedTenant {
  readonly tenantId: TenantId;
  readonly ownerUserId: string;
  /**
   * The owner's one-time MFA enrolment token, shown once to the operator to
   * hand over with the password. Without it the owner cannot enrol.
   */
  readonly enrolmentToken: string;
}

/**
 * Creates a tenant and its first owner. This is an operator action: sign-up
 * is otherwise invitation-only, and nobody can create an organisation through
 * the API. The organisation's id becomes the tenant id; the provider's
 * after-create hook writes the tenant row, the owner's profile and an audit
 * row in the new tenant.
 *
 * The new tenant starts on the default plan with vetting not submitted.
 * Nothing here can grant a plan or approve vetting.
 */
export async function provisionTenant(
  auth: Auth,
  authStore: AuthStore,
  input: ProvisionTenantInput,
): Promise<ProvisionedTenant> {
  return provisioningContext.run({ operator: input.operator }, async () => {
    const signUp = await auth.api.signUpEmail({
      body: { email: input.owner.email, name: input.owner.name, password: input.owner.password },
    });
    const organization = await auth.api.createOrganization({
      body: {
        name: input.name,
        slug: input.slug,
        userId: signUp.user.id,
        metadata: { region: input.region },
      },
    });
    const { token, hash } = issueEnrolmentToken();
    await authStore.setUnenrolledUserToken(
      { userId: signUp.user.id },
      hash,
      new Date(Date.now() + PROVISIONING_ENROLMENT_TTL_MS),
    );
    return {
      tenantId: parseTenantId(organization.id),
      ownerUserId: signUp.user.id,
      enrolmentToken: token,
    };
  });
}
