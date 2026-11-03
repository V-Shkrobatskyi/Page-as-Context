// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
export type TransportKind = 'native' | 'hfs';
export interface ExecutionRequest {
  type: 'request'; id: string; instanceId: string; browser: string;
  credentialId: string; credentialSecret: string;
  request: { tool: string; arguments?: Record<string, unknown> };
  route?: TransportKind; lease?: string;
}
export interface ExecutionTransport {
  readonly kind: TransportKind;
  readonly lease: string;
  readonly ready: boolean;
  close(): void;
  toolsChanged(clientId: string): void;
}
export interface TransportEvents {
  ready(): void;
  disconnected(reason?: string): void;
  request(request: ExecutionRequest): Promise<unknown>;
  cancel(id: string): void;
  clientDisconnected(clientId: string, secret: string): void;
}
