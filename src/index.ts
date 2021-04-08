export { default as Client } from './lib/client';
export type { ClientConfiguration } from './lib/client';


/* --------
 * Base Client Context Functions
 * -------- */

export { useClient, ClientConsumer, ClientProvider } from './context/client.context';


/* --------
 * Client Hooks
 * -------- */
export * from './hooks';


/* --------
 * Client HOC
 * -------- */
export { default as withClient } from './HOC/withClient';

export type {
  ClientRequest,
  ClientRequestConfig,
  ClientRequestError,
  ClientRequestMethod,
  ClientRequestParams,
  ClientState,
  EventUnsubscribe,
  WebSocketEvent
} from './lib/client.interfaces';

export type {
  WithClientProps,
  ComponentWithClientProps
} from './HOC/withClient';
