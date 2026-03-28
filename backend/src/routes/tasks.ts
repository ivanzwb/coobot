import { Router, Request, Response } from 'express';
import { taskOrchestrator, agentCapabilityRegistry } from '../services/index.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { content, attachments } = req.body;

    const task = await taskOrchestrator.createTask(
      { content, attachments },
      'immediate'
    );

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const task = await taskOrchestrator.getTask(req.params.id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:id/tree', async (req: Request, res: Response) => {
  try {
    const tree = await taskOrchestrator.getTaskTree(req.params.id);
    res.json(tree);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/terminate', async (req: Request, res: Response) => {
  try {
    await taskOrchestrator.terminateTask(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/clarify', async (req: Request, res: Response) => {
  try {
    const { clarificationData } = req.body;
    const task = await taskOrchestrator.getTask(req.params.id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    let updatedPayload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    if (clarificationData) {
      updatedPayload = { ...updatedPayload, ...clarificationData };
    }

    const payloadJson = JSON.stringify(updatedPayload);
    await db.update(schema.tasks)
      .set({
        inputPayload: payloadJson,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, req.params.id));

    taskOrchestrator.patchTaskInputPayload(req.params.id, payloadJson);

    await taskOrchestrator.updateTaskStatus(req.params.id, 'PARSING');
    await taskOrchestrator.enqueueLeaderTask(req.params.id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/retry-after-clarification', async (req: Request, res: Response) => {
  try {
    const { clarificationData, newAgentConfigured } = req.body;
    const task = await taskOrchestrator.getTask(req.params.id);

    if (!task) {
      return res.status(404).json({ error: 'TASK_NOT_FOUND' });
    }

    if (task.status !== 'CLARIFICATION_PENDING') {
      return res.status(400).json({ error: 'TASK_INVALID_STATUS' });
    }

    let updatedPayload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    if (clarificationData) {
      updatedPayload = { ...updatedPayload, ...clarificationData };
    }

    const payloadJson = JSON.stringify(updatedPayload);
    await db.update(schema.tasks)
      .set({
        inputPayload: payloadJson,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, req.params.id));

    taskOrchestrator.patchTaskInputPayload(req.params.id, payloadJson);

    if (newAgentConfigured) {
      await agentCapabilityRegistry.loadFromDatabase();
    }

    await taskOrchestrator.updateTaskStatus(req.params.id, 'PARSING');
    await taskOrchestrator.enqueueLeaderTask(req.params.id);

    res.json({
      taskId: req.params.id,
      status: 'PARSING',
      success: true
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const tasks = await db.select()
      .from(schema.tasks)
      .orderBy(schema.tasks.createdAt)
      .limit(100);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;