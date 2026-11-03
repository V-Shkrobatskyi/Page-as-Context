export function createRelay(config: { endpoint: string; providerSecret: string }, cryptoApi?: Crypto): { middleware(ctx: any): Promise<void>; unload(): void };
