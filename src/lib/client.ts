import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import axios from 'axios';
import { EventEmitter } from 'events';

import localforage from 'localforage';

import logdown from 'logdown';
import invariant from 'tiny-invariant';

import { will } from '../utils';

import {
  AccessToken,
  ClientRequest,
  ClientRequestError,
  ClientRequestParams,
  ClientState,
  ClientTokens,
  ClientWillResponse,
  EventUnsubscribe,
  GenericAPIResponse,
  RefreshToken,
  ServerEvent,
  WebSocketEvent,
  WebSocketState
} from './client.interfaces';

import { getProcessDependingValue, ProcessDependingField } from './utils/getProcessDependingValue';
import { prepareURL } from './utils/prepareURL';


/* --------
 * Internal Types
 * -------- */
type ClientLogLevel = 'debug' | 'warn' | 'error';

type ClientLoggers = 'auth' | 'error-parser' | 'event' | 'init' | 'request' | 'socket' | 'state' | 'storage';


/* --------
 * Client Configuration Object
 * -------- */
export interface ClientConfiguration<UserData, Storage extends Record<string, any>> {
  /** Default API Request */
  api: {
    /** An API Config used to create new User */
    createUserWithEmailAndPassword?: ClientRequest | ((client: Client<UserData, Storage>) => ClientRequest);
    /** An API Config used to load UserData */
    getUserData: ClientRequest | ((client: Client<UserData, Storage>) => ClientRequest);
    /** An API Config used to retrieve a new AccessToken */
    grantAccessToken?: ClientRequest | ((client: Client<UserData, Storage>) => ClientRequest);
    /** An API Config used to login with email and password */
    loginWithEmailAndPassword?: ClientRequest | ((client: Client<UserData, Storage>) => ClientRequest);
    /** An API Config used to perform logout */
    logout?: ClientRequest | ((client: Client<UserData, Storage>) => ClientRequest);
  },

  /** Configure Auth */
  auth?: {
    /** Set the AccessToken validity threshold */
    accessTokenValidityThreshold?: number;
    /** Place accessToken into Authorization Header as Bearer Token */
    accessTokenAsBearerToken?: boolean;
    /** The header name into place the accessToken string */
    accessTokenHeaderName?: string;
    /** The field into save accessToken to use in request */
    accessTokenStorageField?: string;
    /** Extract the AccessToken from auth Response */
    extractAccessTokenFromAuthResponse?: (
      authResponse: any,
      client: Client<UserData, Storage>
    ) => AccessToken | undefined;
    /** Extract the RefreshToken from auth Response */
    extractRefreshTokenFromAuthResponse?: (
      authResponse: any,
      client: Client<UserData, Storage>
    ) => RefreshToken | undefined;
    /** Extract the UserData from auth Response */
    extractUserDataFromAuthResponse?: (authResponse: any, client: Client<UserData, Storage>) => UserData | undefined;
    /** A checker to get if AccessToken is Valid */
    hasValidAccessToken?: (accessToken: AccessToken | undefined, client: Client<UserData, Storage>) => boolean;
    /** A checker to get if RefreshToken is Valid */
    hasValidRefreshToken?: (refreshToken: RefreshToken | undefined, client: Client<UserData, Storage>) => boolean;
    /** Invalidate the Auth if an AccessToken error will occur */
    invalidateAfterAccessTokenError?: boolean;
    /** The header name into place the refreshToken string */
    refreshTokenHeaderName?: string;
    /** The field into save refreshToken to use in request */
    refreshTokenStorageField?: string;
    /** The field into save userData */
    userDataStorageField?: string;
  };

  /** Configure debugger */
  debug?: {
    /** Enable the Debugger */
    enabled?: ProcessDependingField<boolean>;
    /** The minimum log level to show */
    logLevel?: ProcessDependingField<ClientLogLevel>;
    /** Omit logging for one or more namespace */
    omitLogging?: ProcessDependingField<ClientLoggers[]>;
  },

  /** Configure the Local Database */
  localDb?: {
    /** Set a description for the Storage */
    description?: ProcessDependingField<string>;
    /** Set the name of the Storage */
    name: ProcessDependingField<string>;
    /** Set the Storage Store Name */
    storeName: ProcessDependingField<string>;
    /** Set the version of the Storage */
    version: ProcessDependingField<number>;
  };

  /** Configure the requests */
  requests?: {
    /** Add any other Axios Options */
    axiosConfig?: Partial<AxiosRequestConfig>
    /** Change client state while request is in progress */
    changeClientState?: ProcessDependingField<boolean>;
    /** Defaults defined params of Request function */
    defaults?: ClientRequestParams;
    /** Set the base URL */
    domain: ProcessDependingField<string>;
    /** If a namespace must be appended to URL set this property */
    namespace?: ProcessDependingField<string>;
    /** Set the Port */
    port?: ProcessDependingField<number>;
    /** Build the URL with https protocol */
    secure?: ProcessDependingField<boolean>;
    /** Set the timeout */
    timeout?: ProcessDependingField<number>;
  },

  /** System Configuration */
  system?: {
    /** Replace the init function */
    onInit?: ((client: Client<UserData, Storage>) => Promise<UserData | null>)
  },

  /** WebSocket Option */
  websocket?: {
    /** A function to know if socket could exists or not */
    couldHaveSocket?: ((state: ClientState<UserData>) => boolean) | boolean;
    /** Get Socket Protocol */
    getProtocol?: ((client: Client<UserData, Storage>) => string);
    /** Set the base URL */
    domain: ProcessDependingField<string>;
    /** If a namespace must be appended to URL set this property */
    namespace?: ProcessDependingField<string>;
    /** Set the Port */
    port?: ProcessDependingField<number>;
    /** Build the URL with https protocol */
    secure?: ProcessDependingField<boolean>;
  }
}


/* --------
 * Client Definition
 * -------- */
export default class Client<UserData, Storage extends {} = {}> {


  /* --------
   * Singleton Methods
   * --
   * Prepare the Client as a Singleton.
   * Only one Client per App could exists.
   * -------- */

  /** Init a Client Container */
  private static _instance: Client<any, any> | null = null;


  /** Declare a function to get Client instance */
  public static getInstance<UD, S>(config?: ClientConfiguration<UD, S>): Client<UD, S> {
    /** If a Client instance doesn't exists, create a new one */
    if (!Client._instance) {
      invariant(config, 'Could not load a new Client without configuration.');
      Client._instance = new Client(config);
    }
    /** Return the Singleton Instance of Client */
    return Client._instance;
  }


  /* --------
   * Internal Storage
   * -------- */
  public storage: Storage = {} as Storage;


  /* --------
   * Client State and WebSocket State
   * -------- */
  private _state: Omit<ClientState<UserData>, 'hasAuth'> = {
    isLoaded           : false,
    isPerformingRequest: false,
    userData           : null
  };

  private _tokens: ClientTokens = {
    accessToken : undefined,
    refreshToken: undefined
  };

  private _socketState: WebSocketState = {
    hasError         : false,
    isClosing        : false,
    isConnecting     : false,
    isConnected      : false,
    reconnectionCount: -1,
    version          : null
  };


  /**
   * Edit the current state of the Client.
   * This function will shallow update the state
   * so can be passed also a Partial of ClientState.
   * hasAuth property is a calculated property, so is omitted
   * @param newState
   * @private
   */
  private setState(newState: Partial<Omit<ClientState<UserData>, 'hasAuth'>>): void {
    /** Set the new state */
    this._state = {
      ...this.state,
      ...newState
    };

    /** Dispatch the Event */
    this.useLogger('state', 'debug', 'A state update has been called', { newState, state: this.state });
    this.dispatchClientStateChange();
  }


  /**
   * Edit the current state of the Socket.
   * This function will shallow update the state
   * so can be passed also a Partial of SocketState.
   * It will check if any property is changed to
   * avoid multiple dispatching of new state also when
   * nothing has been updated
   * @param newState
   * @private
   */
  private setSocketState(newState: Partial<WebSocketState>): void {
    /** Check if some key has changed, and update only if need */
    const willChange = (Object.keys(newState) as (keyof WebSocketState)[]).reduce((isChanged, key) => (
      isChanged || newState[key] !== this._socketState[key]
    ), false);

    if (!willChange) {
      return;
    }

    /** Set the new state */
    this._socketState = {
      ...this._socketState,
      ...newState
    };

    /** Dispatch Event */
    this.useLogger('state', 'debug', 'A socket state update has been called', { newState, state: this.socketState });
    this.dispatchWebSocketStateChange();
  }


  /* --------
   * Event Emitter
   * --
   * This section is basically used by the Client itself
   * to generate a new event emitter and to save event listener
   * -------- */
  private events: EventEmitter;

  // ----
  // Dispatcher
  // ----

  /**
   * Emit the event to let any listener know that
   * the Client State has been updated.
   * Calling this when the client is not loaded
   * will produce no effect
   * @private
   */
  private dispatchClientStateChange(): void {
    /** If client is still no loaded, avoid dispatching */
    if (!this._state.isLoaded) {
      this.useLogger(
        'event',
        'warn',
        'A dispatchClientStateChange has been blocked because Client is still no loaded',
        this.state
      );
      return;
    }

    /** Emit the event */
    this.useLogger('event', 'debug', 'Dispatching a new ClientStateChange event', this.state);
    this.events.emit('client::stateChange', this.state);
  }


  /**
   * Emit the event to let any listener know that
   * the Socket State has been updated
   * Calling this when the client is not loaded
   * will produce no effect
   * @private
   */
  private dispatchWebSocketStateChange(): void {
    /** If client is still no loaded, avoid dispatching */
    if (!this._state.isLoaded) {
      this.useLogger(
        'event',
        'warn',
        'A dispatchWebSocketStateChange has been blocked because Client is still no loaded',
        this.socketState
      );
      return;
    }

    /** Emit the event */
    this.useLogger('event', 'debug', 'Dispatching a new WebSocketStateChange event', this.socketState);
    this.events.emit('client::webSocketStateChange', this.socketState);
  }


  /**
   * Emit the event to let any listener know that
   * a new Socket Message has been received
   * Calling this when the client is not loaded
   * will produce no effect
   * @private
   */
  private dispatchSocketMessage(event: WebSocketEvent): void {
    /** If client is still no loaded, avoid dispatching */
    if (!this._state.isLoaded) {
      this.useLogger(
        'event',
        'warn',
        'A dispatchSocketMessage has been blocked because Client is still no loaded',
        event
      );
      return;
    }

    /** Emit the event */
    this.useLogger('event', 'debug', 'Dispatching a new SocketMessage event', event);
    this.events.emit('client::socketMessage', event);
  }


  // ----
  // Subscribers
  // ----

  /**
   * Add a new Observer that will be fired every
   * once the Client State is changed
   * @param callback
   * @param context
   */
  public subscribeToClientStateChange(
    callback: (clientState: ClientState<UserData>) => void,
    context?: any
  ): EventUnsubscribe {
    /** Wrap the callback to a well know function to be unsubscribed later */
    const wrappedCallback = () => {
      callback.apply(context, [ this.state ]);
    };

    /** Attach the new Listener */
    this.useLogger('event', 'debug', 'A new observer has been registered for clientState event', { callback, context });
    this.events.on('client::stateChange', wrappedCallback);

    /** Return a function to unsubscribe the listener */
    return () => {
      /** Remove the listener */
      this.events.off('client::stateChange', wrappedCallback);
      this.useLogger('event', 'debug', 'An observer for clientState event has been removed', { callback, context });
    };
  }


  /**
   * Add a new Observer that will be fired every
   * once the Socket State is changed
   * @param callback
   * @param context
   */
  public subscribeToWebSocketStateChange(
    callback: (webSocketState: WebSocketState) => void,
    context?: any
  ): EventUnsubscribe {
    /** Wrap the callback to a well know function to be unsubscribed later */
    const wrappedCallback = () => {
      callback.apply(context, [ this.socketState ]);
    };

    /** Attach the new Listener */
    this.useLogger(
      'event',
      'debug',
      'A new observer has been registered for webSocketState event',
      { callback, context }
    );
    this.events.on('client::webSocketStateChange', wrappedCallback);

    /** Return a function to unsubscribe the listener */
    return () => {
      /** Remove the listener */
      this.events.off('client::webSocketStateChange', wrappedCallback);
      this.useLogger('event', 'debug', 'An observer for webSocketState event has been removed', { callback, context });
    };
  }


  /**
   * Add a new Observer that will be fired every
   * once a new Socket Message is received
   * @param callback
   * @param namespace
   * @param context
   */
  public subscribeToSocketEvent(
    callback: (event: WebSocketEvent) => void,
    namespace?: string,
    context?: any
  ): EventUnsubscribe {
    /** Wrap the callback to a well know function to be unsubscribed later */
    const wrappedCallback = (data: WebSocketEvent) => {
      /** If a namespace has been specified, use to filter event */
      if (namespace && data.namespace !== namespace) {
        return;
      }
      /** Call the callback handler */
      callback.apply(context, [ data ]);
    };

    /** Attach the new Listener */
    this.useLogger(
      'event',
      'debug',
      'A new observer has been registered for socketMessage event',
      { callback, namespace, context }
    );
    this.events.on('client::socketMessage', wrappedCallback);

    /** Return a function to unsubscribe the listener */
    return () => {
      /** Remove the listener */
      this.events.off('client::socketMessage', wrappedCallback);
      this.useLogger(
        'event',
        'debug',
        'An observer for socketMessage event has been removed',
        { callback, namespace, context }
      );
    };
  }


  /* --------
   * Logger Instance and Helpers
   * --
   * The set of tools to make the Client Debug work
   * -------- */
  private readonly isLoggerEnabled: boolean = false;

  private readonly minLogLevel: ClientLogLevel = 'error';

  private readonly omitLoggingFor: ClientLoggers[] = [];

  private readonly loggers: Record<ClientLoggers, logdown.Logger> = {
    auth          : logdown('client :: auth'),
    'error-parser': logdown('client :: error-parser'),
    event         : logdown('client :: event'),
    init          : logdown('client :: init'),
    request       : logdown('client :: request'),
    socket        : logdown('client :: socket'),
    state         : logdown('client :: state'),
    storage       : logdown('client :: storage')
  };


  /**
   * Use a Logger to print debug information into console
   * @param logger
   * @param level
   * @param args
   * @private
   */
  private useLogger(logger: ClientLoggers, level: ClientLogLevel, ...args: any[]) {
    /** If logger is not enabled, return */
    if (!this.isLoggerEnabled || this.omitLoggingFor.includes(logger)) {
      return;
    }

    /** Create the level matrix */
    const logLevels: Record<ClientLogLevel, number> = {
      debug: 0,
      warn : 5,
      error: 10
    };

    if (logLevels[level] < logLevels[this.minLogLevel]) {
      return;
    }

    /** Enable Logger */
    if (!this.loggers[logger].state.isEnabled) {
      this.loggers[logger].state.isEnabled = true;
    }

    /** Use the logger */
    this.loggers[logger][level](...args);
  }


  /* --------
   * LocalStorage
   * --
   * The LocalStorage instance and all methods that
   * could be used to get and save data
   * -------- */
  private readonly localStorage: typeof localforage | undefined;


  /**
   * Return the Stored Data using a field
   * using an empty field will return null
   * @param field
   * @private
   */
  private async getStoredData<T>(field?: string | null): Promise<T | null> {
    /** If field is missing, return null */
    if (field === null || field === undefined || !field.length) {
      this.useLogger('storage', 'debug', `Requested store '${field}' is invalid, skip load data.`);
      return null;
    }
    /** If localStorage doesn't exists, return null */
    if (this.localStorage === undefined) {
      this.useLogger('storage', 'debug', 'LocalStorage has not been enabled, skip load data.');
      return null;
    }
    /** Return the stored data */
    const [ loadDataError, data ] = await will(this.localStorage.getItem<T>(field));
    /** Abort if an error occurred */
    if (loadDataError) {
      this.useLogger('storage', 'error', `An error occurred while loading data for field '${field}'.`, loadDataError);
      throw loadDataError;
    }
    /** Return loaded data */
    this.useLogger('storage', 'debug', `Loaded data for field '${field}'.`, data);
    return data;
  }


  /**
   * Save data into Local Storage using a field
   * passing an empty field won't save anything
   * @param field
   * @param data
   * @private
   */
  private async setStoreData<T>(field: string | undefined | null, data: T): Promise<void> {
    /** If field is missing, return */
    if (field === null || field === undefined || !field.length) {
      this.useLogger('storage', 'debug', `Requested store '${field}' is invalid, skip save data.`);
      return;
    }
    /** If localStorage doesn't exists, return */
    if (this.localStorage === undefined) {
      this.useLogger('storage', 'debug', 'LocalStorage has not been enabled, skip save data.');
      return;
    }
    /** Save data */
    const [ saveDataError ] = await will(this.localStorage.setItem(field, data));
    /** Abort if an error occurred */
    if (saveDataError) {
      this.useLogger('storage', 'error', `An error occurred while saving data for field '${field}'.`, saveDataError);
      throw saveDataError;
    }
  }


  /**
   * Remove a property from Local Storage
   * passing an empty field will result in no-op
   * @param field
   * @private
   */
  private async removeStoredData(field: string | undefined | null): Promise<void> {
    /** If field is missing, return */
    if (field === null || field === undefined || !field.length) {
      this.useLogger('storage', 'debug', `Requested store '${field}' is invalid, skip removing data.`);
      return;
    }
    /** If localStorage doesn't exists, return */
    if (this.localStorage === undefined) {
      this.useLogger('storage', 'debug', 'LocalStorage has not been enabled, skip removing data.');
      return;
    }
    /** Remove data */
    const [ removeDataError ] = await will(this.localStorage.removeItem(field));
    /** Abort if an error occurred */
    if (removeDataError) {
      this.useLogger(
        'storage',
        'error',
        `An error occurred while removing data for field '${field}'.`,
        removeDataError
      );
      throw removeDataError;
    }
  }


  /* --------
   * Axios Client
   * --
   * Define the Axios Client Class Field
   * -------- */
  private readonly client: AxiosInstance | undefined;

  private readonly genericRequestError: ClientRequestError = {
    statusCode: 500,
    message   : 'Server Error',
    error     : 'server-error',
    method    : 'GET',
    stack     : 'Generic Request Error',
    url       : 'localhost'
  };


  /**
   * Transform any request error into a formatted
   * ClientRequestError object.
   * If no methods could be applied, the generic request error
   * object describe above will be used
   * @param error
   * @private
   */
  private parseRequestError(error: any): ClientRequestError {
    /** If error is an Array, set data key of the generic object */
    if (typeof error !== 'object' || error === null || Array.isArray(error)) {
      this.useLogger(
        'error-parser',
        'warn',
        'Error is not a valid Object. Putting the original error into data field',
        error
      );
      return this.genericRequestError;
    }

    /** If error is an Axios Error, get props */
    if (error.isAxiosError) {
      const { response, config, stack } = error as AxiosError;

      if (response) {
        this.useLogger('error-parser', 'debug', 'Error is a valid Axios Error. Keeping original properties', response);
        return {
          statusCode: response.status,
          error     : response.data?.error ?? this.genericRequestError.error,
          message   : response.data?.message ?? this.genericRequestError.message,
          method    : config.method?.toUpperCase() ?? this.genericRequestError.method,
          response  : response.data,
          stack,
          url       : config.url ? `${this.client?.defaults.baseURL}/${config.url}` : this.genericRequestError.url
        };
      }

      this.useLogger('error-parser', 'warn', 'Error is not a valid Axios Error, fallback to generic error', error);
      return this.genericRequestError;
    }

    /** If error is an instance of Error, keep the message */
    if (error instanceof Error) {
      this.useLogger('error-parser', 'debug', 'Error is an instance of Error, keep the message', error);
      return {
        statusCode: this.genericRequestError.statusCode,
        error     : error.name,
        message   : error.message,
        method    : this.genericRequestError.method,
        stack     : error.stack,
        url       : window.location.href
      };
    }

    /** If error is an object, keep existing properties */
    if (typeof error === 'object') {
      this.useLogger('error-parser', 'debug', 'Error is a plain object, keep properties', error);
      return {
        statusCode: error.statusCode || this.genericRequestError.statusCode,
        error     : error.name || 'client-error',
        message   : error.message || this.genericRequestError.message,
        method    : error.method || this.genericRequestError.method,
        stack     : error.stack || undefined,
        url       : error.url || window.location.href
      };
    }

    /** Fallback to generic Error */
    this.useLogger(
      'error-parser',
      'debug',
      'None of the possibilities are satisfied. Fallback to generic Error',
      error
    );
    return this.genericRequestError;
  }


  /* --------
   * WebSocket Connection Manager
   * --
   * Assert and initialize the WebSocket
   * -------- */
  private socket: WebSocket | undefined;

  private socketReconnectionInterval: NodeJS.Timeout | undefined;


  /**
   * This function will assert the Socket has been instantiated
   * or is destroyed based on the couldHaveSocket function.
   * Without setting this function, no socket will be used
   * @private
   */
  private assertSocketClient(): void {
    /** Check if the client could have a socket */
    const couldHaveSocket: boolean = this.config.websocket?.couldHaveSocket !== undefined
      ? typeof this.config.websocket.couldHaveSocket === 'function'
        ? this.config.websocket.couldHaveSocket(this.state)
        : !!(this.config.websocket.couldHaveSocket)
      : false;

    /** If the client could have a socket, but socket is undefined, create a new one */
    if (couldHaveSocket && !this.socket) {
      this.useLogger('socket', 'debug', 'A socket could exists but its currently undefined');
      this.initializeSocketClient();
    }
    /** Else, if the client has a socket, but could not have one, remove it */
    else if (!couldHaveSocket && this.socket) {
      this.useLogger('socket', 'debug', 'A socket could not exists but its currently on');
      this.destroySocketClient();
    }
  }


  /**
   * Create the Socket using configuration
   * and attach all event listener to connection
   * @private
   */
  private initializeSocketClient(): void {
    /** Check the WebSocket configuration exists */
    if (!this.config.websocket?.domain) {
      this.useLogger('socket', 'warn', 'WebSocket has not been configured. Domain is required');
      return;
    }

    /** If socket is connecting, abort */
    if (this.socketState.isConnecting && !this.socketState.hasError) {
      return;
    }

    /** Set the connecting state */
    this.setSocketState({ isConnecting: true });

    this.useLogger('socket', 'debug', 'The WebSocket is initializing');

    /** Create the new WebSocket */
    try {
      /** Get the Socket URL */
      if (this.config.websocket) {
        /** Check if connection must be secure */
        const isSecure = getProcessDependingValue(this.config.websocket.secure, 'boolean', false) as boolean;
        /** Get the port */
        const port = getProcessDependingValue(this.config.websocket.port, 'number', 80) as number;
        /** Get the namespace */
        const namespace = getProcessDependingValue(this.config.websocket.namespace, 'string', undefined);
        /** Create the base URL */
        const baseURL: string = [
          isSecure ? 'wss://' : 'ws://',
          prepareURL(getProcessDependingValue(this.config.websocket.domain, 'string', 'example.com') as string),
          port !== 80 && `:${port}`,
          namespace && `/${namespace}`
        ].filter(val => typeof val === 'string' && !!val.length).join('');

        const getProtocolFunction = getProcessDependingValue(this.config.websocket.getProtocol, 'function');

        /** Initialize the Socket */
        this.socket = new WebSocket(
          baseURL,
          typeof getProtocolFunction === 'function' ? getProtocolFunction(this) : undefined
        );

        /** Attach Event Listener */
        this.attachSocketListener();
      }
    }
    catch (error) {
      this.useLogger('socket', 'error', 'An error occurred while creating the Socket', error);

      /** Destroy Listener */
      this.removeSocketListener();
    }
  }


  /**
   * Destroy the Socket client and remove
   * all event listener attached on connection
   * @private
   */
  private destroySocketClient(): void {
    /** Assert Socket Client exists and it's not closing */
    if (!this.socket || this.socketState.isClosing) {
      return;
    }

    /** Set the closing state */
    this.setSocketState({ isClosing: true });

    this.useLogger('socket', 'debug', 'The WebSocket is being destroying');

    /** Close the socket connection */
    this.socket.close();

    /** Remove socket listener */
    this.removeSocketListener();

    /** Destroy the socket */
    this.socket = undefined;

    /** Update the Socket State */
    this.setSocketState({ isClosing: false });
  }


  // ----
  // Interval Management
  // ----
  private clearSocketReconnectingInterval(): void {
    /** Clear the Interval only if exists */
    if (this.socketReconnectionInterval) {
      this.useLogger('socket', 'debug', 'Destroying the Socket Reconnection Interval');
      clearInterval(this.socketReconnectionInterval);
      this.socketReconnectionInterval = undefined;
    }
  }


  private setSocketReconnectingInterval(): void {
    /** Abort if an interval already exists */
    if (this.socketReconnectionInterval) {
      return;
    }
    /** Create the new interval */
    this.useLogger('socket', 'debug', 'Creating a new Socket Reconnection Interval');
    this.socketReconnectionInterval = setInterval(this.assertSocketClient.bind(this), 2000);
  }


  // ----
  // Socket Useful
  // ----
  private attachSocketListener(): void {
    /** Assert Socket exists */
    if (!this.socket) {
      return;
    }

    this.useLogger('socket', 'debug', 'Attaching Socket Listener');

    this.socket.addEventListener('open', this.onSocketConnected.bind(this));
    this.socket.addEventListener('close', this.onSocketDisconnected.bind(this));
    this.socket.addEventListener('error', this.onSocketError.bind(this));
    this.socket.addEventListener('message', this.onSocketMessageReceived.bind(this));
  }


  private removeSocketListener(): void {
    /** Assert Socket exists */
    if (!this.socket) {
      return;
    }

    this.useLogger('socket', 'debug', 'Destroying Socket Listener');

    this.socket.removeEventListener('open', this.onSocketConnected.bind(this));
    this.socket.removeEventListener('close', this.onSocketDisconnected.bind(this));
    this.socket.removeEventListener('error', this.onSocketError.bind(this));
    this.socket.removeEventListener('message', this.onSocketMessageReceived.bind(this));
  }


  // ----
  // WebSocket Event
  // ----
  private onSocketConnected(event: Event) {
    this.useLogger('socket', 'debug', 'The Socket has been successful Connected', event);

    /** Update the SocketState */
    this.setSocketState({
      hasError         : false,
      isConnecting     : false,
      isConnected      : true,
      reconnectionCount: this.socketState.reconnectionCount + 1
    });

    /** Remove the reconnection interval */
    this.clearSocketReconnectingInterval();
  }


  private onSocketDisconnected(event: Event) {
    this.useLogger('socket', 'debug', 'The Socket has been Disconnected', event);

    /** Set the SocketState */
    this.setSocketState({
      isConnected: false
    });

    /** Destroy the Client */
    this.destroySocketClient();

    /** Start a new reconnection interval */
    this.setSocketReconnectingInterval();
  }


  private onSocketError(event: Event) {
    this.useLogger('socket', 'error', 'WebSocket Communication Error', event);

    /** Reset the SocketState */
    this.setSocketState({
      isConnected: false,
      hasError   : true
    });

    /** Destroy the client */
    this.destroySocketClient();

    /** Start a new reconnection interval */
    this.setSocketReconnectingInterval();
  }


  private onSocketMessageReceived(event: MessageEvent): void {
    this.useLogger('socket', 'debug', 'A new WebSocket message has been received', event);

    /** Get the message data */
    const { data } = event;

    if (typeof data !== 'string') {
      this.useLogger('socket', 'warn', 'Received data is not a valid string and could not be used', data);
    }

    /** Try to parse the data using JSON */
    try {
      const parsed = JSON.parse(data) as ServerEvent;
      this.useLogger('socket', 'debug', 'Parsed data to a valid JSON Object', parsed);

      /** Split the event type to get type and namespace */
      const [ type, namespace ] = parsed.event.split(':');

      /** Socket could also receive a system socket message, that must be handled by Client */
      if (type === 'system') {
        /** If namespace is server, than it is the communication of the server version */
        if (namespace === 'server') {
          /** Assert version is a valid string */
          if (typeof parsed.version === 'string') {
            this.setSocketState({ version: parsed.version });
          }
        }
        return;
      }

      /** Dispatch the Message */
      this.dispatchSocketMessage({
        type     : type as WebSocketEvent['type'],
        namespace: namespace as WebSocketEvent['namespace'],
        entityId : parsed.entityId
      });
    }
    catch (error) {
      this.useLogger('socket', 'error', 'Parsing received data produced an error', { error, data });
    }
  }


  /* --------
   * Private Constructor
   * --
   * The Client could be instantiated only
   * using the getInstance static method
   * -------- */
  private constructor(private readonly config: ClientConfiguration<UserData, Storage>) {

    // ----
    // Initialize the Event Emitter
    // ----
    this.events = new EventEmitter();
    this.events.setMaxListeners(0);


    // ----
    // Configure the Debugger
    // ----
    if (config?.debug) {
      this.isLoggerEnabled = !!getProcessDependingValue(config.debug.enabled, 'boolean', false);
      this.minLogLevel = getProcessDependingValue(config.debug.logLevel, 'string', 'error') as ClientLogLevel;
      this.omitLoggingFor = getProcessDependingValue(config.debug.omitLogging, Array.isArray, []) as ClientLoggers[];
      this.useLogger('init', 'debug', 'Debugger Loaded');
    }


    // ----
    // Instantiate the LocalForage if Configuration exists
    // ----
    if (config?.localDb) {
      this.localStorage = localforage.createInstance({
        description: getProcessDependingValue(config.localDb.description, 'string', undefined),
        name       : getProcessDependingValue(config.localDb.name, 'string', 'DefaultName'),
        storeName  : getProcessDependingValue(config.localDb.storeName, 'string', 'DefaultStoreName'),
        version    : getProcessDependingValue(config.localDb.version, 'number', 1.0)
      });
      this.useLogger('init', 'debug', 'LocalForage Instantiated');
    }


    // ----
    // Instantiate the Axios Client instance
    // ----
    if (config?.requests) {
      /** Check if connection must be secure */
      const isSecure = getProcessDependingValue(config.requests.secure, 'boolean', false) as boolean;
      /** Get the port */
      const port = getProcessDependingValue(config.requests.port, 'number', 80) as number;
      /** Get the namespace */
      const namespace = getProcessDependingValue(config.requests.namespace, 'string', undefined);
      /** Create the base URL */
      const baseURL: string = [
        isSecure ? 'https://' : 'http://',
        prepareURL(getProcessDependingValue(config.requests.domain, 'string', 'example.com') as string),
        port !== 80 && `:${port}`,
        namespace && `/${namespace}`
      ].filter(val => typeof val === 'string' && !!val.length).join('');

      /** Create the Axios Instance */
      this.client = axios.create({
        ...config.requests.axiosConfig,
        baseURL,
        timeout       : getProcessDependingValue(config.requests.timeout, 'number', 15_000),
        validateStatus: status => status >= 200 && status < 300
      });

      this.useLogger('init', 'debug', `Axios Client created with baseURL = ${baseURL}`);
    }


    // ----
    // Initialize the Client
    // ----
    this.__init()
      /** Init Async function will never throw */
      .then(async (maybeUserData) => {
        /** If no user data exists, purge auth */
        if (!maybeUserData) {
          await this.resetClientAuth();
        }
        /** Set the Client as Loaded */
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
  private async __init(): Promise<UserData | null> {
    try {
      /** Initialize default userData object */
      let userData: UserData | null = null;

      /** Check if a custom function of init exists */
      if (typeof this.config.system?.onInit === 'function') {
        userData = await this.config.system.onInit(this);
      }
      /** Else, perform the default init function */
      else {
        /** Get Fresh User Data */
        userData = await this.getUserData();
      }
      /** Save response */
      await this.saveUserData(userData ?? undefined);

      /** Return to constructor */
      return userData;
    }
    catch (error) {
      /** Log the Error */
      this.useLogger('init', 'error', 'An initialize error occurred, maybe the client has no any auth.', error);
      /** Return invalid user data */
      return null;
    }
  }


  /* --------
   * Private Methods
   * -------- */

  /**
   * Update current in memory user data and reflect
   * change into local storage
   * @param userData
   * @private
   */
  private async saveUserData(userData?: UserData): Promise<UserData | undefined> {
    this.useLogger('auth', 'debug', 'Saving new user data', userData);

    this.setState({ userData: userData || null });

    if (userData) {
      await will(this.setStoreData<UserData>(this.config.auth?.userDataStorageField, userData));
    }
    else {
      await will(this.removeStoredData(this.config.auth?.userDataStorageField));
    }

    this.assertSocketClient();

    return userData;
  }


  /**
   * Check the AccessToken validity.
   * This function will use the hasValidAccessToken configuration function
   * if exists, if not it will use a base internal validation.
   * A custom accessToken could be passed to let check if this is valid or not
   * @param accessToken
   * @private
   */
  private hasValidAccessToken(accessToken: AccessToken | undefined = this._tokens.accessToken): accessToken is AccessToken {
    /** If a custom validator has been defined, use it */
    if (typeof this.config.auth?.hasValidAccessToken === 'function') {
      return this.config.auth!.hasValidAccessToken(accessToken, this);
    }

    /** Assert accessToken is a valid object */
    if (typeof accessToken !== 'object' || this._tokens.accessToken === null) {
      return false;
    }

    /** Assert access token token field is a string */
    if (!accessToken.token?.length) {
      return false;
    }

    /** Use token validity threshold to assert token could be used */
    return (accessToken.expiresAt + (this.config.auth?.accessTokenValidityThreshold ?? 0)) > Date.now();
  }


  /**
   * Check the RefreshToken validity.
   * This function will use the hasValidRefreshToken configuration function
   * if exists, if not it will use a base internal validation.
   * A custom refreshToken could be passed to let check if this is valid or not
   * @param refreshToken
   * @private
   */
  private hasValidRefreshToken(refreshToken: RefreshToken | undefined = this._tokens.refreshToken): refreshToken is RefreshToken {
    /** If a custom validator has been defined use it */
    if (typeof this.config.auth?.hasValidRefreshToken === 'function') {
      return this.config.auth!.hasValidRefreshToken(refreshToken, this);
    }

    /** Return the default checker */
    return typeof refreshToken === 'string' && !!refreshToken.length;
  }


  /**
   * Remove any token and any stored data
   * from this instance.
   * After that will remove userData and update the
   * client state
   * @private
   */
  private async resetClientAuth(): Promise<void> {
    this.useLogger('auth', 'debug', 'Resetting the Client Auth');

    /** Revoke all local token */
    this._tokens = {
      accessToken : undefined,
      refreshToken: undefined
    };

    /** Remove LocalStorage element */
    await this.removeStoredData(this.config.auth?.accessTokenStorageField);
    await this.removeStoredData(this.config.auth?.refreshTokenStorageField);
    await this.removeStoredData(this.config.auth?.userDataStorageField);

    /** Remove the web socket instance */
    this.assertSocketClient();

    /** Update the client state */
    this.setState({ userData: null });
  }


  /**
   * Return a valid AccessToken.
   * In order the AccessToken will be load from:
   *  1. The local in memory storage
   *  2. The LocalStorage at configured key
   *  3. From API Server using the refreshToken API passed using configuration
   *
   * If none of the method above will load a valid and correct AccessToken
   * an erro will be thrown.
   * @private
   */
  private async getAccessToken(): Promise<string> {
    this.useLogger('auth', 'debug', 'Load the AccessToken');

    /** Check if current access token is valid */
    if (this.hasValidAccessToken()) {
      this.useLogger('auth', 'debug', 'In Memory AccessToken is valid');
      return this._tokens.accessToken!.token;
    }

    /** If saved access token is invalid, try to load from local storage */
    const loadedAccessToken = await this.getStoredData<AccessToken>(this.config.auth?.accessTokenStorageField);

    /** If local storage access token is valid, return it */
    if (this.hasValidAccessToken(loadedAccessToken || undefined)) {
      this.useLogger('auth', 'debug', 'AccessToken found from LocalStorage');
      this._tokens.accessToken = loadedAccessToken!;
      return loadedAccessToken!.token;
    }

    /** If an API Request has been set, use it to get a new AccessToken */
    if (this.config.api?.grantAccessToken) {
      this.useLogger('auth', 'debug', 'Ask a new Token to API Server');
      /** Make the Request */
      const [ refreshAccessTokenError, accessToken ] = await this.willRequest<AccessToken>(this.config.api.grantAccessToken);

      /** Throw any error from request */
      if (refreshAccessTokenError) {
        this.useLogger('auth', 'error', 'An error has been received from API when asking a new AccessToken');
        /** Check if must invalidate auth */
        if (this.config.auth?.invalidateAfterAccessTokenError) {
          await this.resetClientAuth();
        }

        throw refreshAccessTokenError;
      }

      /** Save the new AccessToken */
      await this.saveAccessToken(accessToken);

      /** Return the token */
      return accessToken.token;
    }

    /** Throw an error to abort any request */
    this.useLogger('auth', 'error', 'No valid method has been found to get an AccessToken');
    throw new Error('Invalid AccessToken');
  }


  /**
   * Save the AccessToken into Local Storage
   * and in memory tokens field
   * @param accessToken
   * @private
   */
  private async saveAccessToken(accessToken?: AccessToken): Promise<AccessToken | undefined> {
    /** Revoke Token if undefined */
    if (accessToken === undefined) {
      this.useLogger('auth', 'debug', 'Removing the AccessToken from Local Storage');
      await this.removeStoredData(this.config.auth?.accessTokenStorageField);
    }
    else {
      this.useLogger('auth', 'debug', 'Saving a new AccessToken into Local Storage');
      await this.setStoreData<AccessToken>(this.config.auth?.accessTokenStorageField, accessToken);
    }

    this._tokens.accessToken = accessToken;

    return accessToken;
  }


  /**
   * Return a valid RefreshToken.
   * In order the RefreshToken will be load from:
   *  1. The local in memory storage
   *  2. The LocalStorage at configured key
   *
   * If none of the method above will load a valid and correct RefreshToken
   * an erro will be thrown.
   * @private
   */
  private async getRefreshToken(): Promise<string> {
    this.useLogger('auth', 'debug', 'Load the RefreshToken');

    /** If a valid RefreshToken already exists, use it */
    if (this.hasValidRefreshToken()) {
      this.useLogger('auth', 'debug', 'In Memory RefreshToken is valid');
      return this._tokens.refreshToken as string;
    }

    /** If saved refresh token is invalid, try to load from local storage */
    const loadedRefreshToken = await this.getStoredData<RefreshToken>(this.config.auth?.refreshTokenStorageField);

    /** If local storage access token is valid, return it */
    if (this.hasValidRefreshToken(loadedRefreshToken || undefined)) {
      this.useLogger('auth', 'debug', 'RefreshToken found from LocalStorage');
      this._tokens.refreshToken = loadedRefreshToken as string;
      return loadedRefreshToken as string;
    }

    /** Throw an error to abort any request */
    this.useLogger('auth', 'error', 'No valid method has been found to get a RefreshToken');
    throw new Error('Invalid RefreshToken');
  }


  /**
   * Save the RefreshToken into local storage
   * and in memory tokens field
   * @param refreshToken
   * @private
   */
  private async saveRefreshToken(refreshToken?: RefreshToken): Promise<RefreshToken | undefined> {
    /** Remove the RefreshToken if is undefined */
    if (refreshToken === undefined) {
      this.useLogger('auth', 'debug', 'Removing the RefreshToken from Local Storage');
      await this.removeStoredData(this.config.auth?.refreshTokenStorageField);
    }
    else {
      this.useLogger('auth', 'debug', 'Saving a new RefreshToken into Local Storage');
      await this.setStoreData<RefreshToken>(this.config.auth?.refreshTokenStorageField, refreshToken);
    }

    this._tokens.refreshToken = refreshToken;

    return refreshToken;
  }


  private extractAccessTokenFromAuthResponse(authResponse: any): AccessToken | undefined {
    /** Get the AccessToken */
    const accessToken = typeof this.config.auth?.extractAccessTokenFromAuthResponse === 'function'
      ? this.config.auth.extractAccessTokenFromAuthResponse(authResponse, this)
      : authResponse.accessToken as (AccessToken | undefined);

    /** Check AccessToken validity */
    if (!this.hasValidAccessToken(accessToken)) {
      this.useLogger(
        'auth',
        'error',
        'Extracting the AccessToken from Auth Response produce an invalid AccessToken',
        { authResponse, accessToken }
      );
    }

    return accessToken;
  }


  private extractRefreshTokenFromAuthResponse(authResponse: any): RefreshToken | undefined {
    /** Get the RefreshToken */
    const refreshToken = typeof this.config.auth?.extractRefreshTokenFromAuthResponse === 'function'
      ? this.config.auth.extractRefreshTokenFromAuthResponse(authResponse, this)
      : authResponse.refreshToken as (RefreshToken | undefined);

    /** Check RefreshToken validity */
    if (!this.hasValidRefreshToken(refreshToken)) {
      this.useLogger(
        'auth',
        'error',
        'Extracting the RefreshToken from Auth Response produce an invalid RefreshToken',
        { authResponse, refreshToken }
      );
    }

    return refreshToken;
  }


  private extractUserDataFromAuthResponse(authResponse: any): UserData | undefined {
    return typeof this.config.auth?.extractUserDataFromAuthResponse === 'function'
      ? this.config.auth.extractUserDataFromAuthResponse(authResponse, this)
      : authResponse.userData as (UserData | undefined);
  }


  /* --------
   * Public Getters
   * -------- */
  public get state(): ClientState<UserData> {
    return {
      ...this._state,
      hasAuth: !!this._state.userData && this.hasValidAccessToken()
    };
  }


  public get tokens(): ClientTokens {
    return this._tokens;
  }


  public get socketState(): WebSocketState {
    return this._socketState;
  }


  /* --------
   * Public Methods
   * -------- */

  /**
   * Return UserData from API Server.
   * This function will call an API EndPoint
   * that must return UserData into the correct format
   */
  public async getUserData(): Promise<UserData> {
    return this.request<UserData>(this.config.api.getUserData);
  }


  /**
   * Perform a Login Request to API Server.
   * The API Server must return a complete AuthResponse,
   * composed by userData, accessToken and refreshToken field
   * @param email
   * @param password
   */
  public async loginWithEmailAndPassword(email: string, password: string): Promise<UserData | undefined> {
    /** Check the request config exists for this API */
    invariant(
      this.config.api.loginWithEmailAndPassword,
      'Could not use loginWithEmailAndPassword without configuring the API in \'config.api.loginWithEmailAndPassword\' field'
    );

    /** Get the AuthResponse */
    const loginWithEmailAndPasswordConfig = typeof this.config.api.loginWithEmailAndPassword === 'function'
      ? this.config.api.loginWithEmailAndPassword(this)
      : this.config.api.loginWithEmailAndPassword;

    const authResponse = await this.request<any>({
      ...loginWithEmailAndPasswordConfig,
      data: { email, password }
    });

    /** Get Auth Data */
    await this.saveAccessToken(this.extractAccessTokenFromAuthResponse(authResponse));
    await this.saveRefreshToken(this.extractRefreshTokenFromAuthResponse(authResponse));

    return this.saveUserData(this.extractUserDataFromAuthResponse(authResponse));
  }


  /**
   * Perform a Create User Request to API Server.
   * The API Server must return a complete AuthResponse,
   * composed by userData, accessToken and refreshToken field
   * @param signupData
   */
  public async createUserWithEmailAndPassword<Dto>(signupData: Dto): Promise<UserData | undefined> {
    /** Check the request config exists for this API */
    invariant(
      this.config.api.createUserWithEmailAndPassword,
      'Could not use createUserWithEmailAndPassword without configuring the API in \'config.api.loginWithEmailAndPassword\' field'
    );

    /** Get the AuthResponse */
    const createUserWithEmailAndPasswordConfig = typeof this.config.api.createUserWithEmailAndPassword === 'function'
      ? this.config.api.createUserWithEmailAndPassword(this)
      : this.config.api.createUserWithEmailAndPassword;

    const authResponse = await this.request<any>({
      ...createUserWithEmailAndPasswordConfig,
      data: signupData
    });

    /** Get Auth Data */
    await this.saveAccessToken(this.extractAccessTokenFromAuthResponse(authResponse));
    await this.saveRefreshToken(this.extractRefreshTokenFromAuthResponse(authResponse));

    return this.saveUserData(this.extractUserDataFromAuthResponse(authResponse));
  }


  public async logout(): Promise<void> {
    /** If an API to Call exists, call it */
    if (this.config.api.logout) {
      await this.willRequest<void>(this.config.api.logout);
    }

    /** Remove the Client Auth */
    await this.resetClientAuth();
  }


  public async request<T = GenericAPIResponse>(
    _config: ClientRequest | ((client: Client<UserData, Storage>) => ClientRequest)
  ): Promise<T> {
    /** Check client exists */
    if (!this.client) {
      this.useLogger('request', 'warn', 'A request has been called, but client is not initialize. Check configuration');
    }

    /** Check if the Request must change the Client State */
    if (this.config.requests?.changeClientState) {
      this.setState({ isPerformingRequest: true });
    }

    /** Get plain configuration object */
    const config = typeof _config === 'function'
      ? _config(this)
      : _config;

    /** Deconstruct config applying default */
    const {
      url: _url,
      method,
      data,
      params,
      parseRequestError,
      withAccessToken,
      withRefreshToken
    } = {
      ...(this.config.requests?.defaults || {}),
      ...config
    };

    /** Get the field into place tokens */
    const accessTokenAsBearerToken = getProcessDependingValue(this.config.auth?.accessTokenAsBearerToken, 'boolean');
    const accessTokenHeader = getProcessDependingValue(this.config.auth?.accessTokenHeaderName, 'string');
    const refreshTokenHeader = getProcessDependingValue(this.config.auth?.refreshTokenHeaderName, 'string');

    /** Prepare the Request URL */
    const url = prepareURL(_url);

    /** Make the Request */
    try {
      /** Build Headers */
      const headers: Record<string, string> = {};

      /** Append the AccessToken, if something goes wrong, getAccessToken will throw its error */
      if (accessTokenHeader && withAccessToken) {
        headers[accessTokenHeader] = await this.getAccessToken();
      }
      else if (accessTokenAsBearerToken && withAccessToken) {
        headers.Authorization = `Bearer ${await this.getAccessToken()}`;
      }

      /** Append RefreshToken, If something goes wrong, getRefreshToken will throw its error */
      if (refreshTokenHeader && withRefreshToken) {
        headers[refreshTokenHeader] = await this.getRefreshToken();
      }

      this.useLogger('request', 'debug', `Performing a '${method}' Request to '${url}'`, { params, data, headers });

      /** Use Axios to make the Request */
      const response = await (this.client as AxiosInstance)({
        url,
        method,
        headers,
        params,
        data
      }) as AxiosResponse<T>;

      this.useLogger('request', 'debug', `Response received from '${url}'`, response);

      /** Removing the loading state */
      if (this.config.requests?.changeClientState) {
        this.setState({ isPerformingRequest: false });
      }

      /** Return the Response */
      return response.data;
    }
    catch (error) {
      this.useLogger('request', 'error', `An error has been received from '${config.url}'`, error);

      /** Removing the loading state */
      if (this.config.requests?.changeClientState) {
        this.setState({ isPerformingRequest: false });
      }

      /** Throw the Error */
      throw parseRequestError
        ? this.parseRequestError(error)
        : error instanceof Error ? error : new Error('Undefined request error');
    }
  }


  public async willRequest<T = GenericAPIResponse>(
    config: ClientRequest | ((client: Client<UserData, Storage>) => ClientRequest)
  ): Promise<ClientWillResponse<T>> {
    try {
      const response = await this.request<T>(config);
      return [ null, response ];
    }
    catch (error) {
      return [ error as ClientRequestError, null as unknown as T ];
    }
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

}
