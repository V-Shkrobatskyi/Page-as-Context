export interface AuthScope { instanceId: string; leaseId: string; nonce: string; time: number }
export function createAuthentication(cryptoApi?: Crypto): {
  random(): string;
  hash(value: string): Promise<string>;
  sign(secret: string, direction: string, path: string, scope: AuthScope, body: unknown): Promise<string>;
  verify(secret: string, direction: string, path: string, scope: AuthScope, body: unknown, mac: unknown): Promise<boolean>;
};
