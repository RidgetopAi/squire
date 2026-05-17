import { squireMasterConfig, type ActionGuardrailPolicy, type GuardedAction } from '../config/master.js';
import { normalizeLoopId } from '../config/runtime-policy.js';
import { recordActivityEvent } from './activity.js';

export interface GuardrailRequest {
  action: GuardedAction;
  sourceLoop?: string;
  toolName?: string;
  actor?: string;
  traceId?: string;
  parentId?: string | null;
  triggerReason?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface GuardrailDecision {
  policy: ActionGuardrailPolicy;
  allowed: boolean;
  mode: 'allow' | 'deny' | 'draft' | 'require_approval';
  message?: string;
}

function decisionMessage(policy: ActionGuardrailPolicy, action: GuardedAction): string | undefined {
  switch (policy) {
    case 'allow':
      return undefined;
    case 'deny':
      return `Action blocked by Squire guardrail policy: ${action}`;
    case 'draft':
      return `Action held as a draft by Squire guardrail policy: ${action}`;
    case 'require_approval':
      return `Action requires approval before execution: ${action}`;
  }
}

export function getGuardrailPolicy(request: Pick<GuardrailRequest, 'action' | 'sourceLoop' | 'toolName'>): ActionGuardrailPolicy {
  const toolPolicy = request.toolName
    ? squireMasterConfig.permissions.actionGuardrails.toolPolicies[request.toolName]
    : undefined;
  if (toolPolicy) {
    return toolPolicy;
  }

  const loopId = normalizeLoopId(request.sourceLoop);
  const loopPolicy = loopId
    ? squireMasterConfig.permissions.actionGuardrails.loopActionPolicies[loopId]?.[request.action]
    : undefined;
  if (loopPolicy) {
    return loopPolicy;
  }

  return squireMasterConfig.permissions.actionGuardrails.defaultPolicy;
}

export function evaluateGuardrail(request: Pick<GuardrailRequest, 'action' | 'sourceLoop' | 'toolName'>): GuardrailDecision {
  const policy = getGuardrailPolicy(request);
  return {
    policy,
    allowed: policy === 'allow',
    mode: policy,
    message: decisionMessage(policy, request.action),
  };
}

export async function evaluateAndRecordGuardrail(request: GuardrailRequest): Promise<GuardrailDecision> {
  const decision = evaluateGuardrail(request);

  if (decision.policy !== 'allow') {
    await recordActivityEvent({
      traceId: request.traceId,
      parentId: request.parentId ?? undefined,
      sourceLoop: request.sourceLoop ?? 'tool_executor',
      eventType: 'guardrail.decision',
      actor: request.actor,
      triggerReason: request.triggerReason,
      summary: request.summary,
      status: decision.policy === 'deny' ? 'denied' : 'skipped',
      metadata: {
        action: request.action,
        policy: decision.policy,
        toolName: request.toolName,
        ...request.metadata,
      },
    });
  }

  return decision;
}

export function guardedActionForTool(toolName: string, args: Record<string, unknown>): GuardedAction | undefined {
  switch (toolName) {
    case 'commune_send':
      return 'external.telegram_send';
    case 'email_send':
    case 'squire_email_send':
    case 'squire_email_reply':
    case 'pdf_fill_and_email':
    case 'pdf_fill_and_email_from_object':
      return 'external.email_send';
    case 'email_delete':
      return 'delete.email_trash';
    case 'delete_note':
    case 'delete_list':
    case 'delete_commitment':
    case 'delete_calendar_event':
      return 'delete.permanent';
    case 'delete_reminder':
      return args.permanent === true ? 'delete.permanent' : undefined;
    default:
      return undefined;
  }
}
