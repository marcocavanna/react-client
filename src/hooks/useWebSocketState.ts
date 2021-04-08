import * as React from 'react';

import { useClient } from '../context/client.context';
import { WebSocketState } from '../lib/client.interfaces';


/**
 * Use the WeSocketState
 * this hook will reload every once the socket
 * state changed, from 'connected' to 'connecting' to 'error'
 */
export function useWebSocketState(): WebSocketState {
  /** Get the Client */
  const client = useClient();

  /** Create a Storage for WebSocket State */
  const [ webSocketState, setWebSocketState ] = React.useState(client.socketState);

  /** Use an effect to subscribe to client websocket state change */
  React.useEffect(() => client.subscribeToWebSocketStateChange(setWebSocketState), [ client ]);

  /** Return the current websocket state */
  return webSocketState;
}
