// Registro estructurado: en Cloudflare se ve en «Workers → Logs» (o `npx wrangler tail`).
const errors = (key, value) => (value instanceof Error ? { message: value.message, stack: value.stack } : value);

const out = (level, message, data) => {
  const line = JSON.stringify({ level, message, ...(data === undefined ? {} : { data }) }, errors);
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
};

export const logger = {
  info: (message, data) => out('info', message, data),
  warn: (message, data) => out('warn', message, data),
  error: (message, data) => out('error', message, data),
};
