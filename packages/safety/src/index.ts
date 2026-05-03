import crypto from 'node:crypto';
import { ActionLogEntry, SearchFilters, SharedDb } from '@system-lens/shared-db';

export type MutatingActionType = 'move' | 'rename' | 'archive' | 'delete';

export interface ActionIntent {
  actionType: MutatingActionType;
  targetFileIds: string[];
  destinationPath?: string;
  actor?: string;
}

export interface UserPolicy {
  allowDelete?: boolean;
  maxFilesPerAction?: number;
  restrictedPathPrefixes?: string[];
}

export interface ActionPreview {
  actionType: MutatingActionType;
  fileCount: number;
  filePaths: string[];
  destinationPath?: string;
  previewHash: string;
}

export interface ValidationResult {
  allowed: boolean;
  reasons: string[];
}

interface PendingConfirmation {
  token: string;
  expiresAt: number;
  consumed: boolean;
  preview: ActionPreview;
  actor: string;
}

const TOKEN_TTL_MS = 2 * 60 * 1000;

export class SafetyService {
  private readonly db: SharedDb;
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(db: SharedDb) {
    this.db = db;
  }

  preview(actionIntent: ActionIntent): ActionPreview {
    const files = actionIntent.targetFileIds
      .map((fileId) => this.db.getFileById(fileId))
      .filter((file): file is NonNullable<typeof file> => file !== null);
    const filePaths = files.map((file) => file.path);
    const previewHash = crypto
      .createHash('sha1')
      .update(JSON.stringify({ actionIntent, filePaths }))
      .digest('hex');

    return {
      actionType: actionIntent.actionType,
      fileCount: files.length,
      filePaths,
      destinationPath: actionIntent.destinationPath,
      previewHash,
    };
  }

  validatePolicy(actionIntent: ActionIntent, userPolicy: UserPolicy = {}): ValidationResult {
    const reasons: string[] = [];
    const files = actionIntent.targetFileIds
      .map((fileId) => this.db.getFileById(fileId))
      .filter((file): file is NonNullable<typeof file> => file !== null);

    if (actionIntent.actionType === 'delete' && !userPolicy.allowDelete) {
      reasons.push('Delete actions are disabled by current policy.');
    }

    if (
      typeof userPolicy.maxFilesPerAction === 'number' &&
      files.length > Math.max(1, userPolicy.maxFilesPerAction)
    ) {
      reasons.push(`Action exceeds max file limit (${userPolicy.maxFilesPerAction}).`);
    }

    if (userPolicy.restrictedPathPrefixes?.length) {
      const restricted = files.find((file) =>
        userPolicy.restrictedPathPrefixes?.some((prefix) => file.path.startsWith(prefix)),
      );
      if (restricted) {
        reasons.push(`Target includes restricted path: ${restricted.path}`);
      }
    }

    return { allowed: reasons.length === 0, reasons };
  }

  requestConfirmation(
    actionPreview: ActionPreview,
    actor = 'user',
  ): {
    confirmationToken: string;
    expiresAt: string;
    previewHash: string;
  } {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + TOKEN_TTL_MS;

    this.pending.set(token, {
      token,
      expiresAt,
      consumed: false,
      preview: actionPreview,
      actor,
    });

    this.db.insertActionLog({
      actionType: actionPreview.actionType,
      scopeJson: JSON.stringify({ fileCount: actionPreview.fileCount }),
      previewJson: JSON.stringify(actionPreview),
      resultJson: JSON.stringify({ state: 'awaiting-confirmation' }),
      actor,
      status: 'previewed',
    });

    return {
      confirmationToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      previewHash: actionPreview.previewHash,
    };
  }

  executeConfirmed(confirmationToken: string): ActionLogEntry {
    const pending = this.pending.get(confirmationToken);
    if (!pending) {
      throw new Error('Invalid confirmation token.');
    }

    if (pending.consumed) {
      throw new Error('Confirmation token already used.');
    }

    if (Date.now() > pending.expiresAt) {
      throw new Error('Confirmation token expired.');
    }

    pending.consumed = true;
    this.pending.set(confirmationToken, pending);

    return this.db.insertActionLog({
      actionType: pending.preview.actionType,
      scopeJson: JSON.stringify({ fileCount: pending.preview.fileCount }),
      previewJson: JSON.stringify(pending.preview),
      resultJson: JSON.stringify({
        executed: true,
        mutationMode: 'simulated',
        note: 'Execution is simulation-only in MVP.',
      }),
      actor: pending.actor,
      status: 'executed',
    });
  }

  getActionLog(filters: SearchFilters & { limit?: number } = {}): ActionLogEntry[] {
    const entries = this.db.listActionLog(filters.limit ?? 100);
    if (!filters.pathPrefix) {
      return entries;
    }

    return entries.filter((entry) => {
      const preview = JSON.parse(entry.previewJson) as { filePaths?: string[] };
      return (
        preview.filePaths?.some((filePath) => filePath.startsWith(filters.pathPrefix ?? '')) ??
        false
      );
    });
  }

  rollback(actionId: string): ActionLogEntry {
    return this.db.insertActionLog({
      actionType: 'rollback',
      scopeJson: JSON.stringify({ actionId }),
      previewJson: JSON.stringify({ actionId }),
      resultJson: JSON.stringify({
        rolledBack: false,
        note: 'Rollback metadata logged, no filesystem mutation performed in MVP.',
      }),
      actor: 'system',
      status: 'rolled_back',
    });
  }
}
