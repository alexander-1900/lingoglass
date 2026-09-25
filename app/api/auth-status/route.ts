import { isDbConfigured } from "@/db";

/**
 * Capability probe for the client UI: whether Google sign-in is offered
 * (credentials present) and whether the sync backend exists (database
 * configured). With both false the app runs exactly as the pre-auth build.
 */
export function GET() {
  return Response.json({
    google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
    db: isDbConfigured(),
  });
}
