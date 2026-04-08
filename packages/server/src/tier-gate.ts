import { FREE_TOOLS } from './tier-config'

export interface GateResult {
  blocked: true
  content: Array<{ type: 'text'; text: string }>
}

const UPGRADE_MSG = 'This tool requires Tages Pro. Run `tages init --cloud` and upgrade at https://app.tages.ai/upgrade'

export function gateCheck(plan: string | undefined, toolName: string): GateResult | null {
  const effectivePlan = plan || 'free'
  if (effectivePlan !== 'free') return null
  if ((FREE_TOOLS as readonly string[]).includes(toolName)) return null

  return {
    blocked: true,
    content: [{
      type: 'text' as const,
      text: `${UPGRADE_MSG}\n\nTool "${toolName}" is available on Pro ($14/mo) and Team ($29/seat/mo) plans.`,
    }],
  }
}
