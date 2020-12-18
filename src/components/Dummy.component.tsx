import * as React from 'react';

export interface DummyProps {
  name: string;
  description?: string;
}

const Dummy: React.FC<DummyProps> = ({ name, description }) => (
  <div className='dummy'>
    <h2 className='dummy-title'>{name}</h2>
    {description && (
      <p className='dummy-content'>{description}</p>
    )}
  </div>
);

export default Dummy;
