import { ApiError } from "./errors";

// Turns an API error into a message that is safe and useful to show an owner.
export function friendlyMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Please try again.";
  if (err.status === 0) return "Cannot reach the server. Check your connection and try again.";
  if (err.status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (err.status >= 500) return "The server had a problem. Please try again shortly.";
  if (err.status === 403) return "You do not have access to this.";
  return err.message || "Something went wrong. Please try again.";
}
