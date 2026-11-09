/** Country from the edge header (two letters). Anything else is dropped. */
export function countryFromHeader(value: string | null): string | null {
  const country = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(country) ? country : null;
}
