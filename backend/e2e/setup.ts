import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { db, closeDb } from '../src/db/index.js';

beforeAll(async () => {
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(async () => {
  // Clean up test data between tests
});

afterAll(async () => {
  await closeDb();
});
