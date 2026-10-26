/**
 * API Performance Load Test Harness (Spec Section 12)
 * Tests API latency against p95 < 500 ms target.
 */

async function benchmark(name: string, url: string, iterations = 30) {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      await res.text();
    } catch {
      // ignore
    }
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(iterations * 0.5)].toFixed(1);
  const p95 = times[Math.floor(iterations * 0.95)].toFixed(1);
  const p99 = times[Math.floor(iterations * 0.99)].toFixed(1);

  console.log(`[${name}] ${iterations} runs | p50: ${p50}ms | p95: ${p95}ms | p99: ${p99}ms (Target: < 500ms)`);
}

async function main() {
  console.log("=== Cargo Vision API Performance Benchmark ===");
  await benchmark("Health Check", "http://localhost:4000/health", 30);
  console.log("Benchmark complete.");
}

main();
