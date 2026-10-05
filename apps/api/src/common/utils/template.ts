/** Minimal `{{variable}}` renderer used for dashboard-editable email / SMS templates. */
export const renderTemplate = (tpl: string, vars: Record<string, unknown> = {}) =>
  tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => String(key.split('.').reduce((o: any, k: string) => o?.[k], vars) ?? ''));
