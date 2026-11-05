import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Every Admin write records one row here, inside the same transaction as the change it describes,
 * so there is never a state change without a trail (or a trail without a change).
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      reason: entry.reason ?? null,
      metadata: entry.metadata,
    },
  });
}
