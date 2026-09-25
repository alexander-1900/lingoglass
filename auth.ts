import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Provider } from "next-auth/providers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Auth.js v5. Google is registered only when credentials exist, so builds
 * and dev runs without env vars behave exactly like the pre-auth app
 * (sign-in UI hidden via /api/auth-status).
 *
 * Session strategy is JWT: no server-side session reads per request. The
 * jwt callback carries the internal DB user id (the Drizzle adapter links
 * the Google account to a users row); the session callback exposes it as
 * session.user.id for /api/sync. The AccountBadge drives sign-in directly
 * via signIn("google"), so Auth.js's default sign-in page stays unused.
 */
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
const providers: Provider[] = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...(db ? { adapter: DrizzleAdapter(db) } : {}),
  providers,
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!db || !user.id) return;
      // Google can change the profile name/picture; keep our row fresh.
      await db
        .update(users)
        .set({ name: user.name ?? null, image: user.image ?? null })
        .where(eq(users.id, user.id));
    },
  },
});
