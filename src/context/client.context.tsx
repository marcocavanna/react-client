import { contextBuilder } from '../utils';

import type Client from '../lib/client';


const {
  hook    : useClient,
  Provider: ClientProvider,
  Consumer: ClientConsumer
} = contextBuilder<Client<any> | null>(null);


export {
  useClient,
  ClientProvider,
  ClientConsumer
};
