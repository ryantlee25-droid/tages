export type QuestionType =
  | 'temporal-reasoning'
  | 'multi-session'
  | 'knowledge-update'
  | 'single-session-user'
  | 'single-session-assistant'
  | 'single-session-preference'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
  has_answer?: boolean
}

export interface LongMemEvalQuestion {
  question_id: string
  question_type: QuestionType
  question: string
  answer: string
  question_date: string
  haystack_dates: string[]
  haystack_session_ids: string[]
  haystack_sessions: Turn[][]
  answer_session_ids: string[]
}

export interface RunResult {
  run_id: string
  dataset_sha: string
  model_answer: string
  model_judge: string
  tages_version: string
  n: number
  overall_accuracy: number
  accuracy_by_type: Partial<Record<QuestionType, number>>
  /**
   * Task 6: retrieval-quality metric, independent of the synthetic reader's
   * answer accuracy — the fraction of questions where at least one recalled
   * memory's tagged session id was in the gold `answer_session_ids` set.
   * Unlike `overall_accuracy`, this number reflects real product retrieval
   * quality and should be cited as such in any results summary.
   */
  recall_at_k: number
  recall_at_k_by_type: Partial<Record<QuestionType, number>>
  duration_seconds: number
  cost_usd_estimate: number
  failures: Array<{ question_id: string; reason: string }>
  details?: Array<{
    question_id: string
    question_type: QuestionType
    correct: boolean
    model_answer: string
    ground_truth: string
    recalled_memory_count: number
    /** Task 3: the retrieved memory strings themselves (debugging aid, distinguishes retrieval-miss from generation-error). */
    recalled_memories: string[]
    /** Task 3: the oracle's gold evidence session ids for this question (copy of `answer_session_ids`). */
    gold_session_ids: string[]
    /** Task 6: whether any recalled memory's tagged session id was among `gold_session_ids`. */
    recalled_gold_hit: boolean
  }>
}
