import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateSeverity } from '../src/lib/severity.js'

test('severity scoring maps the documented score bands', () => {
  assert.deepEqual(calculateSeverity({ impact: 1, urgency: 1, assetCriticality: 1 }), { score: 1, severity: 'Low' })
  assert.deepEqual(calculateSeverity({ impact: 3, urgency: 3, assetCriticality: 3 }), { score: 27, severity: 'Medium' })
  assert.deepEqual(calculateSeverity({ impact: 4, urgency: 4, assetCriticality: 3 }), { score: 48, severity: 'High' })
  assert.deepEqual(calculateSeverity({ impact: 5, urgency: 5, assetCriticality: 5 }), { score: 125, severity: 'Critical' })
})
