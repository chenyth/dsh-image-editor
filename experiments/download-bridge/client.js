import { createElement as h, useRef, useState, useLayoutEffect } from 'react';
import config from './config.json';
export const name = 'dsh-image-editor-download-probe-client';
export const inject = ['slots', 'sidebarRightTabs'];
const id = 'dsh-image-editor-download-probe', kind = 'shenhuo-download-probe';
const origin = `http://127.0.0.1:${config.port}`;

export function apply(ctx) {
  function Probe({ useTabInfo }) {
    const { tab } = useTabInfo(), host = useRef(null), ticket = useRef(null);
    const [state, setState] = useState('等待从测试页导出 PNG。'), [canSave, setCanSave] = useState(false);
    useLayoutEffect(() => {
      let closed = false, reservation, guest, unsubscribe;
      const bridge = globalThis.dshDesktop?.browser;
      const ready = (async () => {
        reservation = await bridge.acquire(`shenhuo-download-probe:${config.runId}`);
        if (closed) { await bridge.release(reservation.lease); return; }
        guest = document.createElement('webview');
        guest.setAttribute('name', reservation.lease); guest.setAttribute('partition', reservation.partition);
        guest.setAttribute('src', `about:blank#${reservation.lease}`); guest.setAttribute('allowpopups', '');
        guest.setAttribute('aria-label', 'PNG 下载桥接验收');
        Object.assign(guest.style, { width: '100%', height: '100%', display: 'flex' });
        let started = false;
        guest.addEventListener('dom-ready', () => { if (!started) { started = true; void guest.loadURL(`${origin}/probe/${config.pageKey}`); } });
        unsubscribe = bridge.onOpenRequested(reservation.lease, value => {
          const url = new URL(value);
          if (url.origin !== origin || url.pathname !== '/handoff' || url.search) return;
          const valueTicket = new URLSearchParams(url.hash.slice(1)).get('ticket');
          if (!valueTicket || valueTicket.length > 2048) return;
          ticket.current = valueTicket; setCanSave(true);
          setState('已通过 DSH WebView 通道收到短期下载票据。');
        });
        host.current.append(guest);
      })();
      ready.catch(() => setState('验收页加载失败。'));
      const close = () => { closed = true; unsubscribe?.(); guest?.remove(); if (reservation) void bridge.release(reservation.lease); };
      tab.signal.addEventListener('abort', close, { once: true });
      return () => { tab.signal.removeEventListener('abort', close); close(); };
    }, [tab.id]);
    const save = async () => {
      if (!ticket.current) return;
      setCanSave(false); setState('插件正在校验票据并保存 PNG…');
      try {
        const response = await fetch(`${origin}/save`, { method: 'POST',
          headers: { Authorization: `Bearer ${config.clientKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket: ticket.current }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setState(`保存成功\n${result.path}\n${result.byteLength} 字节\nSHA-256：${result.sha256}\n未传递网页登录 Cookie。`);
      } catch (error) { setState(`保存未完成：${error.message}`); }
    };
    return h('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } },
      h('div', { style: { padding: 16, borderBottom: '1px solid #ddd' } },
        h('strong', null, '下载桥接 · 独立本地验收'), h('pre', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, state),
        h('button', { disabled: !canSave, onClick: save }, '保存 PNG 到本机')),
      h('div', { ref: host, style: { flex: 1, minHeight: 0 } }));
  }
  ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind, keepMounted: true, title: () => '下载桥接验收',
    guide: [{ id: 'probe', order: 36, title: () => '下载桥接验收', description: () => '本地 PNG 交接与保存测试' }] }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Probe)));
}
