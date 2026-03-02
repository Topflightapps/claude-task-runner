import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { options: { destination: 1 }, target: "pino/file" }
      : undefined,
});

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}
