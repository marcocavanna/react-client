import logdown from 'logdown';

import axios, { AxiosError, AxiosResponse, AxiosRequestConfig, AxiosInstance } from 'axios';

import * as localforage from 'localforage';

import { EventEmitter } from 'events';
import invariant from 'tiny-invariant';

import { will } from '../utils';

import {
  ClientRequest,
  ClientRequestError,
  ClientRequestParams,
  ClientState,
  ClientTokens,
  ClientWillResponse,
  ClientUnsubscribe,
  GenericAPIResponse,
  ClientConfiguration,
  ClientLoggerLevel,
  ClientLoggerSettings,
  ClientLocalStorageSettings,
  ClientRequestSettings, ClientEventHandler, ClientToken,
} from '../interfaces';


/* --------
 * Internal Types
 * -------- */
type ClientFeature = 'logger' | 'localStorage';


/* --------
 * Client Definition
 * -------- */
class Client<UserData> {

  /* --------
   * Singleton Methods
   * --
   * Prepare the Client as a Singleton.
   * Only one Client per App could exists.
   * -------- */

  /** Init a Client Container */
  private static _instance: Client<any> | null = null;


  /** Declare a function to get Client instance */
  public static getInstance<UserDataInstance>(config: ClientConfiguration): Client<UserDataInstance> {
    /** If a Client instance doesn't exists, create a new one */
    if (!Client._instance) {
      Client._instance = new Client<UserDataInstance>(config);
    }
    /** Return the Singleton Instance of Client */
    return Client._instance;
  }


  /* --------
   * Feature Enabled
   * -------- */
  private _features: Record<ClientFeature, boolean> = {
    localStorage: false,
    logger      : false,
  };


  /* --------
   * Logger Definition
   * -------- */
  private readonly logLevels: Record<ClientLoggerLevel, number> = {
    debug: 0,
    warn : 5,
    error: 10,
  };

  private readonly loggerConfig: ClientLoggerSettings = {
    minLogLevel        : 'error',
    silenceInProduction: true,
  };


  private useLogger(logger: logdown.Logger, level: ClientLoggerLevel, ...args: any[]) {
    /** If log is not enabled, skip */
    if (!this._features.logger) {
      return;
    }

    /** Avoid logging in production if configured */
    if (process.env.NODE_ENV === 'production' && this.loggerConfig.silenceInProduction) {
      return;
    }

    /** Avoid logging if level is not reached */
    if (this.logLevels[level] < this.logLevels[this.loggerConfig.minLogLevel]) {
      return;
    }

    /** Use the logger function */
    logger[level](...args);
  }


  private readonly initLogger = logdown('init');

  private readonly eventLogger = logdown('event');

  private readonly authLogger = logdown('auth');

  private readonly requestLogger = logdown('request');


  /* --------
   * Internal Variable Definition
   * -------- */
  private readonly localStorageSettings: ClientLocalStorageSettings = {
    storeAccessTokenIn : undefined,
    storeRefreshTokenIn: undefined,
    storeUserDataIn    : undefined,
  };

  private readonly db: LocalForage | undefined;


  /* --------
   * Axios Client Configuration
   * -------- */
  private readonly prepareURL = (url: string) => encodeURI(url.replace(/(^\/*)|(\/*$)/, ''));

  private readonly client: AxiosInstance;

  private readonly requestsSettings: ClientRequestSettings;

  private readonly genericRequestError: ClientRequestError = {
    statusCode: 500,
    message   : 'Server Error',
    error     : 'server-error',
  };


  private parseRequestError(error: any): ClientRequestError {
    /** If error is an Array, set data key of the generic object */
    if (typeof error !== 'object' || error === null || Array.isArray(error)) {
      this.useLogger(
        this.requestLogger,
        'warn',
        'Error is not a valid Object. Putting the original error into data field',
        { error },
      );
      return this.genericRequestError;
    }

    /** If error is an Axios Error, get props */
    if (error.isAxiosError) {
      const { response } = error as AxiosError;

      if (response) {
        this.useLogger(
          this.requestLogger,
          'debug',
          'Error is a valid Axios Error. Keeping original properties',
          { response },
        );
        return {
          statusCode: response.status,
          error     : response.data?.error ?? this.genericRequestError.error,
          message   : response.data?.message ?? this.genericRequestError.message,
        };
      }

      this.useLogger(
        this.requestLogger,
        'warn',
        'Error is not a valid Axios Error, fallback to generic error',
        { error },
      );

      return this.genericRequestError;
    }

    /** If error is an instance of Error, keep the message */
    if (error instanceof Error) {
      this.useLogger(
        this.requestLogger,
        'debug',
        'Error is an instance of Error, keep the message',
        { error },
      );
      return {
        statusCode: this.genericRequestError.statusCode,
        error     : error.name,
        message   : error.message,
      };
    }

    /** Fallback to generic Error */
    this.useLogger(
      this.requestLogger,
      'warn',
      'Fallback to generic Error',
      { error },
    );
    return this.genericRequestError;
  }


  /* --------
   * Client Event Emitter Settings
   * -------- */
  private readonly events = new EventEmitter();


  public subscribeToClientStateChange(
    callback: ClientEventHandler<UserData>,
    context?: any,
  ): ClientUnsubscribe {
    /** Wrap the callback to a known function */
    const wrappedCallback = () => {
      callback.apply(context, [ this.state ]);
    };
    /** Create a new Listener to Client State Change event */
    this.useLogger(
      this.eventLogger,
      'debug',
      'A new observer has been registered for clientState event',
      { callback, context },
    );
    this.events.on('clientStateChange', wrappedCallback);
    /** Return a function to unsubscribe the listener */
    return () => {
      /** Remove the listener */
      this.events.off('clientStateChange', wrappedCallback);
      this.useLogger(
        this.eventLogger,
        'debug',
        'An observer for clientState event has been removed',
        { callback, context },
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

    this.useLogger(
      this.eventLogger,
      'debug',
      'Emitting clientStateChange event',
      { currentState: this.state },
    );

    this.events.emit('clientStateChange');
  }


  /* --------
   * Client Instance Props and Data
   * -------- */
  private _state: Omit<ClientState<UserData>, 'hasAuth'> = {
    isLoaded           : false,
    isPerformingRequest: false,
    userData           : null,
  };

  private _tokens: ClientTokens = {
    accessToken : undefined,
    refreshToken: undefined,
  };


  /* --------
   * Client Instance Creator
   * -------- */
  private constructor(config: ClientConfiguration) {
    /** Assert Configuration is a Valid Object */
    invariant(
      typeof config === 'object' && config !== null && !Array.isArray(config),
      'Configuration params must be a valid ClientConfiguration object.\n'
      + `It was received ${typeof config} instead.`,
    );


    // ----
    // Set up Logger Feature
    // ----
    const { logger = { enabled: false } } = config;

    if (logger.enabled) {
      /** Set the Minimum Logger Level */
      if (logger.minLogLevel) {
        this.loggerConfig.minLogLevel = logger.minLogLevel;
      }
      /** Set the silence in production variable */
      this.loggerConfig.silenceInProduction = logger.silenceInProduction ?? true;
      /** Enable the Logger */
      this._features.logger = true;
    }


    this.useLogger(this.initLogger, 'debug', 'Hello, Client Logger has been enabled!');


    // ----
    // Initialize the Local DB
    // ----
    const { localStorage = { enabled: false } } = config;

    if (localStorage.enabled) {
      /** Strip options */
      const {
        enabled,
        storeAccessTokenIn,
        storeRefreshTokenIn,
        storeUserDataIn,
        ...localforageConfig
      } = localStorage;

      /** Create the new Instance of the LocalForage Module */
      try {
        /** Create the Instance */
        this.db = localforage.createInstance(localforageConfig);
        /** Enable Feature */
        this._features.localStorage = true;
        /** Set Config */
        this.localStorageSettings = {
          storeAccessTokenIn,
          storeRefreshTokenIn,
          storeUserDataIn,
        };
        /** Show success */
        this.useLogger(this.initLogger, 'debug', 'The LocalStorage instance has been created');
      }
      catch (e) {
        /** Remove instance */
        this.db = undefined;
        /** Remove feature */
        this._features.localStorage = false;
        /** Show the error */
        this.useLogger(
          this.initLogger,
          'error',
          'Ops, it looks like you could not use LocalStorage. An error occurred, i\'ll show you',
          e,
        );
      }
    }


    // ----
    // Set up Axios Instance
    // ----
    const { axiosSettings, requests } = config;

    /** Get Configuration using Environment */
    this.useLogger(this.initLogger, 'debug', 'Loading AxiosConfiguration settings');

    if (process.env.NODE_ENV && typeof (axiosSettings as Record<string, AxiosRequestConfig>)[process.env.NODE_ENV] === 'object') {
      this.useLogger(this.initLogger, 'debug', `Loading AxiosConfiguration for ${process.env.NODE_ENV} environment`);
    }

    const environmentSettings = process.env.NODE_ENV
      ? (axiosSettings as Record<string, AxiosRequestConfig>)[process.env.NODE_ENV] ?? (axiosSettings as AxiosRequestConfig)
      : axiosSettings as AxiosRequestConfig;

    /** Assert Configuration is a valid object */
    invariant(
      typeof environmentSettings === 'object' && environmentSettings !== null && typeof environmentSettings.baseURL === 'string',
      'An invalid configuration object has been found to create a correct Axios Instance.\n'
      + 'The \'baseURL\' key is a required parameter.',
    );

    /** Initialize the client */
    this.client = axios.create(environmentSettings);

    this.useLogger(this.initLogger, 'debug', 'Axios Instance created successfully');

    /** Set settings */
    this.requestsSettings = requests ?? {};

    this.useLogger(this.initLogger, 'debug', 'Loaded Requests Settings Object');
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
      refreshToken: undefined,
    };

    /** Remove LocalStorage element */
    if (this.db) {
      if (this.localStorageSettings.storeAccessTokenIn) {
        await this.db.removeItem(this.localStorageSettings.storeAccessTokenIn);
      }
      if (this.localStorageSettings.storeRefreshTokenIn) {
        await this.db.removeItem(this.localStorageSettings.storeRefreshTokenIn);
      }
      if (this.localStorageSettings.storeUserDataIn) {
        await this.db.removeItem(this.localStorageSettings.storeUserDataIn);
      }
    }

    /** Update the state */
    this.setState({ userData: null });
  }


  /* --------
   * UserData Management
   * -------- */
  private async saveUserData(userData?: UserData): Promise<void> {
    this.setState({
      userData: userData ?? null,
    });

    if (this.db && this.localStorageSettings.storeUserDataIn) {
      if (userData) {
        await will(
          this.db.setItem(this.localStorageSettings.storeUserDataIn, userData),
        );
      }
      else {
        await will(
          this.db.removeItem(this.localStorageSettings.storeUserDataIn),
        );
      }
    }
  }


  /* --------
   * Public Getters
   * -------- */
  public get state(): ClientState<UserData> {
    return {
      ...this._state,
      hasAuth: !!this._state.userData && this.hasValidAccessToken && this.hasValidRefreshToken,
    };
  }


  private get hasValidAccessToken(): boolean {
    /** If requests won't use access token, return always true */
    if (!this.requestsSettings.useAccessToken) {
      this.useLogger(
        this.authLogger,
        'debug',
        'Client is not using AccessToken validation.',
      );
      return true;
    }

    /** Assert accessToken is a valid object */
    if (typeof this._tokens.accessToken !== 'object' || this._tokens.accessToken === null) {
      this.useLogger(
        this.authLogger,
        'debug',
        'AccessToken object container not a valid object.',
      );
      return false;
    }

    /** Assert access token token field is a string */
    if (!this._tokens.accessToken.token?.length) {
      this.useLogger(
        this.authLogger,
        'debug',
        'AccessToken object container does not contain a valid token.',
      );
      return false;
    }

    /** Get validity with/without threshold */
    const isValidWithoutThreshold = (this._tokens.accessToken.expiresAt || 0) > Date.now();
    const isValidWithThreshold = (
      (this._tokens.accessToken.expiresAt || 0)
      + (this.requestsSettings.accessTokenValidityThreshold || 0)
    ) > Date.now();

    if (!isValidWithoutThreshold) {
      this.useLogger(
        this.authLogger,
        'warn',
        'An AccessToken has been found, but its expired.',
      );
    }

    if (isValidWithoutThreshold && !isValidWithThreshold) {
      this.useLogger(
        this.authLogger,
        'debug',
        'An AccessToken has been found, but could be expired. Limit threshold has passed.',
      );
    }

    /** Use token validity threshold to assert token could be used */
    return isValidWithThreshold && isValidWithoutThreshold;
  }


  private get hasValidRefreshToken(): boolean {
    /** If requests won't use access token, return always true */
    if (!this.requestsSettings.useRefreshToken) {
      this.useLogger(
        this.authLogger,
        'debug',
        'Client is not using RefreshToken validation.',
      );
      return true;
    }

    /** Assert accessToken is a valid object */
    if (typeof this._tokens.refreshToken !== 'object' || this._tokens.refreshToken === null) {
      this.useLogger(
        this.authLogger,
        'debug',
        'RefreshToken object container not a valid object.',
      );
      return false;
    }

    /** Assert access token token field is a string */
    if (!this._tokens.refreshToken.token?.length) {
      this.useLogger(
        this.authLogger,
        'debug',
        'RefreshToken object container does not contain a valid token.',
      );
      return false;
    }

    /** Get validity with/without threshold */
    const isValidWithoutThreshold = (this._tokens.refreshToken.expiresAt || 0) > Date.now();
    const isValidWithThreshold = (
      (this._tokens.refreshToken.expiresAt || 0)
      + (this.requestsSettings.refreshTokenValidityThreshold || 0)
    ) > Date.now();

    if (!isValidWithoutThreshold) {
      this.useLogger(
        this.authLogger,
        'warn',
        'A RefreshToken has been found, but its definitely expired.',
      );
    }

    if (isValidWithoutThreshold && !isValidWithThreshold) {
      this.useLogger(
        this.authLogger,
        'debug',
        'A RefreshToken has been found, but could be expired. Limit threshold has passed.',
      );
    }

    /** Use token validity threshold to assert token could be used */
    return isValidWithThreshold && isValidWithoutThreshold;
  }


  /* --------
   * Private Methods
   * -------- */
  private setState(newState: Partial<Omit<ClientState<UserData>, 'hasAuth'>>): void {
    /** Set the new state */
    this._state = {
      ...this._state,
      ...newState,
    };
    /** Dispatch state change */
    this.dispatchClientStateChange();
  }


  /* --------
   * Requests Methods
   * -------- */
  public async willGet<T>(url: string, options?: Omit<ClientRequestParams, 'data'>) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'GET',
    });
  }


  public async get<T>(url: string, options?: Omit<ClientRequestParams, 'data'>) {
    return this.request<T>({
      ...options,
      url,
      method: 'GET',
    });
  }


  public async willPost<T>(url: string, options?: ClientRequestParams) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'POST',
    });
  }


  public async post<T>(url: string, options?: ClientRequestParams) {
    return this.request<T>({
      ...options,
      url,
      method: 'POST',
    });
  }


  public async willPut<T>(url: string, options?: ClientRequestParams) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'PUT',
    });
  }


  public async put<T>(url: string, options?: ClientRequestParams) {
    return this.request<T>({
      ...options,
      url,
      method: 'PUT',
    });
  }


  public async willPatch<T>(url: string, options?: ClientRequestParams) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'PATCH',
    });
  }


  public async patch<T>(url: string, options?: ClientRequestParams) {
    return this.request<T>({
      ...options,
      url,
      method: 'PATCH',
    });
  }


  public async willDelete<T>(url: string, options?: ClientRequestParams) {
    return this.willRequest<T>({
      ...options,
      url,
      method: 'DELETE',
    });
  }


  public async delete<T>(url: string, options?: ClientRequestParams) {
    return this.request<T>({
      ...options,
      url,
      method: 'DELETE',
    });
  }


  public async willRequest<T = GenericAPIResponse>(
    config: ClientRequest,
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
    if (this.requestsSettings.switchClientRequestState) {
      this.setState({ isPerformingRequest: true });
    }

    /** Deconstruct Config */
    const {
      url: _url,
      method,
      data,
      params = {},
      withAccessToken = true,
      withRefreshToken = false,
    } = config;

    /** Prepare the Request URL */
    const url = this.prepareURL(_url);

    /** Make the Request */
    try {

      // ----
      // Build Header, including token if they are requested
      // ----
      const headers: Record<string, string> = {};

      /** Append the AccessToken, if something goes wrong, getAccessToken will throw its error */
      if (withAccessToken && this.requestsSettings.useAccessToken) {
        /** Get the AccessToken */
        const accessToken = await this.getAccessToken();
        /** Set the Token into the Request */
        if (this.requestsSettings.accessTokenPosition === 'header') {
          this.useLogger(
            this.requestLogger,
            'debug',
            'Setting AccessToken into headers',
          );
          headers[this.requestsSettings.accessTokenField] = accessToken;
        }
        else if (this.requestsSettings.accessTokenPosition === 'query') {
          this.useLogger(
            this.requestLogger,
            'debug',
            'Setting AccessToken into query parameters',
          );
          params[this.requestsSettings.accessTokenField] = accessToken;
        }
      }

      /** Append RefreshToken, If something goes wrong, getRefreshToken will throw its error */
      if (withRefreshToken && this.requestsSettings.useRefreshToken) {
        /** Get the AccessToken */
        const refreshToken = await this.getRefreshToken();
        /** Set the Token into the Request */
        if (this.requestsSettings.refreshTokenPosition === 'header') {
          headers[this.requestsSettings.refreshTokenField] = refreshToken;
        }
        else if (this.requestsSettings.refreshTokenPosition === 'query') {
          params[this.requestsSettings.refreshTokenField] = refreshToken;
        }
      }

      this.useLogger(
        this.requestLogger,
        'debug',
        `Performing a '${config.method}' Request to '${config.url}'`,
        { params, data },
      );

      /** Make the Request */
      const response = await this.client({
        url,
        method,
        headers,
        params,
        data,
      }) as AxiosResponse<T>;

      this.useLogger(
        this.requestLogger,
        'debug',
        `Response received from '${config.url}'`,
        { response },
      );

      /** Remove loading state */
      if (this.requestsSettings.switchClientRequestState) {
        this.setState({ isPerformingRequest: false });
      }

      /** Return the Response */
      return response.data;
    }
    catch (e) {
      this.useLogger(
        this.requestLogger,
        'error',
        `An error has been received from '${config.url}'`,
        { e },
      );

      /** Remove loading state */
      if (this.requestsSettings.switchClientRequestState) {
        this.setState({ isPerformingRequest: false });
      }

      /** Throw the Error */
      throw this.parseRequestError(e);
    }
  }


  /* --------
   * Token Management
   * -------- */
  private async getAccessToken(): Promise<string> {
    if (!this.requestsSettings.useAccessToken) {
      return '';
    }

    this.useLogger(
      this.authLogger,
      'debug',
      'Retrieving the AccessToken',
    );

    /** Check if current access token could be used */
    if (this.hasValidAccessToken) {
      this.useLogger(
        this.authLogger,
        'debug',
        'AccessToken loaded from Local Client object',
      );
      return this._tokens.accessToken!.token!;
    }

    /**
     * If the Access Token could not be used
     * must refresh it using the current refresh token
     */
    this.useLogger(
      this.authLogger,
      'debug',
      'Try to grant a new AccessToken',
    );
    const [ refreshAccessTokenError, accessToken ] = await this.willRequest<ClientToken>({
      method          : 'GET',
      url             : '/auth/grant-access',
      withRefreshToken: true,
      withAccessToken : false,
    });

    /**
     * An error received while granting a new AccessToken
     * must invalide the Auth, if is set into Client Class
     */
    if (refreshAccessTokenError) {
      this.useLogger(
        this.authLogger,
        'error',
        'An error occurred loading AccessToken',
        { refreshAccessTokenError },
      );
      if (this.requestsSettings.accessTokenRefreshErrorWillInvalidateAuth) {
        await this.resetClientAuth();
      }

      throw refreshAccessTokenError;
    }

    /** Update the Tokens Field and Local Db Object */
    await this.saveAccessToken(accessToken);

    /** Return the newly regenerated token */
    return accessToken?.token || '';
  }


  /* --------
   * Tokens Management
   * -------- */
  private async getRefreshToken(): Promise<string> {
    if (!this.requestsSettings.useRefreshToken) {
      return '';
    }

    this.useLogger(
      this.authLogger,
      'debug',
      'Retrieving the RefreshToken',
    );

    /** Check if current access token could be used */
    if (this.hasValidRefreshToken) {
      this.useLogger(
        this.authLogger,
        'debug',
        'RefreshToken loaded from Local Client object.',
      );
      return this._tokens.refreshToken!.token!;
    }

    /** If token does not exists, try loading from localdb */
    if (this.db && this.localStorageSettings.storeRefreshTokenIn) {
      this.useLogger(
        this.authLogger,
        'debug',
        'Loading RefreshToken from Local Storage',
      );
      const [ loadDbError, localRefreshToken ] = await will(
        this.db.getItem(this.localStorageSettings.storeRefreshTokenIn),
      );

      if (loadDbError) {
        throw loadDbError;
      }

      this.useLogger(
        this.authLogger,
        localRefreshToken ? 'debug' : 'warn',
        localRefreshToken ? 'Local Refresh Token found' : 'No local Refresh Token found',
      );

      this._tokens.refreshToken = (localRefreshToken ?? undefined) as ClientToken;

      /** Assert RefreshToken field validity */
      if (!this.hasValidRefreshToken) {
        throw new Error('Invalid Refresh Token');
      }

      return this._tokens.refreshToken!.token!;
    }

    return '';
  }


  /**
   * Save the Access Token into the LocalDB
   * @param accessToken
   * @private
   */
  private async saveAccessToken(accessToken: ClientToken): Promise<void> {
    this.useLogger(
      this.authLogger,
      'debug',
      'Saving a new Access Token',
    );

    if (this.db && this.localStorageSettings.storeAccessTokenIn) {
      const [ saveError ] = await will(
        this.db.setItem(this.localStorageSettings.storeAccessTokenIn, accessToken),
      );

      if (saveError) {
        this.useLogger(
          this.authLogger,
          'error',
          'An error occurred while saving AccessToken into LocalStorage',
          { saveError },
        );

        throw saveError;
      }
    }

    this._tokens.accessToken = accessToken;
  }


  /**
   * Save the Refresh Token into the Local DB
   * @param refreshToken
   * @private
   */
  private async saveRefreshToken(refreshToken: ClientToken): Promise<void> {
    this.useLogger(
      this.authLogger,
      'debug',
      'Saving a new Refresh Token',
    );

    if (this.db && this.localStorageSettings.storeRefreshTokenIn) {
      const [ saveError ] = await will(
        this.db.setItem(this.localStorageSettings.storeRefreshTokenIn, refreshToken),
      );

      if (saveError) {
        this.useLogger(
          this.authLogger,
          'error',
          'An error occurred while saving RefreshToken into LocalStorage',
          { saveError },
        );

        throw saveError;
      }
    }

    this._tokens.refreshToken = refreshToken;
  }
}


export default Client;
