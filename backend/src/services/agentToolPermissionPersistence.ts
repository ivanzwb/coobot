import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import type { ToolPolicy } from '../types';
import { getDefaultBuiltinToolPolicy } from './builtinToolPolicies.js';

/**
 * 内置工具：策略与代码默认值一致时不落库（删除已有行）；仅覆盖默认时才 upsert。
 * 非内置工具（如 skill:*）：始终 upsert。
 */
export async function persistAgentToolPolicy(
  agentId: string,
  toolName: string,
  policy: ToolPolicy
): Promise<void> {
  const builtinDefault = getDefaultBuiltinToolPolicy(toolName);

  if (builtinDefault !== undefined && policy === builtinDefault) {
    await db
      .delete(schema.agentToolPermissions)
      .where(
        and(
          eq(schema.agentToolPermissions.agentId, agentId),
          eq(schema.agentToolPermissions.toolName, toolName)
        )
      );
    return;
  }

  const existing = await db
    .select()
    .from(schema.agentToolPermissions)
    .where(
      and(
        eq(schema.agentToolPermissions.agentId, agentId),
        eq(schema.agentToolPermissions.toolName, toolName)
      )
    );

  if (existing.length > 0) {
    await db
      .update(schema.agentToolPermissions)
      .set({ policy, updatedAt: new Date() })
      .where(
        and(
          eq(schema.agentToolPermissions.agentId, agentId),
          eq(schema.agentToolPermissions.toolName, toolName)
        )
      );
  } else {
    await db.insert(schema.agentToolPermissions).values({
      agentId,
      toolName,
      policy,
      updatedAt: new Date(),
    });
  }
}
