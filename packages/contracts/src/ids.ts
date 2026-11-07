// The database's ids, shared by engine.ts and news.ts.
import { z } from "zod";

/** The database's ids: uuidv7, as PostgreSQL writes them (lowercase, the RFC 9562 variant). */
export const Uuid7 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
/** An organisation's id: Better Auth's (gen_random_uuid(), version 4), so any RFC 9562 version, lowercase. */
export const OrgId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
