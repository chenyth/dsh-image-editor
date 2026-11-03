import { createElement as h } from 'react';
import icon from '../../assets/icon-red-transparent.png';
import { EDITOR_HOME, editorUrl } from './urls.js';

export const inject = ['slots', 'locale'];
export const name = 'dsh-image-editor-client';
const COMMAND = 'shenhuo.image-editor.open';
const LOCALE = 'shenhuoImageEditor';
const messages = {
  zh: { title: '神火图层编辑器', open: '在默认浏览器打开神火图层编辑器' },
  en: { title: 'Image Editor', open: 'Open Image Editor in default browser' },
};

export function openEditor(url = EDITOR_HOME) {
  // DSH Desktop routes new-window requests to the system default browser.
  // Keep this synchronous with the user's click for browser-hosted DSH too.
  window.open(editorUrl(url), '_blank', 'noopener,noreferrer');
}

export function openEditorLink(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target?.closest?.('a[href]');
  if (!anchor) return;
  let url;
  try { url = editorUrl(anchor.href); } catch { return; }
  // Chat's Markdown delegate otherwise routes links through the global sidebar
  // preference. Limit the override to clean official editor links and dispose it
  // with this plugin; never change the user's global link-opening preference.
  event.preventDefault();
  event.stopPropagation();
  openEditor(url);
}

export function apply(ctx) {
  const t = ctx.locale.bind(LOCALE);
  function OpenEditorButton({ t }) {
    return h('button', {
      type: 'button', title: t('open'), 'aria-label': t('open'), onClick: () => openEditor(),
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, padding: 4, border: 0, borderRadius: 8,
        background: 'transparent', color: 'inherit', cursor: 'pointer', flexShrink: 0 },
    }, h('img', { src: icon, width: 24, height: 24, alt: '' }));
  }

  ctx.effect(() => ctx.locale.register(LOCALE, messages), 'shenhuo-editor.locale');
  ctx.effect(() => {
    document.addEventListener('click', openEditorLink, true);
    return () => document.removeEventListener('click', openEditorLink, true);
  }, 'shenhuo-editor.document-links');
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'shenhuo-editor-open-browser', locale: LOCALE,
  }, OpenEditorButton)), 'shenhuo-editor.launcher');
  ctx.inject(['shortcuts'], scope => {
    scope.effect(() => scope.shortcuts.register({
      id: COMMAND, label: () => t('open'),
      aliases: ['shenhuo', 'image editor', '神火', '图层编辑'], defaults: {},
      regions: ['page', 'editable', 'terminal'], modals: [],
      resolve: () => ({ status: 'handled', run: () => openEditor() }),
    }), 'shenhuo-editor.command');
  });
}
