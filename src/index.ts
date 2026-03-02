import { loadConfig } from "./config.js";
import { initDb, markStaleRunsAsFailed } from "./db.js";
import { createChildLogger } from "./logger.js";
import { startWebhookServer } from "./webhook.js";

const log = createChildLogger("main");

function main() {
  log.info("Claude Task Runner starting...");

  const config = loadConfig();
  log.info(
    { port: config.WEBHOOK_PORT, workDir: config.WORK_DIR },
    "Config loaded",
  );

  initDb();
  markStaleRunsAsFailed();

  startWebhookServer();

  const shutdown = () => {
    log.info("Shutting down...");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
