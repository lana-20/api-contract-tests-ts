// `npm run test:postman`: start the API on a free local port, run both Postman
// collections with Newman, then stop the API. Starting the server in-process means
// no fixed port, no "wait until it is up" polling, and fresh seed data per collection.
import { mkdirSync } from 'node:fs';
import newman from 'newman';
import { buildApp } from '../src/app';

const dir = new URL('.', import.meta.url).pathname;
const reportsDir = 'reports/newman';
mkdirSync(reportsDir, { recursive: true });

async function runCollection(name: string, options: Partial<newman.NewmanRunOptions> = {}): Promise<boolean> {
  const app = buildApp(); // freshly seeded store for this collection
  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const summary = await new Promise<newman.NewmanRunSummary>((resolve, reject) =>
      newman.run(
        {
          collection: `${dir}${name}.postman_collection.json`,
          environment: `${dir}local.postman_environment.json`,
          envVar: [{ key: 'baseUrl', value: baseUrl }],
          reporters: ['cli', 'htmlextra', 'allure'],
          reporter: {
            htmlextra: { export: `${reportsDir}/${name}.html`, title: `Newman: ${name}`, browserTitle: name },
            allure: { resultsDir: 'allure-results' },
          },
          ...options,
        },
        (err, result) => (err ? reject(err) : resolve(result)),
      ),
    );
    return summary.run.failures.length === 0;
  } finally {
    await app.close();
  }
}

const results = [
  await runCollection('contacts-api'),
  // Data-driven: every request runs once per row of auth-matrix.data.json.
  await runCollection('auth-matrix', { iterationData: `${dir}auth-matrix.data.json` }),
];
process.exit(results.every(Boolean) ? 0 : 1);
