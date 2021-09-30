import * as React from 'react';

import { useClient } from '../context/client.context';

import type { ClientRequest } from '../lib/client.interfaces';

import type { UseClientRequestConfig, UseClientRequestInternalState, UseClientRequestState } from './hooks.types';


export function useClientRequest<Response>(
  config: UseClientRequestConfig
): UseClientRequestState<Response> {

  /** Get the base configuration */
  const {
    method = 'GET',
    reloadDependencies = [],
    request,
    url
  } = config;

  /** Get the Client */
  const client = useClient();


  // ----
  // Internal State
  // ----
  const [ state, setState ] = React.useState<UseClientRequestInternalState<Response>>({
    isLoading: true,
    error    : null,
    response : null as any
  });


  // ----
  // Main Fetching Function
  // ----
  const fetchData = React.useCallback(
    async (silent?: boolean) => {
      /** Set loading state only if is reloading not in silent mode */
      if (!silent && !state.isLoading) {
        setState((curr) => ({
          ...curr,
          isLoading: true
        }));
      }

      /** Make the request */
      const clientRequest: ClientRequest = {
        url,
        method,
        ...request
      };

      const [ error, response ] = await client.willRequest<Response>(clientRequest);

      /** Set the new State */
      setState({
        error,
        response,
        isLoading: false
      });

      /** Return fetchedData */
      return response;
    },
    [ client, method, request, state.isLoading, url ]
  );

  /** Use realtime reload */
  const reloadRequest = React.useCallback(
    () => {
      return fetchData(true);
    },
    [ fetchData ]
  );


  // ----
  // Fetch Data for First Time, and after reload dependencies changed
  // ----
  const useEffectDependencies = React.useMemo(
    () => (Array.isArray(reloadDependencies) ? reloadDependencies : []),
    [ reloadDependencies ]
  );

  React.useEffect(
    () => {
      fetchData();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffectDependencies
  );


  // ----
  // Set up a memoized state
  // ----
  return React.useMemo(
    (): UseClientRequestState<Response> => ({
      error    : state.error,
      isLoading: state.isLoading,
      reload(): Promise<Response> {
        return reloadRequest();
      },
      response: state.response
    }),
    [
      reloadRequest,
      state.error,
      state.isLoading,
      state.response
    ]
  );

}
