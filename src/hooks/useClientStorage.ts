import * as React from 'react';

import type Client from '../lib/client';
import { useClient } from '../context/client.context';


/* --------
 * Internal Types
 * -------- */
type ValueUpdaterFunction<Value> = (current: Value) => Value;

type ValueUpdater<Value> = (value: Value | ValueUpdaterFunction<Value>) => void;

export type UseClientStorageResult<Value> = [ Value, ValueUpdater<Value>, Value | undefined ];


/**
 * Hook that could be used to add a new listener to a store property change.
 * Result contains in addition a function that could be used to update
 * the store and the previous store value
 * @param key
 */
export function useClientStorage<Storage extends object, K extends keyof Storage>(key: K): UseClientStorageResult<Storage[K]> {

  /** Get the client */
  const client = useClient() as Client<unknown, Storage>;

  /** Create the base property value state */
  const oldValueRef = React.useRef<Storage[K]>();
  const [ currentValue, setCurrentValue ] = React.useState(() => (
    client.getStoreKey(key)
  ));

  /** Create the handler to set the current property value */
  const handlePropertyValueChange = React.useCallback(
    (nextValue: Storage[K], oldValue: Storage[K]) => {
      /** Save the old value to ref */
      oldValueRef.current = oldValue;
      /** Update the current property value */
      setCurrentValue(nextValue);
    },
    []
  );

  /** Create the function that could be used to change store property value */
  const setStorePropertyValue = React.useCallback<ValueUpdater<Storage[K]>>(
    (value) => {
      /** Set the new value using client */
      client.setStoreKey(
        key,
        typeof value === 'function' ? (value as ValueUpdaterFunction<Storage[K]>)(currentValue) : value
      );
    },
    [ client, currentValue, key ]
  );

  /** Subscribe to property change */
  React.useEffect(
    () => client.subscribeToStoragePropertyChange(key, handlePropertyValueChange),
    [ client, handlePropertyValueChange, key ]
  );

  /** Return data */
  return [ currentValue, setStorePropertyValue, oldValueRef.current ];
}
