// The local demo in one command (docs/DEVELOPMENT.md "The local demo"): the phone smoke's whole stack (stack.ts: Postgres,
// SeaweedFS, Mailpit, the API, the engine's queue, the page editor's edit gateway and Vite), left running until Ctrl-C,
// which removes it with its volumes. Same settings as the smoke (PGN_E2E_WORKER_PY, PGN_E2E_PORT_BASE, PGN_ENGINE_PYTHON…).
import stack, { MAILPIT, OWNER, WEB } from "./stack.ts";

const teardown = await stack();
console.log(`The demo is up: ${WEB}. The Owner (${OWNER.email}) confirms the address and chooses a password from`);
console.log(`the emails in Mailpit, ${MAILPIT.replace(/\/api\/v1$/, "")}. Ctrl-C stops the demo and removes it.`);
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
