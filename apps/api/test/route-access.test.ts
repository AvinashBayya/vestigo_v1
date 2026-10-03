/**
 * RELEASE-BLOCKING. Every route declares the permission it requires (or why
 * it is public). An undeclared route stops the app from starting.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isPermission } from "@repo/access";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { enforceRouteAccess, RouteAccessError, type DeclaredRoute } from "../src/http/access.ts";
import { accessServicesFor } from "../src/services.ts";

function bareApp() {
  const app = Fastify({ exposeHeadRoutes: false });
  enforceRouteAccess(app, () => accessServicesFor(null), []);
  return app;
}

describe("route access declarations (RELEASE-BLOCKING)", () => {
  it("refuses to register a route with no declared access", () => {
    const app = bareApp();
    expect(() => app.get("/api/v1/undeclared", () => ({ leaked: true }))).toThrow(RouteAccessError);
  });

  it("refuses an unknown permission", () => {
    const app = bareApp();
    expect(() =>
      app.get(
        "/api/v1/typo",
        // @ts-expect-error -- "investigations:read" is not a catalogued permission
        { config: { access: { permission: "investigations:read", action: "typo.read" } } },
        () => ({}),
      ),
    ).toThrow(RouteAccessError);
  });

  it("refuses a public route that does not say why", () => {
    const app = bareApp();
    expect(() =>
      app.get("/api/v1/open", { config: { access: { public: "" } } }, () => ({})),
    ).toThrow(RouteAccessError);
  });

  it("every route of the real app declares access; only the listed routes are public", async () => {
    const app = await buildApp({ logger: false, services: null });
    await app.ready();
    const routes: readonly DeclaredRoute[] = app.declaredRoutes;
    expect(routes.length).toBeGreaterThan(5);

    const publicRoutes = routes.filter((route) => "public" in route.access);
    expect(publicRoutes.map((route) => `${route.method} ${route.url}`).sort()).toEqual([
      "GET /api/v1/openapi.json",
      "GET /api/v1/session",
      "GET /health",
      "POST /api/auth/organization/accept-invitation",
      "POST /api/auth/sign-up/email",
      "POST /api/v1/session/mfa/enrolment",
      "POST /api/v1/session/mfa/enrolment/confirm",
      "POST /api/v1/session/mfa/verify",
      "POST /api/v1/session/sign-in",
      "POST /api/v1/session/sign-out",
      "POST /api/v1/session/tenant",
    ]);
    for (const route of routes) {
      if ("permission" in route.access) expect(isPermission(route.access.permission)).toBe(true);
    }
    await app.close();
  });

  it("an app without services refuses protected requests instead of answering them", async () => {
    const app = await buildApp({ logger: false, services: null });
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({ code: "NOT_IMPLEMENTED" });
    await app.close();
  });
});

describe("authorisation is by permission, never by role name (RELEASE-BLOCKING)", () => {
  it("no source file outside the role-to-permission map compares a role name", async () => {
    const roots = [
      join(import.meta.dirname, "..", "src"),
      join(import.meta.dirname, "..", "..", "..", "packages"),
    ];
    const comparison =
      /[!=]==?\s*["'](owner|admin|analyst|viewer)["']|["'](owner|admin|analyst|viewer)["']\s*[!=]==?|\.role\s*[!=]==?/;
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (["node_modules", "dist", "test"].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          const text = await readFile(path, "utf8");
          text.split("\n").forEach((line, index) => {
            if (comparison.test(line))
              offenders.push(`${path}:${String(index + 1)}: ${line.trim()}`);
          });
        }
      }
    };
    for (const root of roots) await walk(root);
    expect(offenders).toEqual([]);
  });
});
