export function resultValue(result) {
  let value = result.structuredContent;
  if (!value) for (const item of result.content ?? []) {
    if (item.type === 'text') { try { value = JSON.parse(item.text); break; } catch {} }
  }
  if (result.isError || value?.error) {
    const error = new Error(`${value?.error?.code ?? 'MCP_SERVICE_ERROR'}: ${value?.error?.message ?? 'The service rejected this operation. Preserve the original task and parameters.'}`);
    error.code = value?.error?.code ?? 'MCP_SERVICE_ERROR';
    error.serviceError = true;
    throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The MCP response did not contain a JSON object.');
  return value;
}
