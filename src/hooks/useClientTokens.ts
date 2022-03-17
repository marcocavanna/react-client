import * as React from 'react';

import { useClient } from '../context/client.context';
import type { ClientTokens } from '../lib/client.interfaces';


/**
 * Build an Hook to retrieve the current client tokens object
 * Hook result will be automatically reloaded when at least
 * one of the client tokens change
 */
export function useClientTokens(): ClientTokens {
  /** Get the client */
  const client = useClient();

  /** Create the base tokens state */
  const [ clientTokens, setClientTokens ] = React.useState(client.tokens);

  /** Use an effect to subscribe to client tokens change */
  React.useEffect(() => client.subscribeToClientTokensChange(setClientTokens), [ client ]);

  /** Return current tokens */
  return clientTokens;
}
