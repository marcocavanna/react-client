export function prepareURL(url: string): string {
  return encodeURI(url.replace(/(^\/*)|(\/*$)/, ''));
}
