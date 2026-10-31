import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.js';

test('initial plugin exposes only a read-only status and reports editing unavailable', async () => {
  const registered = [];
  apply({ tools: { register: tool => registered.push(tool) } });
  assert.equal(registered.length, 1);
  const tool = registered[0];
  const result = await tool.execute({}, {});
  assert.equal(result.stage, 'initialization');
  assert.equal(result.editor_available, false);
  assert.equal(result.cloud_connected, false);
  const content = tool.output.render({}, result);
  assert.deepEqual(JSON.parse(content[0].text), result);
});
