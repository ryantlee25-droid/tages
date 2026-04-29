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
  }>
}
