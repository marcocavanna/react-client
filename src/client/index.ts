import axios, { AxiosError, AxiosResponse } from 'axios';

import { EventEmitter } from 'events';
import * as localforage from 'localforage';

import { will } from '../utils';

import {
  ClientRequest,
  ClientRequestError,
  ClientRequestParams,
  ClientState,
  ClientTokens,
  ClientWillResponse,
  ClientUnsubscribe,
  GenericAPIResponse
} from '../interfaces';


/* --------
 * Client Definition
 * -------- */
class Client {

  /* --------
   * Singleton Methods
   * --
   * Prepare the Client as a Singleton.
   * Only one Client per App could exists.
   * -------- */

  /** Init a Client Container */
  private static _instance: Client | null = null;


  /** Declare a function to get Client instance */
  public static getInstance(): Client {
    /** If a Client instance doesn't exists, create a new one */
    if (!Client._instance) {
      Client._instance = new Client();
    }
    /** Return the Singleton Instance of Client */
    return Client._instance;
  }


  /* --------
   * LocalForage Configuration
   * -------- */
  private static localDB = localforage.createInstance({
    name       : 'MooxNext',
    version    : 2.0,
    storeName  : 'MooxClient',
    description: 'Container for Client Data and Auth'
  });

  private static accessTokenDbField = 'accessToken';

  private static refreshTokenDbField = 'refreshToken';

  private static userDataDbField = 'userData';


  /* --------
   * Axios Client Configuration
   * -------- */
  public static client = axios.create({
    baseURL       : process.env.NODE_ENV === 'production'
      ? 'https://moox-next-api.container.appbuckets.io'
      : 'http://127.0.0.1:3000/',
    timeout       : process.env.NODE_ENV === 'development' ? 120_000 : 15_000,
    validateStatus: status => status >= 200 && status < 300
  });

  private static prepareURL = (url: string) => encodeURI(url.replace(/(^\/*)|(\/*$)/, ''));

  private static changeClientStateOnRequest = false;

  private static accessTokenErrorWillInvalidate = true;

  private static accessTokenValidityThreshold = 60_000;

  private static accessTokenHeaderName = 'X-MxAccessToken';

  private static refreshTokenHeaderName = 'X-MxRefreshToken';


  /* --------
   * Client Debugger Methods
   * -------- */
  private static isDebugEnabled = false && process.env.NODE_ENV === 'development';

  private static lastDebug = Date.now();


  private static debug(...args: any): void {
    /** Return if Debug is inactive */
    if (!Client.isDebugEnabled) {
      return;
    }

    /** Get timestamp and elapsed time */
    const now = Date.now();
    const elapsed = now - Client.lastDebug;
    /** Write message into Console */
    window.console.info(`[ +${elapsed}ms ] - Client Debug\n`, ...args);
    /** Save debug time */
    Client.lastDebug = now;
  }


  /* --------
   * Request Error Parser
   * -------- */
  public static genericRequestError: ClientRequestError = {
    statusCode: 500,
    message   : 'Server Error',
    error     : 'server-error'
  };


  private static parseRequestError(error: any): ClientRequestError {
    /** If error is an Array, set data key of the generic object */
    if (typeof error !== 'object' || error === null || Array.isArray(error)) {
      Client.debug(
        'Error is not a valid Object. Putting the original error into data field',
        { error }
      );
      return Client.genericRequestError;
    }

    /** If error is an Axios Error, get props */
    if (error.isAxiosError) {
      const { response } = error as AxiosError;

      if (response) {
        Client.debug(
          'Error is a valid Axios Error. Keeping original properties',
          { response }
        );
        return {
          statusCode: response.status,
          error     : response.data?.error ?? Client.genericRequestError.error,
          message   : response.data?.message ?? Client.genericRequestError.message
        };
      }

      Client.debug(
        'Error is not a valid Axios Error, fallback to generic error',
        { error }
      );

      return Client.genericRequestError;
    }

    /** If error is an instance of Error, keep the message */
    if (error instanceof Error) {
      Client.debug(
        'Error is an instance of Error, keep the message',
        { error }
      );
      return {
        statusCode: Client.genericRequestError.statusCode,
        error     : error.name,
        message   : error.message
      };
    }

    /** Fallback to generic Error */
    Client.debug('Fallback to generic Error', { error });
    return Client.genericRequestError;
  }


  /* --------
   * Client Event Emitters
   * -------- */
  private events = new EventEmitter();


  public subscribeToClientStateChange(callback: (clientState: ClientState) => void, context?: any): ClientUnsubscribe {
    /** Wrap the callback to a known function */
    const wrappedCallback = () => {
      callback.apply(context, [ this.state ]);
    };
    /** Create a new Listener to Client State Change event */
    Client.debug(
      'A new observer has been registered for clientState event',
      {
        callback,
        context
      }
    );
    this.events.on('clientStateChange', wrappedCallback);
    /** Return a function to unsubscribe the listener */
    return () => {
      /** Remove the listener */
      this.events.off('clientStateChange', wrappedCallback);
      Client.debug(
        'An observer for clientState event has been removed',
        {
          callback,
          context
        }
      );
    };
  }


  private dispatchClientStateChange(): void {
    /** Get Client State */
    const { state } = this;

    /** Block dispatching if client isn't loaded */
    if (!state.isLoaded) {
      return;
    }

    Client.debug('Emitting clientStateChange event', { clientState: this.state });

    this.events.emit('clientStateChange');
  }


  /* --------
   * Client Instance Props and Data
   * -------- */
  private _state: Omit<ClientState, 'hasAuth'> = {
    isLoaded           : false,
    isPerformingRequest: false,
    userData           : null
  };

  private _tokens: ClientTokens = {
    accessToken : undefined,
    refreshToken: undefined
  };


  /** Make the constructor private, to avoid direct instance */
  private constructor() {
    /** Initialize the Client */
    this.__init()
      /** Init Async function will never throw */
      .then((userData) => {
        /** If no userData exists, purge auth */
        if (!userData) {
          this.resetClientAuth();
        }

        /** Set the new State */
        this.setState({ isLoaded: true });
      });
  }


  /* --------
   * Client Initialization Process
   * -------- */

  /**
   * Initialize the Client.
   * The __init function will never throw,
   * any error occurred in this process will be
   * considered like a non authorized client
   */
  async __init(): Promise<APIResponse.Auth.User | null> {
    try {
      /** Get Fresh User Data */
      const userData = await this.getUserData();
      /** Save response */
      await this.saveUserData(userData);
      /** Return to constructor */
      return userData;
    }
    catch (initError) {
      /** Log the error into the console, only if is in development mode */
      if (process.env.NODE_ENV === 'development') {
        global.console.log(
          'An initialize error occurred, maybe the client has no any auth.',
          initError
        );
      }
      /** Return invalid user data */
      return null;
    }
  }


  /**
   * On some methods and process, when something goes wrong,
   * must reset original client auth.
   * @private
   */
  private async resetClientAuth(): Promise<void> {
    /** Revoke all local tokens */
    this._tokens = {
      accessToken : undefined,
      refreshToken: undefined
    };

    /** Remove LocalStorage element */
    await Client.localDB.removeItem(Client.accessTokenDbField);
    await Client.localDB.removeItem(Client.refreshTokenDbField);
    await Client.localDB.removeItem(Client.userDataDbField);

    /** Update the state */
    this.setState({ userData: null });
  }


  /* --------
   * UserData Management
   * -------- */
  public async getUserData(): Promise<APIResponse.Auth.User> {
    return this.request<APIResponse.Auth.User>({
      withAccessToken: true,
      method         : 'GET',
      url            : '/auth/who-am-i'
    });
  }


  private async saveUserData(userData?: APIResponse.Auth.User): Promise<void> {
    this.setState({
      userData: userData ?? null
    });

    if (userData) {
      await will(Client.localDB.setItem<APIResponse.Auth.User>(Client.userDataDbField, userData));
    }
    else {
      await will(Client.localDB.removeItem(Client.userDataDbField));
    }
  }


  /* --------
   * Public Getters
   * -------- */
  public get state(): ClientState {
    return {
      ...this._state,
      hasAuth: !!this._state.userData && this.hasValidAccessToken && this.hasValidRefreshToken
    };
  }


  private get hasValidAccessToken(): boolean {
    /** Assert accessToken is a valid object */
    if (typeof this._tokens.accessToken !== 'object' || this._tokens.accessToken === null) {
      return false;
    }

    /** Assert access token token field is a string */
    if (!this._tokens.accessToken.token?.length) {
      return false;
    }

    /** Use token validity threshold to assert token could be used */
    return (this._tokens.accessToken.expiresAt + Client.accessTokenValidityThreshold) > Date.now();
  }


  private get hasValidRefreshToken(): boolean {
    return typeof this._tokens.refreshToken === 'string' && !!this._tokens.refreshToken.length;
  }


  /* --------
   * Public Methods
   * -------- */
  public setState(newState: Partial<Omit<ClientState, 'hasAuth'>>): void {
    /** Set the new state */
    this._state = {
      ...this._state,
      ...newState
    };
    /** Dispatch state change */
    this.dispatchClientStateChange();
  }


  /* --------
   * Auth Requests
   * -------- */
  public async loginWithEmailAndPassword(email: string, password: string): Promise<APIResponse.Auth.User> {
    /** Get user Data */
    const loginData = await this.request<APIResponse.Auth.Login>({
      url             : '/auth/login',
      method          : 'POST',
      data            : {
        email,
        password
      },
      withAccessToken : false,
      withRefreshToken: false
    });

    /** Save Tokens */
    await this.saveAccessToken(loginData.accessToken);
    await this.saveRefreshToken(loginData.refreshToken);

    /** Save received user data */
    await this.saveUserData(loginData.userData);

    return loginData.userData;
  }


  public async createUserWithEmailAndPassword(
    signupData: Dto.User.Create
  ): Promise<APIResponse.Auth.User> {
    /** Get Data */
    const loginData = await this.request<APIResponse.Auth.Login>({
      url             : '/auth/signup',
      method          : 'POST',
      data            : signupData,
      withAccessToken : false,
      withRefreshToken: false
    });

    /** Save Tokens */
    await this.saveAccessToken(loginData.accessToken);
    await this.saveRefreshToken(loginData.refreshToken);

    /** Save user data */
    await this.saveUserData(loginData.userData);

    return loginData.userData;
  }


  public async logout(): Promise<void> {
    /** Logout from the API */
    await this.request<void>({
      url             : '/auth/logout',
      method          : 'POST',
      withRefreshToken: true,
      withAccessToken : true
    });

    /** Remove client auth */
    await this.resetClientAuth();
  }


  /* --------
   * Requests Methods
   * -------- */
  public async willGet<T>(url: string, options?: Omit<ClientRequestParams, 'data'>) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'GET'
    });
  }


  public async get<T>(url: string, options?: Omit<ClientRequestParams, 'data'>) {
    return this.request<T>({
      ...options,
      url,
      method: 'GET'
    });
  }


  public async willPost<T>(url: string, options?: ClientRequestParams) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'POST'
    });
  }


  public async post<T>(url: string, options?: ClientRequestParams) {
    return this.request<T>({
      ...options,
      url,
      method: 'POST'
    });
  }


  public async willPut<T>(url: string, options?: ClientRequestParams) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'PUT'
    });
  }


  public async put<T>(url: string, options?: ClientRequestParams) {
    return this.request<T>({
      ...options,
      url,
      method: 'PUT'
    });
  }


  public async willPatch<T>(url: string, options?: ClientRequestParams) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'PATCH'
    });
  }


  public async patch<T>(url: string, options?: ClientRequestParams) {
    return this.request<T>({
      ...options,
      url,
      method: 'PATCH'
    });
  }


  public async willDelete<T>(url: string, options?: ClientRequestParams) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'DELETE'
    });
  }


  public async delete<T>(url: string, options?: ClientRequestParams) {
    return this.request<T>({
      ...options,
      url,
      method: 'DELETE'
    });
  }


  public async willRequest<T = GenericAPIResponse>(
    config: ClientRequest
  ): Promise<ClientWillResponse<T>> {
    /** Make the request */
    try {
      const response = await this.request<T>(config);
      return [ null, response ];
    }
    catch (e) {
      return [ e as ClientRequestError, null as unknown as T ];
    }
  }


  public async request<T = GenericAPIResponse>(config: ClientRequest): Promise<T> {
    /** Set the is Performing Request */
    if (Client.changeClientStateOnRequest) {
      this.setState({ isPerformingRequest: true });
    }

    /** Deconstruct Config */
    const {
      url: _url,
      method,
      data,
      params,
      parseRequestError = true,
      withAccessToken = true,
      withRefreshToken = false
    } = config;

    /** Prepare the Request URL */
    const url = Client.prepareURL(_url);

    /** Make the Request */
    try {

      // ----
      // Build Header, including token if they are requested
      // ----
      const headers: Record<string, string> = {};

      /** Append the AccessToken, if something goes wrong, getAccessToken will throw its error */
      if (withAccessToken) {
        headers[Client.accessTokenHeaderName] = await this.getAccessToken();
      }

      /** Append RefreshToken, If something goes wrong, getRefreshToken will throw its error */
      if (withRefreshToken) {
        headers[Client.refreshTokenHeaderName] = await this.getRefreshToken();
      }

      Client.debug(
        `Performing a '${config.method}' Request to '${config.url}'`,
        {
          params,
          data
        }
      );

      /** Make the Request */
      const response = await Client.client({
        url,
        method,
        headers,
        params,
        data
      }) as AxiosResponse<T>;

      Client.debug(`Response received from '${config.url}'`, { response });

      /** Remove loading state */
      if (Client.changeClientStateOnRequest) {
        this.setState({ isPerformingRequest: false });
      }

      /** Return the Response */
      return response.data;
    }
    catch (e) {
      Client.debug(
        `An undefined error has been received from '${config.url}'`,
        { e }
      );

      /** Remove loading state */
      if (Client.changeClientStateOnRequest) {
        this.setState({ isPerformingRequest: false });
      }

      /** Throw the Error */
      throw parseRequestError
        ? Client.parseRequestError(e)
        : e instanceof Error ? e : new Error('Undefined request error');
    }
  }


  private async getAccessToken(): Promise<string> {
    Client.debug('Retrieving the AccessToken');

    /** Check if current access token could be used */
    if (this.hasValidAccessToken) {
      return this._tokens.accessToken!.token;
    }

    /**
     * If the Access Token could not be used
     * must refresh it using the current refresh token
     */
    const [ refreshAccessTokenError, accessToken ] = await this.willRequest<APIResponse.Auth.AccessGrant>({
      method          : 'GET',
      url             : '/auth/grant-access',
      withRefreshToken: true,
      withAccessToken : false
    });

    /**
     * An error received while granting a new AccessToken
     * must invalide the Auth, if is set into Client Class
     */
    if (refreshAccessTokenError) {
      if (Client.accessTokenErrorWillInvalidate) {
        await this.resetClientAuth();
      }

      throw refreshAccessTokenError;
    }

    /** Update the Tokens Field and Local Db Object */
    await this.saveAccessToken(accessToken);

    /** Return the newly regenerated token */
    return accessToken.token;
  }


  /* --------
   * Tokens Management
   * -------- */
  private async getRefreshToken(): Promise<string> {
    Client.debug('Retrieving the RefreshToken');

    /** Load Local Refresh Token */
    let { refreshToken } = this._tokens;

    /** If token does not exists, try loading from localdb */
    if (!refreshToken) {
      Client.debug('Try to get local refresh token');
      const [ loadDbError, localRefreshToken ] = await will(
        Client.localDB.getItem<string>(Client.refreshTokenDbField)
      );

      if (loadDbError) {
        throw loadDbError;
      }

      Client.debug(localRefreshToken ? 'Local Refresh Token found' : 'No local Refresh Token found');
      refreshToken = localRefreshToken ?? undefined;
      this._tokens.refreshToken = localRefreshToken ?? undefined;
    }

    /** Assert RefreshToken field validity */
    if (typeof refreshToken !== 'string' || !refreshToken.length) {
      throw new Error('Invalid Refresh Token');
    }

    return refreshToken;
  }


  /**
   * Save the Access Token into the LocalDB
   * @param accessToken
   * @private
   */
  private async saveAccessToken(accessToken: APIResponse.Auth.AccessGrant): Promise<void> {
    Client.debug('Saving a new Access Token');

    const [ saveError ] = await will(
      Client.localDB.setItem<APIResponse.Auth.AccessGrant>(Client.accessTokenDbField, accessToken)
    );

    if (saveError && process.env.NODE_ENV === 'development') {
      global.console.error(
        'An error occurred while saving the accessToken into the local db'
      );

      throw saveError;
    }

    this._tokens.accessToken = accessToken;
  }


  /**
   * Save the Refresh Token into the Local DB
   * @param refreshToken
   * @private
   */
  private async saveRefreshToken(refreshToken: string): Promise<void> {
    Client.debug('Saving a new Refresh Token');

    const [ saveError ] = await will(
      Client.localDB.setItem<string>(Client.refreshTokenDbField, refreshToken)
    );

    if (saveError && process.env.NODE_ENV === 'development') {
      global.console.error(
        'An error occurred while saving the refreshToken into the local db'
      );

      throw saveError;
    }

    this._tokens.refreshToken = refreshToken;
  }
}

export default Client;
