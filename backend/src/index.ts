import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import { createServer } from 'http';
import { router } from './routes/index.js';
import { setupWebSocket, closeWebSocket } from './websocket.js';
import { schedulerService, memoryConsolidationService } from './services/index.js';
import { closeDb } from './db/index.js';
import config from 'config';
import pino from 'pino';

const logger = pino({ level: (config.get('log.level') as string) || 'info' });

const app = express();
const port = (config.get('server.port') as number) || 3001;
const host = (config.get('server.host') as string) || 'localhost';

app.use(cors());
app.use(fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

app.use(router);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || 'Internal server error'
    }
  });
});

const server = createServer(app);

let memoryConsolidationTimer: NodeJS.Timeout | null = null;
let memoryConsolidationBootTimer: NodeJS.Timeout | null = null;

async function runDailyMemoryConsolidation() {
  try {
    const result = await memoryConsolidationService.consolidateDailyMemories();
    logger.info({
      totalConversations: result.totalConversations,
      totalMessages: result.totalMessages,
      memoriesCreated: result.memoriesCreated,
      summary: result.summary
    }, 'Daily memory consolidation completed');
  } catch (error: any) {
    logger.error({ error: error?.message || String(error) }, 'Daily memory consolidation failed');
  }
}

function scheduleDailyMemoryConsolidation() {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  next.setHours(0, 10, 0, 0);
  const delayMs = Math.max(10_000, next.getTime() - now.getTime());

  memoryConsolidationBootTimer = setTimeout(async () => {
    await runDailyMemoryConsolidation();
    memoryConsolidationTimer = setInterval(runDailyMemoryConsolidation, 24 * 60 * 60 * 1000);
  }, delayMs);

  logger.info({ nextRunAt: next.toISOString() }, 'Daily memory consolidation scheduled');
}

function stopMemoryConsolidationSchedule() {
  if (memoryConsolidationBootTimer) {
    clearTimeout(memoryConsolidationBootTimer);
    memoryConsolidationBootTimer = null;
  }
  if (memoryConsolidationTimer) {
    clearInterval(memoryConsolidationTimer);
    memoryConsolidationTimer = null;
  }
}

setupWebSocket(server);

schedulerService.start();
scheduleDailyMemoryConsolidation();

server.listen(port, host, () => {
  logger.info(`BiosBot server running on http://${host}:${port}`);
  logger.info(`WebSocket server running on ws://${host}:${port}/ws`);
});

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  stopMemoryConsolidationSchedule();
  schedulerService.stop();
  closeWebSocket();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  stopMemoryConsolidationSchedule();
  schedulerService.stop();
  closeWebSocket();
  closeDb();
  process.exit(0);
});