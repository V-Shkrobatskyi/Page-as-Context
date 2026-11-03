// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
/** Shared Web Crypto implementation. The provider secret never crosses the network. */
export function createAuthentication(cryptoApi = globalThis.crypto) {
  const encode = value => new TextEncoder().encode(value);
  const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const random = () => hex(cryptoApi.getRandomValues(new Uint8Array(32)));
  const keys = new Map();
  const key = async secret => {
    if (!keys.has(secret)) {
      if (keys.size >= 8) keys.clear();
      keys.set(secret, cryptoApi.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
    }
    return keys.get(secret);
  };
  const bytes = (direction, path, scope, body) => encode(JSON.stringify([1, direction, path, scope.instanceId, scope.leaseId, scope.nonce, scope.time, body]));
  const sign = async (secret, direction, path, scope, body) => hex(await cryptoApi.subtle.sign('HMAC', await key(secret), bytes(direction, path, scope, body)));
  const verify = async (secret, direction, path, scope, body, mac) => {
    if (typeof mac !== 'string' || !/^[a-f0-9]{64}$/u.test(mac)) return false;
    return cryptoApi.subtle.verify('HMAC', await key(secret), Uint8Array.from(mac.match(/../gu), value => parseInt(value, 16)), bytes(direction, path, scope, body));
  };
  const hash = async value => hex(await cryptoApi.subtle.digest('SHA-256', encode(value)));
  return { random, sign, verify, hash };
}
