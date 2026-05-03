import { ActionIntent, SafetyService } from '@system-lens/safety';
import { AutomationRule, AutomationRun, SharedDb } from '@system-lens/shared-db';

export interface RuleDraft {
  name: string;
  scopePathPrefix: string;
  mode: 'sort-by-extension' | 'archive-stale';
  staleDays?: number;
}

export class AutomationService {
  private readonly db: SharedDb;
  private readonly safety: SafetyService;

  constructor(db: SharedDb, safety: SafetyService) {
    this.db = db;
    this.safety = safety;
  }

  createRule(ruleDraft: RuleDraft): AutomationRule {
    return this.db.createAutomationRule({
      name: ruleDraft.name,
      enabled: false,
      status: 'draft',
      scheduleJson: JSON.stringify({ type: 'manual' }),
      policyJson: JSON.stringify(ruleDraft),
    });
  }

  simulateRule(ruleId: string, scope: { limit?: number } = {}): AutomationRun {
    const rule = this.mustGetRule(ruleId);
    const draft = JSON.parse(rule.policyJson) as RuleDraft;
    const candidateFiles = this.db
      .listFiles(20_000)
      .filter((file) => file.type === 'file' && file.path.startsWith(draft.scopePathPrefix))
      .slice(0, scope.limit ?? 25);

    const intents = this.buildIntentsFromDraft(
      draft,
      candidateFiles.map((file) => file.id),
    );
    const previews = intents.map((intent) => this.safety.preview(intent));

    return this.db.insertAutomationRun({
      ruleId,
      previewJson: JSON.stringify(previews),
      resultJson: JSON.stringify({ simulated: true, actionsPlanned: intents.length }),
      status: 'simulated',
    });
  }

  activateRule(ruleId: string): void {
    this.db.updateAutomationRuleState(ruleId, { enabled: true, status: 'active' });
  }

  deactivateRule(ruleId: string): void {
    this.db.updateAutomationRuleState(ruleId, { enabled: false, status: 'inactive' });
  }

  executeRule(ruleId: string, context: { actor?: string } = {}): AutomationRun {
    const rule = this.mustGetRule(ruleId);
    if (!rule.enabled || rule.status !== 'active') {
      return this.db.insertAutomationRun({
        ruleId,
        previewJson: JSON.stringify({ ruleEnabled: rule.enabled, status: rule.status }),
        resultJson: JSON.stringify({ executed: false, reason: 'Rule is not active.' }),
        status: 'blocked',
      });
    }

    const draft = JSON.parse(rule.policyJson) as RuleDraft;
    const candidateFiles = this.db
      .listFiles(20_000)
      .filter((file) => file.type === 'file' && file.path.startsWith(draft.scopePathPrefix))
      .slice(0, 25);
    const intents = this.buildIntentsFromDraft(
      draft,
      candidateFiles.map((file) => file.id),
    );

    const actionLogs = intents.map((intent) => {
      const validation = this.safety.validatePolicy(intent, {
        allowDelete: false,
        maxFilesPerAction: 25,
      });
      if (!validation.allowed) {
        return { blocked: true, reasons: validation.reasons };
      }

      const preview = this.safety.preview(intent);
      const token = this.safety.requestConfirmation(
        preview,
        context.actor ?? 'automation',
      ).confirmationToken;
      const result = this.safety.executeConfirmed(token);
      return { blocked: false, actionLogId: result.id };
    });

    return this.db.insertAutomationRun({
      ruleId,
      previewJson: JSON.stringify({ intents }),
      resultJson: JSON.stringify({ actionLogs }),
      status: 'success',
    });
  }

  listRuleRuns(limit = 100): AutomationRun[] {
    return this.db.listAutomationRuns(limit);
  }

  listRules(): AutomationRule[] {
    return this.db.listAutomationRules();
  }

  private mustGetRule(ruleId: string): AutomationRule {
    const rule = this.db.getAutomationRule(ruleId);
    if (!rule) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    return rule;
  }

  private buildIntentsFromDraft(draft: RuleDraft, targetFileIds: string[]): ActionIntent[] {
    if (draft.mode === 'sort-by-extension') {
      return [
        {
          actionType: 'move',
          targetFileIds,
          destinationPath: `${draft.scopePathPrefix}/_sorted`,
        },
      ];
    }

    return [
      {
        actionType: 'archive',
        targetFileIds,
        destinationPath: `${draft.scopePathPrefix}/_archive`,
      },
    ];
  }
}
