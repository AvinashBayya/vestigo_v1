import { Validator } from "@seriousme/openapi-schema-validator";
import { PRODUCT_NAME } from "@repo/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "./app.ts";
import { HealthResponseSchema } from "./routes/health.ts";
import { OPENAPI_PATH } from "./routes/openapi.ts";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ logger: false });
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
        paths: z.record(
          z.string(),
          z.record(
            z.string(),
            z.object({
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
          ),
        ),
      })
      .parse(await fetchSpec());

    const operation = spec.paths["/health"]?.get;
    expect(operation?.operationId).toBe("getHealth");
    const documented = operation?.responses["200"]?.content["application/json"].schema;

    // Every expected value is read from the Zod schema, so a change to the
    // schema that the document did not pick up fails here.
    const status = HealthResponseSchema.shape.status;
    expect(documented?.required).toEqual(Object.keys(HealthResponseSchema.shape));
    expect(documented?.properties.status?.description).toBe(status.description);
    expect(documented?.properties.status?.enum).toEqual([...status.values]);
  });

  it("does not document the spec route itself", async () => {
    const spec = await fetchSpec();
    expect(Object.keys(spec.paths as object)).toEqual(["/health"]);
  });
});
