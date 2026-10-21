import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseAssignee, specialtyScore } from '../src/services/assignment.js'

const engineer = (id, specialties, overrides = {}) => ({
  _id: id,
  level: 1,
  isActive: true,
  availability: 'available',
  activeCaseCount: 0,
  maxActiveCases: 5,
  specialties,
  ...overrides,
})

const malware = engineer('malware', ['Malware', 'Trojan Horse'])
const trojan = engineer('trojan', ['Trojan Horse', 'Malware'])
const phishing = engineer('phishing', ['Phishing/Social Engineering', 'Ransomware'])
const team = [malware, trojan, phishing]

test('scores primary above secondary above no match', () => {
  assert.equal(specialtyScore(malware, 'Malware'), 2)
  assert.equal(specialtyScore(trojan, 'Malware'), 1)
  assert.equal(specialtyScore(phishing, 'Malware'), 0)
  assert.equal(specialtyScore(malware, 'Insider Threat'), 0)
})

test('picks the primary specialist first', () => {
  const result = chooseAssignee(team, 'Malware')
  assert.equal(result.engineer._id, 'malware')
  assert.equal(result.reason, 'primary specialty match')
})

test('falls back to the secondary specialist when the primary is unavailable', () => {
  const result = chooseAssignee([engineer('malware', ['Malware'], { availability: 'busy' }), trojan, phishing], 'Malware')
  assert.equal(result.engineer._id, 'trojan')
  assert.equal(result.reason, 'fallback: specialist unavailable (secondary specialty match)')
})

test('falls back when the specialist is at capacity or inactive', () => {
  const full = engineer('malware', ['Malware'], { activeCaseCount: 5 })
  assert.equal(chooseAssignee([full, trojan], 'Malware').engineer._id, 'trojan')
  const inactive = engineer('malware', ['Malware'], { isActive: false })
  assert.equal(chooseAssignee([inactive, phishing], 'Malware').engineer._id, 'phishing')
})

test('uses the lowest workload as the tie-breaker and as a last resort', () => {
  const busier = engineer('a', ['Ransomware'], { activeCaseCount: 3 })
  const lighter = engineer('b', ['Ransomware'], { activeCaseCount: 1 })
  assert.equal(chooseAssignee([busier, lighter], 'Ransomware').engineer._id, 'b')
  const result = chooseAssignee([busier, lighter], 'DDoS')
  assert.equal(result.engineer._id, 'b')
  assert.equal(result.reason, 'lowest workload')
})

test('excludes requested engineers and returns null when nobody is available', () => {
  assert.equal(chooseAssignee(team, 'Malware', ['malware']).engineer._id, 'trojan')
  assert.equal(chooseAssignee(team.map((item) => ({ ...item, availability: 'offline' })), 'Malware'), null)
  assert.equal(chooseAssignee([], 'Malware'), null)
})
