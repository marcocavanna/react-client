type NodeEnvVariable<T> = Partial<Record<'development' | 'production' | 'test', T>>;

export type ProcessDependingField<T> = T | NodeEnvVariable<T>;

export function getProcessDependingValue<T>(
  field: ProcessDependingField<T | null | undefined>,
  type: 'string' | 'number' | 'boolean' | 'function' | ((value: any) => boolean),
  def?: T
): T | undefined {
  /** Internal useful type checker */
  function isRightType(value: any): boolean {
    if (typeof type === 'string') {
      return typeof value === type;
    }

    return type(value);
  }

  /** Check if field is of the right type */
  if (isRightType(field)) {
    return field as T;
  }

  /** If field is not an object, or is nil, return undefined */
  if (field === null || (typeof field !== 'object' && typeof field !== 'function') || !process.env.NODE_ENV) {
    return def;
  }

  /** Check if field exists */
  if (process.env.NODE_ENV in field
    && typeof isRightType((field as NodeEnvVariable<T>)[process.env.NODE_ENV as keyof NodeEnvVariable<any>])) {
    return (field as NodeEnvVariable<T>)[process.env.NODE_ENV as keyof NodeEnvVariable<any>];
  }

  /** If it doesn't exists, before falling back to default, use production, if exists */
  if ('production' in field && isRightType(field.production)) {
    return field.production as T;
  }

  /** Return the default value */
  return def;
}
