// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';

export class Protocol {
  pending = new Map(); next = 0;
  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data); const job = this.pending.get(message.id); if (!job) return;
      this.pending.delete(message.id); clearTimeout(job.timer);
      message.error || message.type === 'error' ? job.reject(new Error(`Browser command failed: ${job.method}`)) : job.resolve(message.result);
    });
    socket.addEventListener('close', () => { for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error('Browser disconnected')); } this.pending.clear(); });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return new Protocol(socket);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser timeout: ${method}`)); }, 15_000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { this.socket.close(); }
}

export async function launch(browser, profile, binary) {
  const defaults = process.platform === 'darwin'
    ? { chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', firefox: '/Applications/Firefox.app/Contents/MacOS/firefox' }
    : { chrome: 'google-chrome', firefox: 'firefox' };
  const args = browser === 'chrome'
    ? ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--enable-unsafe-extension-debugging', 'about:blank']
    : ['--headless', '--no-remote', '--remote-allow-system-access', '--profile', profile, '--remote-debugging-port', '0', 'about:blank'];
  let diagnostics = '';
  const child = spawn(binary ?? defaults[browser], args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes.toString()).slice(-8000); });
  let exited = false;
  const exit = new Promise(resolve => child.once('exit', () => { exited = true; resolve(); }));
  const stop = async () => {
    if (exited) return;
    child.kill('SIGTERM'); let timer;
    await Promise.race([exit, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); })]); clearTimeout(timer);
  };
  try {
    const url = await new Promise((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error(`${browser} startup timed out`)), 20000);
      child.once('error', () => { clearTimeout(timer); reject(new Error(`${browser} launch failed`)); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`${browser} exited during startup`)); });
      const data = bytes => {
        output = (output + bytes.toString()).slice(-8000);
        const match = output.match(browser === 'chrome' ? /DevTools listening on (ws:\/\/[^\s]+)/u : /WebDriver BiDi listening on (ws:\/\/[^\s]+)/u);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      };
      child.stdout.on('data', data); child.stderr.on('data', data);
    });
    return { protocol: await Protocol.connect(browser === 'firefox' ? `${url.replace(/\/$/u, '')}/session` : url), stop,
      diagnostics: () => diagnostics.split('\n').filter(line => /native|host|error/iu.test(line)).slice(-10).join('\n') };
  } catch (error) { await stop(); throw error; }
}
