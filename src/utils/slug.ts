export const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

export type SlugSyntaxError = 'required' | 'invalid';

export function validateSlugSyntax(slug: string): SlugSyntaxError | null {
  const value = slug.trim();
  if (!value) return 'required';
  return SLUG_PATTERN.test(value) ? null : 'invalid';
}
