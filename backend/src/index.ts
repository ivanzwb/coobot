import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { router } from './routes/index.js';
import { setupWebSocket, closeWebSocket } from './websocket.js';
import { schedulerService } from './services/index.js';
import { closeDb } from './db/index.js';
import config from 'config';
import pino from 'pino';

const logger = pino({ level: (config.get('log.level') as string) || 'info' });

const app = express();
const port = (config.get('server.port') as number) || 3001;
const host = (config.get('server.host') as string) || 'localhost';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

setupWebSocket(server);

schedulerService.start();

server.listen(port, host, () => {
  logger.info(`BiosBot server running on http://${host}:${port}`);
  logger.info(`WebSocket server running on ws://${host}:${port}/ws`);
});

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  schedulerService.stop();
  closeWebSocket();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  schedulerService.stop();
  closeWebSocket();
  closeDb();
  process.exit(0);
});