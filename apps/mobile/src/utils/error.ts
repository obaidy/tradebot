export function formatApiError(error: unknown, fallback = 'Request failed'): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;

  if (typeof (error as { message?: string }).message === 'string') {
    return (error as { message: string }).message;
  }

  if (typeof (error as { status?: unknown }).status !== 'undefined') {
    const base = error as { status: unknown; data?: unknown };
    const data = base.data;

    if (typeof data === 'string' && data.length) {
      return data;
    }
    if (data && typeof data === 'object') {
      const maybe = data as { error?: unknown; message?: unknown };
      if (typeof maybe.error === 'string' && maybe.error.length) {
        return maybe.error;
      }
      if (typeof maybe.message === 'string' && maybe.message.length) {
        return maybe.message;
      }
    }
    return `${fallback} (${String(base.status)})`;
  }

  return fallback;
}
