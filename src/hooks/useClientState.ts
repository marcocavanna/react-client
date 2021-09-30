import * as React from 'react';

import { useClient } from '../context/client.context';
import { ClientState } from '../lib/client.interfaces';


/**
 * Build an Hook to retrieve the current
 * Client state and its data.
 * Hook contains a function to updated the state,
 * Hook result will automatically reload when client
 * state change.
 * To make sure userData exists, a generic State type
 * could be set related to useClientState
 */
export function useClientState<UserData>(): ClientState<UserData> {
  /** Get the client */
  const client = useClient();

  /** Create the Client State */
  const [ clientState, setNewClientState ] = React.useState(client.state);

  /** Use an effect to subscribe to client state change */
  React.useEffect(() => client.subscribeToClientStateChange(setNewClientState), [ client ]);

  /** Return current state */
  return clientState;
}
