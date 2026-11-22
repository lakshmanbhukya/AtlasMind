// Type-only augmentation for `npm run typecheck`; it has no runtime effect.
// `requireAuth` (middleware/auth.js) sets `req.connectionId`, `req.sessionId`
// and `req.sessionExpiresAt` on protected routes.
// `req.log` comes from pino-http's own type augmentation.

declare global {
    namespace Express {
        interface Request {
            connectionId?: string;
            /** Per-sign-in id from the session JWT; null for cookies issued before it existed. */
            sessionId?: string | null;
            sessionExpiresAt?: Date;
        }
    }
}

export {};
