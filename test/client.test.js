import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { EDITOR_HOME, editorUrl } from '../src/client/urls.js';

test('button and command open the default browser without creating a sidebar editor', async () => {
  let registration;
  const opened = [];
  const listeners = new Map();
  const sandbox = { URL, window: {
    __ModuleLoader__: { load: value => { registration = value; } },
    open: (...args) => opened.push(args),
  }, document: {
    addEventListener: (type, handler, capture) => { assert.equal(type, 'click'); assert.equal(capture, true); listeners.set(type, handler); },
    removeEventListener: (type, handler, capture) => { assert.equal(capture, true); assert.equal(listeners.get(type), handler); listeners.delete(type); },
  } };
  vm.runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), sandbox);
  assert.equal(registration.id, 'dsh-image-editor');
  const api = registration.factory(name => {
    if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props, children }) };
    throw new Error(`Unexpected host dependency: ${name}`);
  });
  const entries = []; const commands = []; const effects = []; let messages;
  const ctx = {
    locale: { bind: () => key => messages.zh[key], register: (_id, value) => { messages = value; return () => {}; } },
    slots: {
      inject: (name, callback) => { assert.equal(name, 'sidebar.footer.action'); return callback(); },
      register: (entry, component) => {
        assert.equal(entry.name, 'sidebar.footer.action');
        assert.equal(typeof entry.id, 'string');
        entries.push({ entry, component }); return () => {};
      },
    },
    shortcuts: { register: value => { commands.push(value); return () => {}; } },
    effect: callback => { const cleanup = callback(); effects.push(cleanup); return cleanup; },
    inject: (_names, callback) => callback(ctx),
  };
  api.apply(ctx);
  assert.equal(opened.length, 0, 'enabling the plugin must not launch a browser');
  assert.equal(entries.length, 1);
  const button = entries[0].component({ t: ctx.locale.bind() });
  assert.equal(button.type, 'button');
  assert(button.props['aria-label'].includes('默认浏览器'));
  button.props.onClick();
  assert.equal(commands[0].id, 'shenhuo.image-editor.open');
  const resolved = commands[0].resolve({ target: null, region: 'page', modal: null });
  assert.equal(resolved.status, 'handled', 'opening the editor does not require a conversation');
  resolved.run();
  assert.deepEqual(opened, Array.from({ length: 2 }, () => [EDITOR_HOME, '_blank', 'noopener,noreferrer']));
  assert.throws(() => api.openEditor('https://example.com/'), /official Shenhuo/);
  assert.equal(opened.length, 2);
  const click = (href, extra = {}) => {
    const event = { button: 0, target: { closest: selector => { assert.equal(selector, 'a[href]'); return href ? { href } : null; } },
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    listeners.get('click')(event);
    return event;
  };
  const documentUrl = 'https://www.shenhuoai.com/agent/layer-editor/ldoc_saved';
  const clickResult = click(documentUrl);
  assert.equal(clickResult.defaultPrevented, true, 'editor link must bypass the host Markdown sidebar delegate');
  assert.equal(clickResult.stopped, true);
  assert.deepEqual(opened[2], [documentUrl, '_blank', 'noopener,noreferrer']);
  for (const href of [null, 'https://example.com', 'https://www.shenhuoai.com/agent?project_id=prj_example', `${documentUrl}?token=secret`]) {
    assert.equal(click(href).defaultPrevented, undefined, 'unrelated links retain the host behavior');
  }
  for (const extra of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) click(documentUrl, extra);
  assert.equal(opened.length, 3);
  for (const dispose of effects.reverse()) await dispose?.();
  assert.equal(listeners.size, 0, 'uninstall removes the document link override');
});

test('external editor links accept official home, project and document locations', () => {
  assert.equal(editorUrl(), EDITOR_HOME);
  for (const path of ['/agent/layer-editor/ldoc_example', '/agent/layer-editor/project/prj_example']) {
    assert.equal(editorUrl(`https://www.shenhuoai.com${path}`), `https://www.shenhuoai.com${path}`);
  }
});

test('external launch refuses credentials, tokens, unrelated pages and URL schemes', () => {
  for (const value of ['javascript:alert(1)', 'file:///tmp/example', 'http://www.shenhuoai.com/home/tools/layer-editor',
    'https://www.shenhuoai.com.evil.example/home/tools/layer-editor', 'https://name:password@www.shenhuoai.com/home/tools/layer-editor',
    `${EDITOR_HOME}?token=secret`, `${EDITOR_HOME}#secret`, 'https://www.shenhuoai.com/admin']) {
    assert.throws(() => editorUrl(value));
  }
});
