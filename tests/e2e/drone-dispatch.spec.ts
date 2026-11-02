import { test, expect } from '@playwright/test';
import { requestScan } from '../../packages/simulation/src/index.js';
import { surveyFleet } from '../helpers/dispatch.js';
test('shows one drone per independent survey queue and holds overlapping jobs through save/load', async ({
  page,
}) => {
  let s = surveyFleet();
  s = requestScan(s, 'built-1', 'deep', { x: 21, y: 24 }, { x: 25, y: 25 });
  s = requestScan(s, 'built-1', 'surface', { x: 21, y: 24 }, { x: 25, y: 25 });
  s = requestScan(s, 'built-1', 'surface', { x: 40, y: 40 }, { x: 40, y: 40 });
  s.speed = 0;
  await page.goto('/');
  await page.evaluate(
    (state) =>
      localStorage.setItem('mars-first-colony-save', JSON.stringify(state)),
    s,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByText('Survey jobs and drones', { exact: true }).click();
  await page.getByRole('button', { name: '1×', exact: true }).click();
  await expect(page.getByTestId('survey-job-scan-1')).toContainText(
    'Assigned drone: built-1-survey',
    { timeout: 10000 },
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByTestId('survey-job-scan-2')).toContainText(
    'Waiting for survey area (scan-1)',
  );
  await expect(page.getByTestId('survey-job-scan-3')).toContainText(
    'Assigned drone: produced-1',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  const jobs = saved.industry.drones
    .filter((d: { job: unknown }) => d.job)
    .map(
      (d: { job: { type: string; id: string } }) => `${d.job.type}:${d.job.id}`,
    );
  expect(new Set(jobs).size).toBe(jobs.length);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByTestId('survey-job-scan-2')).toContainText(
    'Waiting for survey area (scan-1)',
  );
  await expect(page.getByTestId('survey-job-scan-3')).toContainText(
    'Assigned drone: produced-1',
  );
});
