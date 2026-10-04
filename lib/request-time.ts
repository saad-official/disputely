/**
 * The time a server component renders at. Kept out of component bodies so
 * render stays pure in the linter's eyes; every page calls it once and
 * passes the value down.
 */
export function requestTime(): Date {
  return new Date();
}
