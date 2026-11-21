// Type-only augmentation for `npm run typecheck` (F19); it has no runtime effect.
// `requireAuth` (middleware/auth.js) sets `req.connectionId` on protected routes.
// `req.log` comes from pino-http's own type augmentation.

declare global {
    namespace Express {
        interface Request {
            connectionId?: string;
        }
    }
}

export {};
