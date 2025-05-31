// src/logger.ts

export function logInfo(message: string) {
  console.log(`[${getTimestamp()}] [INFO] ${message}`);
}

export function logWarn(message: string) {
  console.warn(`[${getTimestamp()}] [WARN] ${message}`);
}

export function logError(message: string) {
  console.error(`[${getTimestamp()}] [ERROR] ${message}`);
}

function getTimestamp(): string {
  return new Date().toISOString();
}
