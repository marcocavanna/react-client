import * as React from 'react';

import { ClientConsumer } from '../context/client.context';

import type Client from '../lib/client';


export interface WithClientProps {
  client: Client<any>;
}

export type ComponentWithClientProps<P extends {}> = React.ComponentType<P & WithClientProps>;

const withClient = <P extends {}>(
  ChildComponent: React.ComponentType<P>
): ComponentWithClientProps<P> => (childComponentProps: P) => (
  <ClientConsumer>
    {client => (
      <ChildComponent
        {...childComponentProps}
        client={client}
      />
    )}
  </ClientConsumer>
);

export default withClient;
