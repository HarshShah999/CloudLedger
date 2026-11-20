import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
    userId?: string;
    ip?: string;
}

/** Per-request context (who is acting), available anywhere in the async call chain. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export const currentContext = (): RequestContext | undefined => requestContext.getStore();
