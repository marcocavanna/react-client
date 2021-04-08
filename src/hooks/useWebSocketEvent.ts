import * as React from 'react';

import { useClient } from '../context/client.context';
import { EventUnsubscribe, WebSocketEvent } from '../lib/client.interfaces';

import { UseWebSocketEventConfig } from './hooks.types';


/**
 * Use a WebSocket Event.
 * This hook will fire the onEvent function
 * provided into config object every time a
 * valid WebSocket Event will occurred
 *
 * @param config Configuration object for WebSocket Event
 */
export function useWebSocketEvent(config: UseWebSocketEventConfig) {

  const {
    active,
    entityId,
    onEvent: handleEvent,
    namespace,
    type
  } = config;

  /** Get the Client */
  const client = useClient();

  /** Build a Function to handle Event */
  const handleWebSocketEvent = React.useCallback(
    (event: WebSocketEvent) => {
      /** If no function, return */
      if (typeof handleEvent !== 'function') {
        return;
      }

      /** If namespace is different, return */
      if (event.namespace !== namespace) {
        return;
      }

      /** If type has been defined and is different, return */
      if (type && event.type !== type) {
        return;
      }

      /** If entity id has been defined and is different, return */
      if (entityId && event.entityId !== entityId) {
        return;
      }

      /** Call user defined handler */
      if (typeof handleEvent === 'function') {
        handleEvent(event);
      }
    },
    [
      namespace,
      entityId,
      type,
      handleEvent
    ]
  );

  /** Attach to WebSocket Event */
  React.useEffect(
    () => {
      /** Initialize the SubScribe */
      let unsubscribe: EventUnsubscribe | undefined;

      /** If is Active, build the subscriber */
      if (active && namespace) {
        unsubscribe = client.subscribeToSocketEvent(handleWebSocketEvent);
      }

      /** Return the unsubscribe call */
      return () => {
        if (unsubscribe) {
          unsubscribe();
        }
      };
    },
    [
      client,
      handleWebSocketEvent,
      active,
      namespace
    ]
  );

}
