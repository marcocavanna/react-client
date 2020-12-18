/* --------
 * Client State
 * -------- */
export interface ClientState<UserData, State extends 'logged' | 'not-logged' = any> {
  isLoaded: boolean;

  isPerformingRequest: boolean;

  hasAuth: boolean;

  userData: State extends 'logged' ? UserData : null;
}

export interface ClientTokens<AccessToken = any, RefreshToken = any> {
  accessToken: AccessToken | undefined,

  refreshToken: RefreshToken | undefined
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
}

export type ClientWillResponse<T = GenericAPIResponse> = [ ClientRequestError | null, T ];
