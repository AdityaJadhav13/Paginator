// The local demo in one command (docs/DEVELOPMENT.md "The local demo"): the phone smoke's whole stack (stack.ts: Postgres,
// SeaweedFS, Mailpit, the API, the engine's queue, the page editor's edit gateway and the web app's production build on `vite preview`), left running until Ctrl-C,
// which removes it with its volumes. Same settings as the smoke (PGN_E2E_WORKER_PY, PGN_E2E_PORT_BASE, PGN_ENGINE_PYTHON…).
import { MAILPIT, OWNER, startStack, WEB } from "./stack.ts";

const teardown = await startStack(true); // the production build, as deployed: no development-only screens
console.log(`The demo is up: ${WEB}. The Owner (${OWNER.email}) chooses a password from the welcome email`);
console.log(`in Mailpit, ${MAILPIT.replace(/\/api\/v1$/, "")}. Ctrl-C stops the demo and removes it.`);
const stop = async () => {
  try {
    await teardown();
  } finally {
    process.exit(0);
  }
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
setInterval(() => {}, 1 << 30); // keeps the process alive until a stop signal
