/**
 * Loads env for the CLI scripts the same way Next.js does: .env.local first,
 * then .env as a fallback. Importing "dotenv/config" alone reads only .env,
 * which silently leaves every real credential undefined.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
