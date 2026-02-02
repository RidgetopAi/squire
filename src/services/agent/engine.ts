/**
 * Agent Engine - State Machine for Autonomous Agent Loop
 *
 * Manages the state of a multi-turn conversation where the agent
 * calls tools repeatedly until the task is complete.
 */

// === Types ===

/**
 * Possible states of the agent engine
 */
export type AgentState =
  | 'idle'       // Waiting for input
  | 'gathering'  // Loading context
  | 'thinking'   // Waiting for LLM response
  | 'executing'  // Running tool calls
  | 'complete'   // Task finished
  | 'cancelled'  // User cancelled
  | 'error';     // Error occurred

/**
 * Result returned when the agent run completes
 */
export interface AgentResult {
  /** Whether the run completed successfully */
  success: boolean;
  /** Final content/response from the agent */
  content: string;
  /** Number of turns executed */
  turnCount: number;
  /** Final state of the agent */
  state: AgentState;
  /** Error message if state is 'error' */
  error?: string;
}

/**
 * Callbacks for monitoring agent execution
 */
export interface AgentCallbacks {
  /** Called when the agent state changes */
  onStateChange?: (state: AgentState, turnCount: number) => void;
  /** Called when a tool is invoked */
  onToolCall?: (toolName: string, args: unknown) => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
}

/**
 * Options for initializing the AgentEngine
 */
export interface AgentEngineOptions {
  /** Unique identifier for this conversation */
  conversationId: string;
  /** Maximum number of turns before stopping (default: 25) */
  maxTurns?: number;
  /** Event callbacks */
  callbacks?: AgentCallbacks;
}

// === AgentEngine Class ===

/**
 * AgentEngine manages the autonomous agent loop state machine.
 *
 * The engine transitions through states as it processes user input,
 * gathers context, calls the LLM, and executes tools. It supports
 * cancellation and provides callbacks for monitoring execution.
 *
 * @example
 * ```typescript
 * const engine = new AgentEngine({
 *   conversationId: 'conv-123',
 *   maxTurns: 10,
 *   callbacks: {
 *     onStateChange: (state, turn) => console.log(`State: ${state}, Turn: ${turn}`),
 *     onToolCall: (name, args) => console.log(`Tool: ${name}`, args),
 *   },
 * });
 *
 * const result = await engine.run('Help me analyze this code');
 * console.log(result.content);
 * ```
 */
export class AgentEngine {
  private state: AgentState = 'idle';
  private turnCount: number = 0;
  private readonly maxTurns: number;
  private readonly conversationId: string;
  private readonly abortController: AbortController;
  private readonly callbacks: AgentCallbacks;

  /**
   * Create a new AgentEngine instance
   *
   * @param options - Configuration options for the engine
   */
  constructor(options: AgentEngineOptions) {
    this.conversationId = options.conversationId;
    this.maxTurns = options.maxTurns ?? 25;
    this.callbacks = options.callbacks ?? {};
    this.abortController = new AbortController();
  }

  /**
   * Run the agent loop with the given input
   *
   * This is the main entry point for executing an agent task.
   * The agent will process the input, gather context, call the LLM,
   * and execute tools until the task is complete or cancelled.
   *
   * @param input - The user's input/request
   * @param context - Optional additional context to include
   * @returns Promise resolving to the agent result
   */
  async run(input: string, context?: string): Promise<AgentResult> {
    // Reset state for new run
    this.turnCount = 0;
    this.setState('gathering');

    try {
      // Check for cancellation
      if (this.abortController.signal.aborted) {
        return this.createResult('cancelled', '');
      }

      // Gathering phase (placeholder for context loading)
      // TODO: Implement context gathering in task 2.2
      this.setState('thinking');

      // Check for cancellation before LLM call
      if (this.abortController.signal.aborted) {
        return this.createResult('cancelled', '');
      }

      // Main agent loop
      while (this.turnCount < this.maxTurns) {
        // Check for cancellation at start of each turn
        if (this.abortController.signal.aborted) {
          return this.createResult('cancelled', '');
        }

        this.turnCount++;

        // TODO: Implement actual LLM call in task 2.2
        // For now, this is a placeholder that simulates completion
        this.setState('thinking');

        // Simulate LLM response check
        // In the real implementation, we would:
        // 1. Call the LLM
        // 2. Check if it wants to use tools
        // 3. If tools, setState('executing') and run them
        // 4. Loop back to 'thinking' with tool results
        // 5. If no tools, we're done

        // Placeholder: immediately complete
        // Real implementation will check for tool_use in LLM response
        const hasToolCalls = false; // Placeholder

        if (hasToolCalls) {
          this.setState('executing');
          // TODO: Execute tools and continue loop
        } else {
          // No tool calls means we're done
          this.setState('complete');
          return this.createResult(
            'complete',
            `[AgentEngine placeholder] Processed input: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}"${context ? ' with context' : ''}`
          );
        }
      }

      // Max turns reached
      this.setState('complete');
      return this.createResult(
        'complete',
        `[AgentEngine] Max turns (${this.maxTurns}) reached`
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.setState('error');
      this.callbacks.onError?.(err);
      return this.createResult('error', '', err.message);
    }
  }

  /**
   * Cancel the current agent run
   *
   * This will abort any in-progress operations and set the state to 'cancelled'.
   * Safe to call multiple times.
   */
  cancel(): void {
    this.abortController.abort();
    this.setState('cancelled');
  }

  /**
   * Get the current state of the agent
   *
   * @returns The current AgentState
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * Get the current turn count
   *
   * @returns Number of turns executed so far
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Get the conversation ID for this engine instance
   *
   * @returns The conversation ID
   */
  getConversationId(): string {
    return this.conversationId;
  }

  /**
   * Check if the abort signal has been triggered
   *
   * @returns True if cancelled, false otherwise
   */
  isAborted(): boolean {
    return this.abortController.signal.aborted;
  }

  // === Private Methods ===

  /**
   * Update the agent state and notify callbacks
   */
  private setState(newState: AgentState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.callbacks.onStateChange?.(this.state, this.turnCount);
    }
  }

  /**
   * Create a standardized AgentResult
   */
  private createResult(
    state: AgentState,
    content: string,
    error?: string
  ): AgentResult {
    return {
      success: state === 'complete',
      content,
      turnCount: this.turnCount,
      state,
      error,
    };
  }
}
