const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1'
const iterations = Number(process.env.LOAD_ITERATIONS ?? 25)
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 8)

async function oneRequest(index) {
  const started = Date.now()
  const response = await fetch(`${baseUrl}/health`)
  const latency = Date.now() - started
  const payload = await response.json().catch(() => ({}))
  return { index, latency, ok: response.ok, status: response.status, payload }
}

async function worker() {
  const results = []
  for (let i = 0; i < iterations; i += 1) {
    const at = i % concurrency
    if (at === 0 && i > 0) {
      await Promise.all(results.slice(-concurrency))
    }
    results.push(oneRequest(i))
  }
  return Promise.all(results)
}

const batches = []
for (let i = 0; i < concurrency; i += 1) {
  const batch = []
  for (let j = 0; j < Math.ceil(iterations / concurrency); j += 1) {
    batch.push(oneRequest(i * Math.ceil(iterations / concurrency) + j))
  }
  batches.push(batch)
}

const allResults = (await Promise.all(batches.map((batch) => Promise.all(batch)))).flat()
const latencies = allResults.map((result) => result.latency).sort((a, b) => a - b)
const avg = latencies.reduce((sum, value) => sum + value, 0) / Math.max(latencies.length, 1)
const p95 = latencies[Math.max(0, Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95)))]
const failures = allResults.filter((result) => !result.ok || result.status !== 200).length

console.log(`Load check against ${baseUrl}`)
console.log(`Requests: ${allResults.length}`)
console.log(`Failures: ${failures}`)
console.log(`Average latency: ${avg.toFixed(1)}ms`)
console.log(`P95 latency: ${p95.toFixed(1)}ms`)

if (failures > 0 || p95 > 500) {
  console.error('Load check failed: health endpoint is unstable under the synthetic load sweep.')
  process.exit(1)
}

console.log('Synthetic load check passed.')
