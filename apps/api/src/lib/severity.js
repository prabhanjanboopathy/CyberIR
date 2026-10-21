export function calculateSeverity({ impact, urgency, assetCriticality }) {
  const score = impact * urgency * assetCriticality
  const severity = score >= 81 ? 'Critical' : score >= 46 ? 'High' : score >= 21 ? 'Medium' : 'Low'
  return { score, severity }
}
