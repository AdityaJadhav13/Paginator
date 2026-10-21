// buildApp(deps): the Fastify instance with its plugins and routes, not yet listening (tests drive it with inject).
// Every error answer is an envelope with a request id and the baseline headers, except three that are written raw:
//   - Fastify's 503 while the server is closing (return503OnClosing);
//   - Node's 400 for an HTTP/1.1 request without a Host header, and its 417 for an Expect other than 100-continue.
// Browsers never send either of the last two.
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "./config.ts";
import { REQUEST_ID_HEADER, childLoggerFactory, requestId } from "./http/context.ts";
import { ApiError, clientErrorHandler, errorHandler, frameworkErrorHandler } from "./http/errors.ts";
import { health, type Checks } from "./http/health.ts";
import { registerSecurity } from "./http/security.ts";
import { closeWhenStopping } from "./shutdown.ts";

export type AppDeps = {
  config: Config;
  /** Dependency checks for /readyz; a dependency without one is reported as not configured. */
  checks: Checks;
};

export async function buildApp(deps: AppDeps) {
  const { config } = deps;
  const fastify = Fastify({
    logger: { level: config.logLevel },
    genReqId: requestId,
    childLoggerFactory,
    frameworkErrors: frameworkErrorHandler,
    clientErrorHandler,
    trustProxy: config.trustProxy.length > 0 ? config.trustProxy : false,
    bodyLimit: 1_048_576, // 1 MiB of JSON; a story's 200,000 characters of Devanagari are about 600 KB
    // A slow sender cannot hold a connection for ever. At 120 s a full 1 MiB body needs about 9 KB/s (a 600 KB story
    // about 5 KB/s); a phone on a poor link may manage less, so the story editor's autosave (PR 22) sends small bodies.
    requestTimeout: 120_000,
  });
  fastify.setErrorHandler(errorHandler);
  fastify.removeContentTypeParser("text/plain"); // bodies are JSON only

  // first, so that every answer carries the request id, including a refusal by a later hook
  fastify.addHook("onRequest", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
  fastify.addHook("onSend", closeWhenStopping);
  await registerSecurity(fastify, config);
  fastify.setNotFoundHandler(async () => {
    throw new ApiError("not_found");
  });

  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(health, { checks: deps.checks });
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
