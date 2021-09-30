import type {
  ClientRequestConfig,
  ClientRequestError,
  ClientRequestMethod,
  WebSocketEvent
} from '../lib/client.interfaces';


/* --------
 * UseClientRequest Types and Interfaces
 * -------- */
export interface UseClientRequestConfig {
  /** The request method to use, default to GET */
  method?: ClientRequestMethod;

  /** An array of dependencies used to reload the request */
  reloadDependencies?: any[];

  /** Additional Client Request Config */
  request?: ClientRequestConfig;

  /** The request URL */
  url: string;
}

export interface UseClientRequestInternalState<Response> {
  /** The request error */
  error: ClientRequestError | null;

  /** Indicate if request is loading */
  isLoading: boolean;

  /** The request response */
  response: Response;
}

export interface UseClientRequestState<Response> extends UseClientRequestInternalState<Response> {
  /** Refetch Data */
  reload(): Promise<Response>;
}


/* --------
 * UseWebSocket Event Configuration
 * -------- */
export interface UseWebSocketEventConfig extends Partial<WebSocketEvent> {
  /** Choose if is active or not */
  active?: boolean;

  /** Handle the Event */
  onEvent?: (event: WebSocketEvent) => void | Promise<void>;
}
