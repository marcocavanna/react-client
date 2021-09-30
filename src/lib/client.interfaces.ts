import type { AxiosRequestConfig } from 'axios';


type AnyObject = { [key: string]: any };

export type AccessToken = {
  token: string;

  email: string;

  expiresAt: number;

  roles: string[];
};

export type RefreshToken = string;


/* --------
 * Client State
 * -------- */
export type LoadingClientState = {
  isLoaded: false;
  isPerformingRequest: boolean;
  hasAuth: false;
  userData: null;
};

export type UnauthorizedClientState = {
  isLoaded: true;
  isPerformingRequest: boolean;
  hasAuth: false;
  userData: null;
};

export type AuthorizedClientState<UserData> = {
  isLoaded: true;
  isPerformingRequest: boolean;
  hasAuth: true;
  userData: UserData;
};

export type ClientState<UserData> =
  | LoadingClientState
  | UnauthorizedClientState
  | AuthorizedClientState<UserData>;

export interface WebSocketState {
  /** Last websocket connection has an error */
  hasError: boolean;

  /** WebSocket is Closing */
  isClosing: boolean;

  /** WebSocket is Successfully connected */
  isConnected: boolean;

  /** WebSocket is Connecting */
  isConnecting: boolean;

  /** The count of reconnection */
  reconnectionCount: number;

  /** WebAPI Version */
  version: string | null;
}

export interface ClientTokens {
  accessToken: AccessToken | undefined,

  refreshToken: RefreshToken | undefined
}


/* --------
 * Event Management
 * -------- */
export type EventUnsubscribe = () => void;

export interface ServerEvent {
  event: string;

  entityId?: string;

  version?: string;
}

export interface WebSocketEvent {
  entityId?: string | null;

  namespace: string | 'server' | 'team';

  type?: 'add' | 'edit' | 'delete' | 'user-connected' | 'user-disconnected' | null;
}


/* --------
 * Requests Interface
 * -------- */
export type GenericAPIResponse = { [key: string]: any } | any[];

export type ClientRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ClientRequest = ClientRequestParams & ClientRequestConfig;

export interface ClientRequestParams {
  /** Append Access Token Header */
  withAccessToken?: boolean;

  /** Append Refresh Token Header */
  withRefreshToken?: boolean;

  /** Request Params */
  params?: {
    [key: string]: any
  };

  /** Data to Pass */
  data?: { [key: string]: any };

  /** Choose if Request Error must be throw raw or parsed, default to true  */
  parseRequestError?: boolean;

  /** Any other Axios Request Config */
  axiosRequestConfig?: Omit<AxiosRequestConfig, 'method' | 'url'>;

  /**
   * TODO:
   * Check the Response (or try to get the cached version)
   * set this value to true to use default cache TTL, else
   * set to number (as millisecond) or to a string (ms duration)
   * to use a personal TTL value
   */
  cache?: boolean | number | string;
}

export interface ClientRequestConfig {
  /** Request Method */
  method?: ClientRequestMethod;

  /** The request URL */
  url?: string;
}

export interface ClientRequestError {
  /** Status code received */
  statusCode: number;

  /** Error code text received */
  error: string;

  /** Error message received */
  message: string | string[];

  /** The method used for the request */
  method?: string;

  /** The response object */
  response?: AnyObject;

  /** The error stack */
  stack?: string | undefined;

  /** The request URL */
  url?: string;
}

export type ClientWillResponse<T = GenericAPIResponse> = [ ClientRequestError | null, T ];
