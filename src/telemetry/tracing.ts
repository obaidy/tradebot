import { context, trace, Span, SpanStatusCode, SpanAttributes } from '@opentelemetry/api';

const tracer = trace.getTracer('tradebot');

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: SpanAttributes = {}
) {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function startSpan(name: string, attributes: SpanAttributes = {}) {
  return tracer.startSpan(name, { attributes }, context.active());
}
