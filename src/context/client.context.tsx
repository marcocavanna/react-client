import { contextBuilder } from '@appbuckets/react-ui-core';

import type Client from '../lib/client';


const {
  hook    : useClient,
  Provider: ClientProvider,
  Consumer: ClientConsumer
} = contextBuilder<Client<any>>(undefined, 'ClientContext');


export {
  useClient,
  ClientProvider,
  ClientConsumer
};
