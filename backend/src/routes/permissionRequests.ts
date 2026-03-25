import { Router } from 'express';
import { permissionRequestService } from '../services/permissionRequestService.js';
import { taskOrchestrator } from '../services/taskOrchestrator.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const agentId = req.query.agentId as string | undefined;
    const requests = await permissionRequestService.getPendingRequests(agentId);
    res.json(requests);
  } catch (error) {
    console.error('Failed to get permission requests:', error);
    res.status(500).json({ error: 'Failed to get permission requests' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const request = await permissionRequestService.getRequestById(id);
    
    if (!request) {
      return res.status(404).json({ error: 'Permission request not found' });
    }
    
    res.json(request);
  } catch (error) {
    console.error('Failed to get permission request:', error);
    res.status(500).json({ error: 'Failed to get permission request' });
  }
});

router.post('/:id/respond', async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, response } = req.body;

    if (typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'approved must be a boolean' });
    }

    const request = await permissionRequestService.respond(id, approved, response);
    
    if (!request) {
      return res.status(404).json({ error: 'Permission request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Failed to respond to permission request:', error);
    res.status(500).json({ error: 'Failed to respond to permission request' });
  }
});

export default router;
