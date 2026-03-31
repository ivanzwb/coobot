import { Router, Request, Response } from 'express';
import { taskOrchestrator, agentCapabilityRegistry, memoryEngine } from '../services/index.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const router = Router();

/** Express `req.params.id` is typed as `string | string[]`; route `/:id` is always a single string. */
function taskIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? (id[0] ?? '') : (id ?? '');
}

/** 澄清回复写入 `clarificationReply`，避免 `content` 覆盖用户原始请求。 */
function mergeClarificationIntoPayload(
  existing: Record<string, unknown>,
  clarificationData?: Record<string, unknown>
): Record<string, unknown> {
  if (!clarificationData) return existing;
  const out: Record<string, unknown> = { ...existing };
  const reply =
    clarificationData.clarificationReply ??
    clarificationData.message ??
    clarificationData.content;
  if (reply !== undefined && reply !== null && String(reply).trim() !== '') {
    out.clarificationReply = String(reply).trim();
  }
  for (const [k, v] of Object.entries(clarificationData)) {
    if (k === 'clarificationReply' || k === 'message' || k === 'content') continue;
    out[k] = v;
  }
  return out;
}

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
    const task = await taskOrchestrator.getTask(taskIdParam(req));

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
    const tree = await taskOrchestrator.getTaskTree(taskIdParam(req));
    res.json(tree);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/terminate', async (req: Request, res: Response) => {
  try {
    await taskOrchestrator.terminateTask(taskIdParam(req));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/clarify', async (req: Request, res: Response) => {
  try {
    const { clarificationData } = req.body;
    const id = taskIdParam(req);
    const task = await taskOrchestrator.getTask(id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.status !== 'CLARIFICATION_PENDING') {
      return res.status(400).json({ error: 'TASK_INVALID_STATUS' });
    }

    const replyText =
      clarificationData &&
      (clarificationData.clarificationReply ??
        clarificationData.message ??
        clarificationData.content);
    if (
      replyText === undefined ||
      replyText === null ||
      String(replyText).trim() === ''
    ) {
      return res.status(400).json({ error: 'CLARIFICATION_PAYLOAD_INVALID' });
    }

    let updatedPayload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    updatedPayload = mergeClarificationIntoPayload(updatedPayload, clarificationData);

    await memoryEngine.appendMessage('user', String(replyText).trim(), [], id);

    const payloadJson = JSON.stringify(updatedPayload);
    await db.update(schema.tasks)
      .set({
        inputPayload: payloadJson,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, id));

    taskOrchestrator.patchTaskInputPayload(id, payloadJson);

    await taskOrchestrator.updateTaskStatus(id, 'PARSING');
    await taskOrchestrator.enqueueLeaderTask(id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/retry-after-clarification', async (req: Request, res: Response) => {
  try {
    const { clarificationData, newAgentConfigured } = req.body;
    const id = taskIdParam(req);
    const task = await taskOrchestrator.getTask(id);

    if (!task) {
      return res.status(404).json({ error: 'TASK_NOT_FOUND' });
    }

    if (task.status !== 'CLARIFICATION_PENDING') {
      return res.status(400).json({ error: 'TASK_INVALID_STATUS' });
    }

    let updatedPayload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    updatedPayload = mergeClarificationIntoPayload(updatedPayload, clarificationData);

    const replyText =
      clarificationData &&
      (clarificationData.clarificationReply ??
        clarificationData.message ??
        clarificationData.content);
    if (replyText !== undefined && replyText !== null && String(replyText).trim() !== '') {
      await memoryEngine.appendMessage('user', String(replyText).trim(), [], id);
    }

    const payloadJson = JSON.stringify(updatedPayload);
    await db.update(schema.tasks)
      .set({
        inputPayload: payloadJson,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, id));

    taskOrchestrator.patchTaskInputPayload(id, payloadJson);

    if (newAgentConfigured) {
      await agentCapabilityRegistry.loadFromDatabase();
    }

    await taskOrchestrator.updateTaskStatus(id, 'PARSING');
    await taskOrchestrator.enqueueLeaderTask(id);

    res.json({
      taskId: id,
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