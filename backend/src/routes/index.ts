import { Router } from 'express';
import tasksRouter from './tasks.js';
import agentsRouter from './agents.js';
import modelsRouter from './models.js';
import knowledgeRouter from './knowledge.js';
import memoryRouter from './memory.js';
import systemRouter from './system.js';
import schedulerRouter from './scheduler.js';
import promptsRouter from './prompts.js';
import skillsRouter from './skills.js';
import chatRouter from './chat.js';
import authRouter from './auth.js';
import toolPermissionsRouter from './toolPermissions.js';
import auditRouter from './audit.js';

const router = Router();

router.use('/v1/tasks', tasksRouter);
router.use('/v1/agents', agentsRouter);
router.use('/v1/models', modelsRouter);
router.use('/v1/knowledge', knowledgeRouter);
router.use('/v1/memory', memoryRouter);
router.use('/v1/system', systemRouter);
router.use('/v1/scheduler', schedulerRouter);
router.use('/v1/prompts', promptsRouter);
router.use('/v1/skills', skillsRouter);
router.use('/v1/chat', chatRouter);
router.use('/v1/auth', authRouter);
router.use('/v1/tools/permissions', toolPermissionsRouter);
router.use('/v1/audit', auditRouter);

export default router;