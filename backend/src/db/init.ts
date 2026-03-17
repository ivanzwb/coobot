import { db } from '../db/index.js';
import { agents, skills, permissionPolicies, systemConfigs } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import { pathToFileURL } from 'node:url';

export async function initializeDatabase() {
  console.log('[Init] Starting database initialization...');

  const existingAgents = await db.select().from(agents).limit(1);
  if (existingAgents.length > 0) {
    console.log('[Init] Database already initialized');
    return;
  }

  const leaderAgentId = uuidv4();
  await db.insert(agents).values({
    id: leaderAgentId,
    type: 'leader',
    name: 'Leader Agent',
    role: '负责任务规划、分解和结果汇总',
    model: 'gpt-4',
    temperature: 0.7,
    skills: JSON.stringify([]),
    knowledgeBases: JSON.stringify([]),
    status: 'active',
    isSystem: true
  });

  const domainAgents = [
    { id: uuidv4(), name: 'Code Agent', role: '负责代码编写和开发任务', type: 'domain' },
    { id: uuidv4(), name: 'Document Agent', role: '负责文档生成和处理', type: 'domain' },
    { id: uuidv4(), name: 'Search Agent', role: '负责信息检索和搜索', type: 'domain' },
    { id: uuidv4(), name: 'Analysis Agent', role: '负责数据分析和处理', type: 'domain' }
  ];

  for (const agent of domainAgents) {
    await db.insert(agents).values({
      id: agent.id,
      type: agent.type,
      name: agent.name,
      role: agent.role,
      model: 'gpt-4',
      temperature: 0.7,
      skills: JSON.stringify([]),
      knowledgeBases: JSON.stringify([]),
      status: 'active',
      isSystem: true
    });
  }

  const defaultSkills = [
    {
      id: 'skill-code',
      name: '代码技能',
      description: '用于代码编写、调试和优化',
      instructions: '你是一个代码助手，可以帮助用户编写和调试代码。',
      permissions: JSON.stringify({ read: 'allow', write: 'ask', execute: 'deny' }),
      tools: JSON.stringify([])
    },
    {
      id: 'skill-document',
      name: '文档技能',
      description: '用于文档生成和处理',
      instructions: '你是一个文档助手，可以帮助用户生成和处理各类文档。',
      permissions: JSON.stringify({ read: 'allow', write: 'ask', execute: 'deny' }),
      tools: JSON.stringify([])
    },
    {
      id: 'skill-search',
      name: '搜索技能',
      description: '用于信息检索和搜索',
      instructions: '你是一个搜索助手，可以帮助用户检索和查找信息。',
      permissions: JSON.stringify({ read: 'allow', write: 'deny', execute: 'deny' }),
      tools: JSON.stringify([])
    }
  ];

  for (const skill of defaultSkills) {
    await db.insert(skills).values({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      permissions: skill.permissions,
      tools: skill.tools,
      status: 'active'
    });
  }

  const defaultPolicies = [
    {
      id: uuidv4(),
      name: 'Allow Read Operations',
      priority: 10,
      readAction: 'allow',
      writeAction: 'deny',
      executeAction: 'deny'
    },
    {
      id: uuidv4(),
      name: 'Prompt on Write',
      priority: 20,
      readAction: 'allow',
      writeAction: 'prompt',
      executeAction: 'deny'
    },
    {
      id: uuidv4(),
      name: 'Deny Execute by Default',
      priority: 30,
      readAction: 'allow',
      writeAction: 'deny',
      executeAction: 'deny'
    }
  ];

  for (const policy of defaultPolicies) {
    await db.insert(permissionPolicies).values({
      id: policy.id,
      name: policy.name,
      priority: policy.priority,
      readAction: policy.readAction,
      writeAction: policy.writeAction,
      executeAction: policy.executeAction
    });
  }

  const defaultConfigs = [
    { key: 'llm.defaultModel', value: 'gpt-4', description: 'Default LLM model' },
    { key: 'llm.temperature', value: '0.7', description: 'Default temperature' },
    { key: 'scheduler.scanIntervalMs', value: '5000', description: 'Scan interval in ms' },
    { key: 'execution.maxConcurrentTasks', value: '3', description: 'Max concurrent tasks' },
    { key: 'execution.defaultTimeout', value: '300000', description: 'Default execution timeout in ms' },
    { key: 'memory.consolidationEnabled', value: 'true', description: 'Enable memory consolidation' },
    { key: 'knowledge.maxResults', value: '10', description: 'Max knowledge search results' }
  ];

  for (const config of defaultConfigs) {
    await db.insert(systemConfigs).values({
      id: uuidv4(),
      key: config.key,
      value: config.value,
      description: config.description
    });
  }

  console.log('[Init] Database initialized successfully');
  console.log(`[Init] Created ${1 + domainAgents.length} agents`);
  console.log(`[Init] Created ${defaultSkills.length} skills`);
  console.log(`[Init] Created ${defaultPolicies.length} policies`);
  console.log(`[Init] Created ${defaultConfigs.length} system configs`);
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  initializeDatabase()
    .then(() => {
      console.log('[Init] Initialization complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Init] Initialization failed:', error);
      process.exit(1);
    });
}