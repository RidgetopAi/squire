import { describe, it } from 'node:test';
import assert from 'node:assert';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.ACTIVITY_LOGGING_ENABLED = 'false';
process.env.TOOL_CALL_LOGGING_ENABLED = 'false';

const { squireMasterConfig } = await import('../src/config/master.js');
const { getHttpChatToolDefinitions } = await import('../src/services/chat/chat.js');
const { AgentEngine } = await import('../src/services/agent/engine.js');
const { getPageTools } = await import('../src/services/page/tools.js');
const { runWorkerAgent } = await import('../src/services/runtime/worker.js');
const { parseCodexToolCalls } = await import('../src/services/llm/codex.js');
const { executeTools } = await import('../src/tools/index.js');

type MutableLoopId =
  | 'http_chat'
  | 'telegram'
  | 'goal_worker'
  | 'page'
  | 'scout'
  | 'worker_agent'
  | 'sandbox_worker'
  | 'codex_chat';

const mutableLoopIds: MutableLoopId[] = [
  'http_chat',
  'telegram',
  'goal_worker',
  'page',
  'scout',
  'worker_agent',
  'sandbox_worker',
  'codex_chat',
];

function toolNames(tools: { function: { name: string } }[] | undefined): string[] {
  return (tools ?? []).map((tool) => tool.function.name);
}

async function withRuntimePolicy<T>(
  mutate: () => void,
  run: () => T | Promise<T>
): Promise<T> {
  const original = {
    mode: squireMasterConfig.mode,
    loops: Object.fromEntries(
      mutableLoopIds.map((loopId) => [
        loopId,
        {
          enabled: squireMasterConfig.loops[loopId].enabled,
          allowedCapabilities: [...squireMasterConfig.loops[loopId].allowedCapabilities],
          allowedTools: [...squireMasterConfig.loops[loopId].allowedTools],
          policy: squireMasterConfig.permissions.loopPolicies[loopId],
          actionPolicies: { ...(squireMasterConfig.permissions.actionGuardrails.loopActionPolicies[loopId] ?? {}) },
        },
      ])
    ) as Record<MutableLoopId, {
      enabled: boolean;
      allowedCapabilities: string[];
      allowedTools: string[];
      policy: typeof squireMasterConfig.permissions.loopPolicies[MutableLoopId];
      actionPolicies: NonNullable<typeof squireMasterConfig.permissions.actionGuardrails.loopActionPolicies[MutableLoopId]>;
    }>,
    actionGuardrails: {
      defaultPolicy: squireMasterConfig.permissions.actionGuardrails.defaultPolicy,
      toolPolicies: { ...squireMasterConfig.permissions.actionGuardrails.toolPolicies },
    },
  };

  try {
    mutate();
    return await run();
  } finally {
    squireMasterConfig.mode = original.mode;
    for (const loopId of Object.keys(original.loops) as MutableLoopId[]) {
      squireMasterConfig.loops[loopId].enabled = original.loops[loopId].enabled;
      squireMasterConfig.loops[loopId].allowedCapabilities = original.loops[loopId].allowedCapabilities;
      squireMasterConfig.loops[loopId].allowedTools = original.loops[loopId].allowedTools;
      squireMasterConfig.permissions.loopPolicies[loopId] = original.loops[loopId].policy;
      squireMasterConfig.permissions.actionGuardrails.loopActionPolicies[loopId] = original.loops[loopId].actionPolicies;
    }
    squireMasterConfig.permissions.actionGuardrails.defaultPolicy = original.actionGuardrails.defaultPolicy;
    squireMasterConfig.permissions.actionGuardrails.toolPolicies = original.actionGuardrails.toolPolicies;
  }
}

describe('runtime policy enforcement surfaces', () => {
  it('filters the HTTP chat tool list through master config policy', async () => {
    await withRuntimePolicy(
      () => {
        squireMasterConfig.loops.http_chat.allowedCapabilities = ['time'];
        squireMasterConfig.loops.http_chat.allowedTools = ['*'];
      },
      () => {
        assert.deepStrictEqual(toolNames(getHttpChatToolDefinitions()), ['get_current_time']);
      }
    );
  });

  it('initializes AgentEngine with loop-scoped tools from master config policy', async () => {
    await withRuntimePolicy(
      () => {
        squireMasterConfig.loops.telegram.allowedCapabilities = ['time'];
        squireMasterConfig.loops.telegram.allowedTools = ['*'];
      },
      () => {
        const engine = new AgentEngine({
          conversationId: 'runtime-policy-telegram',
          sourceLoop: 'telegram',
        });

        assert.deepStrictEqual(engine.getAvailableToolNames(), ['get_current_time']);
      }
    );
  });

  it('keeps AgentEngine default tool surfaces under the OpenAI tool limit', () => {
    for (const sourceLoop of ['telegram', 'goal_worker', 'commune']) {
      const engine = new AgentEngine({
        conversationId: `runtime-policy-${sourceLoop}-tool-limit`,
        sourceLoop,
      });
      const names = engine.getAvailableToolNames();

      assert.ok(names.length <= 128, `${sourceLoop} exposes ${names.length} tools`);
      assert.ok(!names.includes('browser_navigate'), `${sourceLoop} should not expose browser automation tools`);
      assert.ok(names.includes('web_search'), `${sourceLoop} should keep lightweight web search`);
    }
  });

  it('enforces background-loop policy at tool exposure and execution lookup time', async () => {
    await withRuntimePolicy(
      () => {
        squireMasterConfig.loops.goal_worker.allowedCapabilities = ['mandrel'];
        squireMasterConfig.loops.goal_worker.allowedTools = ['mandrel_context_store'];
        squireMasterConfig.permissions.loopPolicies.goal_worker = 'allow_list';
      },
      async () => {
        const engine = new AgentEngine({
          conversationId: 'runtime-policy-goal-worker',
          sourceLoop: 'goal_worker',
          triggerReason: 'test background loop',
        });

        assert.deepStrictEqual(engine.getAvailableToolNames(), ['mandrel_context_store']);

        const [deniedResult] = await executeTools([
          {
            id: 'call-denied-time',
            type: 'function',
            function: {
              name: 'get_current_time',
              arguments: '{}',
            },
          },
        ], {
          sourceLoop: 'goal_worker',
          triggerReason: 'test background loop',
        });

        assert.strictEqual(deniedResult.success, false);
        assert.match(deniedResult.result, /Unknown tool 'get_current_time'/);
      }
    );
  });

  it('filters Page and Scout internal read-only tools through master config policy', async () => {
    await withRuntimePolicy(
      () => {
        squireMasterConfig.loops.page.allowedTools = ['read_file'];
        squireMasterConfig.permissions.loopPolicies.page = 'allow_list';
        squireMasterConfig.loops.scout.allowedTools = ['grep_search', 'glob_files'];
        squireMasterConfig.permissions.loopPolicies.scout = 'allow_list';
      },
      () => {
        assert.deepStrictEqual(toolNames(getPageTools('page').map((tool) => tool.definition)), ['read_file']);
        assert.deepStrictEqual(
          toolNames(getPageTools('scout').map((tool) => tool.definition)),
          ['grep_search', 'glob_files']
        );
      }
    );
  });

  it('denies worker agent dispatch when the runtime loop is disabled by policy', async () => {
    await withRuntimePolicy(
      () => {
        squireMasterConfig.loops.sandbox_worker.enabled = false;
      },
      async () => {
        const result = await runWorkerAgent({
          runtimeId: 'sandbox',
          prompt: 'this should not execute',
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error ?? '', /sandbox_worker is disabled/);
      }
    );
  });

  it('filters Codex envelope tool calls through codex_chat allowed tools', async () => {
    await withRuntimePolicy(
      () => {
        squireMasterConfig.loops.codex_chat.allowedTools = ['bash_execute'];
        squireMasterConfig.permissions.loopPolicies.codex_chat = 'allow_list';
      },
      () => {
        const parsed = parseCodexToolCalls(
          [
            'visible',
            'SQUIRE_TOOL_CALLS_JSON',
            '{"toolCalls":[{"name":"bash_execute","arguments":{"command":"pwd"}},{"name":"claude_code","arguments":{"prompt":"no"}}]}',
            'END_SQUIRE_TOOL_CALLS_JSON',
          ].join('\n'),
          [
            {
              type: 'function',
              function: {
                name: 'bash_execute',
                description: 'Run shell command',
                parameters: { type: 'object', properties: {} },
              },
            },
            {
              type: 'function',
              function: {
                name: 'claude_code',
                description: 'Run coding worker',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          { sourceLoop: 'codex_chat' }
        );

        assert.strictEqual(parsed.cleanContent, 'visible');
        assert.deepStrictEqual(parsed.toolCalls.map((call) => call.function.name), ['bash_execute']);
      }
    );
  });

  it('blocks high-impact tool execution when action guardrails require drafts or approval', async () => {
    await withRuntimePolicy(
      () => {
        squireMasterConfig.permissions.actionGuardrails.toolPolicies.email_send = 'draft';
        squireMasterConfig.permissions.actionGuardrails.loopActionPolicies.http_chat = {
          'delete.permanent': 'require_approval',
        };
      },
      async () => {
        const [emailResult] = await executeTools([
          {
            id: 'call-email-send',
            type: 'function',
            function: {
              name: 'email_send',
              arguments: JSON.stringify({
                to: 'person@example.com',
                subject: 'Draft me',
                body: 'Hold this message',
              }),
            },
          },
        ], {
          sourceLoop: 'http_chat',
          triggerReason: 'test guardrail',
        });

        assert.strictEqual(emailResult.success, false);
        assert.match(emailResult.result, /held as a draft/);

        const [deleteResult] = await executeTools([
          {
            id: 'call-delete-note',
            type: 'function',
            function: {
              name: 'delete_note',
              arguments: JSON.stringify({ note_title: 'Important' }),
            },
          },
        ], {
          sourceLoop: 'http_chat',
          triggerReason: 'test guardrail',
        });

        assert.strictEqual(deleteResult.success, false);
        assert.match(deleteResult.result, /requires approval/);
      }
    );
  });
});
