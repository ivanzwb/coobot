import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import cron from 'node-cron';
import routes from './routes/index.js';
import { configManager, initializeDatabase, schedulerService, agentCapabilityRegistry, taskOrchestrator, vectorStore, monitorService, memoryEngine, logger, backupService, skillRegistry } from './services/index.js';
import { eventBus } from './services/eventBus.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

process.env.DB_PATH = configManager.getDatabasePath();

async function bootstrap() {
  try {
    logger.initialize();
    logger.info('Bootstrap', 'Starting BiosBot server...');

    await configManager.load();
    await configManager.ensureWorkspaceInitialized();

    await initializeDatabase();
    await vectorStore.initialize();
    await agentCapabilityRegistry.loadFromDatabase();
    await skillRegistry.registerAllSkillTools();

    schedulerService.start();
    monitorService.startMonitoring();

    setInterval(() => {
      memoryEngine.archiveEligibleHistory().catch(err => {
        logger.error('Archive', 'Failed to archive history', err);
      });
    }, 60 * 60 * 1000);

    cron.schedule('0 2 * * *', () => {
      backupService.runDailyBackup().catch(err => {
        logger.error('Backup', 'Daily backup failed', err);
      });
    });

    app.use('/api', routes);

    const server = createServer(app);

    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws: WebSocket) => {
      logger.info('WebSocket', 'Client connected');
      eventBus.addClient(ws);

      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          logger.debug('WebSocket', 'Received message', data);

          if (data.type === 'subscribe_task' && data.taskId) {
            ws.send(JSON.stringify({
              type: 'subscribed',
              taskId: data.taskId,
            }));
          }
        } catch (e) {
          logger.error('WebSocket', 'Failed to parse message', e);
        }
      });

      ws.on('close', () => {
        logger.info('WebSocket', 'Client disconnected');
        eventBus.removeClient(ws);
      });
    });

    server.listen(PORT, () => {
      logger.info('Server', `Server running on http://localhost:${PORT}`);
      logger.info('Server', `WebSocket running on ws://localhost:${PORT}/ws`);
      logger.info('Server', `Workspace: ${configManager.getWorkspacePath()}`);
    });

  } catch (error) {
    logger.error('Bootstrap', 'Failed to start server', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  logger.info('Server', 'Shutting down...');
  schedulerService.stop();
  taskOrchestrator.destroy();
  process.exit(0);
});

bootstrap();