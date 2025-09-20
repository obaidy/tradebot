import util from 'util';
import axios from 'axios';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogMeta = Record<string, unknown> | undefined;

function serializeMeta(meta: LogMeta) {
  if (!meta) return {};
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value instanceof Error) {
      serialized[key] = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    } else if (typeof value === 'object' && value !== null) {
      serialized[key] = JSON.parse(JSON.stringify(value, (_key, val) => {
        if (val instanceof Error) {
          return { name: val.name, message: val.message, stack: val.stack };
        }
        return val;
      }));
    } else {
      serialized[key] = value;
    }
  }
  return serialized;
}

let ingestionWebhook: string | null = null;
let baseMeta: Record<string, unknown> = {};

function emit(level: LogLevel, msg: string, meta?: LogMeta) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...baseMeta,
    ...serializeMeta(meta),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else if (level === 'debug') {
    if (typeof console.debug === 'function') {
      console.debug(line);
    } else {
      console.log(line);
    }
  } else {
    console.log(line);
  }

  if (ingestionWebhook) {
    axios
      .post(ingestionWebhook, entry, { timeout: 2000 })
      .catch(() => {});
  }
}

export const logger = {
  debug(msg: string, meta?: LogMeta) {
    emit('debug', msg, meta);
  },
  info(msg: string, meta?: LogMeta) {
    emit('info', msg, meta);
  },
  warn(msg: string, meta?: LogMeta) {
    emit('warn', msg, meta);
  },
  error(msg: string, meta?: LogMeta) {
    emit('error', msg, meta);
  },
  format(obj: unknown) {
    return util.inspect(obj, { depth: null, colors: false });
  },
};

export type Logger = typeof logger;

export function setLogIngestionWebhook(url: string | null) {
  ingestionWebhook = url;
}

export function setLogContext(meta: Record<string, unknown>) {
  baseMeta = { ...meta };
}

export function clearLogContext() {
  baseMeta = {};
}
