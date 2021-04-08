type AnyObject = { [key: string]: any };


/* --------
 * Main API Server Responses
 * -------- */
export type UserAuth<UserData> = {
  accessToken: AccessToken;

  refreshToken: RefreshToken;

  userData: UserData;
};

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
export interface ClientState<UserData, State extends 'logged' | 'not-logged' = any> {
  isLoaded: boolean;

  isPerformingRequest: boolean;

  hasAuth: boolean;

  userData: State extends 'logged' ? UserData : null;
}

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
    $lean?: boolean,
    $limit?: string | number,
    $populate?: string,
    $project?: string,
    $skip?: string | number,
    $sort?: string,
    [key: string]: any
  };

  /** Data to Pass */
  data?: { [key: string]: any };

  /** Choose if Request Error must be throw raw or parsed, default to true  */
  parseRequestError?: boolean;

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
  url: string;
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
