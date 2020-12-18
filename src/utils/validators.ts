export const isObject = (value: any): value is object => {
  return typeof value === 'object' && !Array.isArray(value) && value !== null;
};

export const isValidString = (value: any): value is string => {
  return typeof value === 'string' && !!(value.length);
};
