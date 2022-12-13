export async function will<T, K = any>(tester: Promise<T>): Promise<[ K | null, T ]> {
  try {
    const result = await tester;
    return [ null, result ];
  }
  catch (e) {
    return [ e as any, null as unknown as T ];
  }
}
