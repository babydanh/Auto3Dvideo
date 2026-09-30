import assert from "node:assert/strict";
import { checkFlowBatchBudget, createFlowBatchBudgetApproval, parseVisibleFlowCreditCost } from "../desktop/src/flowBatchBudget.ts";

const settings = "Veo 3.1 · 720p · 8s";
const approval = createFlowBatchBudgetApproval(5, 12, settings);
assert.deepEqual(approval, {
  shotCount: 12,
  unitCreditEstimate: 5,
  totalCreditCap: 60,
  settingsEvidence: settings,
});
assert.equal(createFlowBatchBudgetApproval(0, 12, settings), null);
assert.equal(createFlowBatchBudgetApproval(Number.MAX_SAFE_INTEGER, 2, settings), null);
assert.deepEqual(checkFlowBatchBudget(approval, 7, settings, 50), {
  ok: true,
  nextEstimatedSpend: 57,
});
assert.match(checkFlowBatchBudget(approval, 7, settings, 55).reason, /vượt trần/);
assert.match(checkFlowBatchBudget(approval, 5, "Veo 3.1 · 1080p · 8s", 5).reason, /settings.*đổi/i);
assert.equal(parseVisibleFlowCreditCost(["Generate video · 5 credits", "price 5 credits"]), 5);
assert.equal(parseVisibleFlowCreditCost(["Generate video · 5 credits", "price 7 credits"]), null);
assert.equal(parseVisibleFlowCreditCost(["Balance: 5 credits"]), null);

console.log("Flow batch budget behavior passed.");
