import { AxiosRequestConfig } from 'axios';

/* --------
 * Client Configuration
 * -------- */
export interface ClientConfiguration {
  /** Set up Axios Configuration, this could be split using environment */
  axiosSettings: AxiosRequestConfig | Record<string, AxiosRequestConfig>;

  /** Set up the Local Database, using localForage module */
  localStorage?: ClientLocalDB;

  /** Configure the Logger */
  logger?: ClientLogger;

  /** Request Settings */
  requests: ClientRequestSettings;
}


// ----
// Logger Configuration
// ----

export type ClientLoggerLevel = 'debug' | 'warn' | 'error';

export type ClientLoggerSettings = {
  /** Minimum Logger Level to show */
  minLogLevel: ClientLoggerLevel,
  /** Enable or disable logging in Production Mode */
  silenceInProduction: boolean
};

export type ClientLogger = { enabled: false } | ClientLoggerSettings & {
  /** Enable Client Debugger */
  enabled: true;
};


// ----
// Local Storage Configuration
// ----

type LocalDBDriver = 'asyncStorage' | 'localStorageWrapper' | 'webSQLStorage';

export type ClientLocalStorageSettings = {
  storeAccessTokenIn: string | undefined;
  storeRefreshTokenIn: string | undefined;
  storeUserDataIn: string | undefined;
};

export type ClientLocalDB = { enabled: false } | ClientLocalStorageSettings & {
  /** Force one or more driver to use */
  driver?: LocalDBDriver | LocalDBDriver[];

  /** A description to be set */
  description?: string;

  /** Enable the Local Database */
  enabled: true;

  /** The name of the local storage to use */
  name: string;

  /** The database size, used only with WebSQL driver */
  size?: number;

  /** The store name to use */
  storeName: string;

  /** The version of database */
  version: number;
};


// ----
// Client Request Settings
// ----

export type ClientTokenPosition = 'header' | 'query';

type RequestWithAccessToken = { useAccessToken: false } | {
  /** Request could send AccessToken */
  useAccessToken: true;
  /** The position of the Access Token */
  accessTokenPosition: ClientTokenPosition;
  /** The field to pass Access Token */
  accessTokenField: string;
  /** A time threshold to check Access Token validity */
  accessTokenValidityThreshold?: number;
  /** An error while refreshing Access Token will invalidate Client Auth */
  accessTokenRefreshErrorWillInvalidateAuth: boolean;
};

type RequestWithRefreshToken = { useRefreshToken: false } | {
  /** Request could send AccessToken */
  useRefreshToken: true;
  /** The position of the Access Token */
  refreshTokenPosition: ClientTokenPosition;
  /** The field to pass Access Token */
  refreshTokenField: string;
  /** A time threshold to check Refresh Token validity */
  refreshTokenValidityThreshold?: number;
};

export type ClientRequestSettings = RequestWithAccessToken & RequestWithRefreshToken & {
  /** Client has an internal state that switch while performing request */
  switchClientRequestState?: boolean;
};


// ----
// Client Event Subscription
// ----
export type ClientEventHandler<UserData, State extends 'logged' | 'not-logged' = any> = (
  currentState: ClientState<UserData, State>,
) => void;


/* --------
 * Client State
 * -------- */
export interface ClientState<UserData, State extends 'logged' | 'not-logged' = any> {
  isLoaded: boolean;

  isPerformingRequest: boolean;

  hasAuth: boolean;

  userData: State extends 'logged' ? UserData : null;
}

export type ClientToken = {
  token: string | undefined;
  expiresAt: number | undefined;
};

export interface ClientTokens {
  accessToken: ClientToken | undefined,

  refreshToken: ClientToken | undefined
}

export type ClientUnsubscribe = () => void;


/* --------
 * Requests Interface
 * -------- */
export type AnyObject = { [key: string]: any };

export type GenericAPIResponse = AnyObject | AnyObject[];

export type ClientRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ClientRequest = ClientRequestParams & ClientRequestConfig;

export interface ClientRequestParams<Params extends {} = {}> {
  /** Append Access Token Header */
  withAccessToken?: boolean;

  /** Append Refresh Token Header */
  withRefreshToken?: boolean;

  /** Request Params */
  params?: Params & AnyObject;

  /** Data to Pass */
  data?: AnyObject;

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
}

export type ClientWillResponse<T = GenericAPIResponse> = [ ClientRequestError | null, T ];
