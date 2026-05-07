export interface ProposedPlanExtraction {
  text: string;
  plans: string[];
}

const PROPOSED_PLAN_BLOCK_RE = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/gi;

export function extractProposedPlanBlocks(input: string): ProposedPlanExtraction {
  const plans: string[] = [];
  const text = input
    .replace(PROPOSED_PLAN_BLOCK_RE, (_match, plan: string) => {
      const normalizedPlan = String(plan || '').trim();
      if (normalizedPlan) {
        plans.push(normalizedPlan);
      }
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, plans };
}
