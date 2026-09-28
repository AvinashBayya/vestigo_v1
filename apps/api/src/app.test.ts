import { Validator } from "@seriousme/openapi-schema-validator";
import { PRODUCT_NAME } from "@repo/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "./app.ts";
import { HealthResponseSchema } from "./routes/health.ts";
import { OPENAPI_PATH } from "./routes/openapi.ts";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ logger: false, services: null });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("reports the process is serving", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe(`GET ${OPENAPI_PATH}`, () => {
  async function fetchSpec() {
    const response = await app.inject({ method: "GET", url: OPENAPI_PATH });
    expect(response.statusCode).toBe(200);
    return response.json<Record<string, unknown>>();
  }

  it("serves a document that validates against the OpenAPI 3.1 schema", async () => {
    const spec = await fetchSpec();
    const result = await new Validator().validate(spec);
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
    expect(spec.openapi).toBe("3.1.0");
  });

  it("takes its title from PRODUCT_NAME", async () => {
    const spec = await fetchSpec();
    expect(spec.info).toMatchObject({ title: `${PRODUCT_NAME} API` });
  });

  it("derives the /health response from the Zod schema the route serialises with", async () => {
    const DocumentedProperty = z.object({
      type: z.string(),
      description: z.string(),
      enum: z.array(z.unknown()),
    });
    const spec = z
      .object({
        // Only /health is parsed; other paths are left alone.
        paths: z.object({
          "/health": z.object({
            get: z.object({
              operationId: z.string(),
              responses: z.record(
                z.string(),
                z.object({
                  content: z.object({
                    "application/json": z.object({
                      schema: z.object({
                        properties: z.record(z.string(), DocumentedProperty),
                        required: z.array(z.string()),
                      }),
                    }),
                  }),
                }),
              ),
            }),
          }),
        }),
      })
      .parse(await fetchSpec());

    const operation = spec.paths["/health"].get;
    expect(operation.operationId).toBe("getHealth");
    const documented = operation.responses["200"]?.content["application/json"].schema;

    // Every expected value is read from the Zod schema, so a change to the
    // schema that the document did not pick up fails here.
    const status = HealthResponseSchema.shape.status;
    expect(documented?.required).toEqual(Object.keys(HealthResponseSchema.shape));
    expect(documented?.properties.status?.description).toBe(status.description);
    expect(documented?.properties.status?.enum).toEqual([...status.values]);
  });

  it("documents the API's routes, but not the spec route or the identity provider's", async () => {
    const spec = await fetchSpec();
    const paths = Object.keys(spec.paths as object);
    expect(paths).toContain("/health");
    expect(paths).toContain("/api/v1/me");
    expect(paths).toContain("/api/v1/person/search");
    expect(paths).not.toContain(OPENAPI_PATH);
    expect(paths.filter((path) => path.startsWith("/api/auth"))).toEqual([]);
  });

  it("declares how protected routes authenticate", async () => {
    const spec = z
      .object({
        components: z.object({ securitySchemes: z.record(z.string(), z.unknown()) }),
        paths: z.record(
          z.string(),
          z.record(z.string(), z.object({ security: z.unknown().optional() })),
        ),
      })
      .parse(await fetchSpec());
    expect(Object.keys(spec.components.securitySchemes).sort()).toEqual(["apiKey", "session"]);
    expect(spec.paths["/api/v1/me"]?.get?.security).toEqual([{ session: [] }, { apiKey: [] }]);
    expect(spec.paths["/health"]?.get?.security).toBeUndefined();
  });
});
