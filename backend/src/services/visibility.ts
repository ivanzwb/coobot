type VisibleClientIdsValue = string | string[] | null | undefined;

interface VisibilityShape {
  originClientId?: string | null;
  syncPolicy?: string | null;
  visibleClientIds?: VisibleClientIdsValue;
  displayScope?: string | null;
  payload?: string | Record<string, unknown> | null;
}

function parseJsonObject(value: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function getClientNamespace(clientId?: string | null) {
  if (!clientId) {
    return null;
  }

  const separatorIndex = clientId.indexOf('-');
  if (separatorIndex <= 0) {
    return clientId;
  }

  return clientId.slice(0, separatorIndex);
}

function sharesClientNamespace(left?: string | null, right?: string | null) {
  const leftNamespace = getClientNamespace(left);
  const rightNamespace = getClientNamespace(right);
  return Boolean(leftNamespace && rightNamespace && leftNamespace === rightNamespace);
}

export function parseVisibleClientIds(value: VisibleClientIdsValue): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

export function resolveVisibleClientIds(originClientId?: string | null, visibleClientIds?: string[]): string[] {
  if (visibleClientIds && visibleClientIds.length > 0) {
    return visibleClientIds;
  }

  return originClientId ? [originClientId] : [];
}

export function resolveDisplayScope(syncPolicy?: string | null, visibleClientIds?: string[]): string {
  if (syncPolicy === 'all_clients') {
    return 'all_clients';
  }

  if (visibleClientIds && visibleClientIds.length > 1) {
    return 'synced_clients';
  }

  return 'origin_only';
}

export function isRecordVisibleToClient(record: VisibilityShape, clientId: string): boolean {
  const payload = parseJsonObject(record.payload);
  const payloadVisibleClientIds = parseVisibleClientIds(payload.visibleClientIds as VisibleClientIdsValue);
  const visibleClientIds = payloadVisibleClientIds.length > 0
    ? payloadVisibleClientIds
    : parseVisibleClientIds(record.visibleClientIds);
  const originClientId = typeof payload.originClientId === 'string'
    ? payload.originClientId
    : record.originClientId;
  const displayScope = typeof payload.displayScope === 'string'
    ? payload.displayScope
    : record.displayScope;
  const syncPolicy = typeof payload.syncPolicy === 'string'
    ? payload.syncPolicy
    : record.syncPolicy;

  if (!originClientId && !displayScope && !syncPolicy && visibleClientIds.length === 0) {
    return true;
  }

  if (displayScope === 'all_clients' || syncPolicy === 'all_clients') {
    return true;
  }

  if (visibleClientIds.length > 0) {
    return visibleClientIds.includes(clientId)
      || visibleClientIds.some((visibleClientId) => sharesClientNamespace(visibleClientId, clientId));
  }

  return originClientId === clientId || sharesClientNamespace(originClientId, clientId);
}