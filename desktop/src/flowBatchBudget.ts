export type FlowBatchBudgetApproval = {
  shotCount: number;
  unitCreditEstimate: number;
  totalCreditCap: number;
  settingsEvidence: string;
};

export type FlowBatchBudgetCheck =
  | { ok: true; nextEstimatedSpend: number }
  | { ok: false; reason: string };

export function createFlowBatchBudgetApproval(
  unitCreditEstimate: number,
  shotCount: number,
  settingsEvidence: string,
): FlowBatchBudgetApproval | null {
  const totalCreditCap = unitCreditEstimate * shotCount;
  const normalizedSettings = settingsEvidence.trim();
  if (
    !Number.isSafeInteger(unitCreditEstimate) ||
    unitCreditEstimate <= 0 ||
    !Number.isSafeInteger(shotCount) ||
    shotCount < 1 ||
    !Number.isSafeInteger(totalCreditCap) ||
    totalCreditCap <= 0 ||
    !normalizedSettings
  ) {
    return null;
  }

  return {
    shotCount,
    unitCreditEstimate,
    totalCreditCap,
    settingsEvidence: normalizedSettings,
  };
}

export function parseVisibleFlowCreditCost(evidence: readonly string[]): number | null {
  const costs = new Set<number>();
  const pattern = /(?:costs?|cost|price|generate|video|tốn|giá)[^0-9]{0,80}(\d{1,3}(?:,\d{3})*|\d+)\s*(?:credits?|tín\s+dụng)/gi;
  for (const text of evidence) {
    for (const match of text.matchAll(pattern)) {
      const cost = Number(match[1].replace(/,/g, ""));
      if (!Number.isSafeInteger(cost) || cost <= 0) return null;
      costs.add(cost);
    }
  }
  return costs.size === 1 ? [...costs][0] : null;
}


export function checkFlowBatchBudget(
  approval: FlowBatchBudgetApproval,
  nextCreditCost: number,
  currentSettingsEvidence: string,
  estimatedSpend: number,
): FlowBatchBudgetCheck {
  if (
    !Number.isSafeInteger(nextCreditCost) ||
    nextCreditCost <= 0 ||
    !Number.isSafeInteger(estimatedSpend) ||
    estimatedSpend < 0
  ) {
    return { ok: false, reason: "Giá Flow hoặc tổng chi phí ước tính không hợp lệ." };
  }
  if (currentSettingsEvidence.trim() !== approval.settingsEvidence) {
    return { ok: false, reason: "Model hoặc settings Flow đã đổi sau khi duyệt batch." };
  }

  const nextEstimatedSpend = estimatedSpend + nextCreditCost;
  if (!Number.isSafeInteger(nextEstimatedSpend) || nextEstimatedSpend > approval.totalCreditCap) {
    return { ok: false, reason: "Shot kế tiếp sẽ vượt trần credit đã duyệt." };
  }

  return { ok: true, nextEstimatedSpend };
}
