import type { Config } from 'drizzle-kit';
import { configManager } from './src/services/configManager';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  driver: 'better-sqlite',
  dbCredentials: {
    url: configManager.getDatabasePath(),
  },
} satisfies Config;