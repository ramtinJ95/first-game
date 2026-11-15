import type { GitHubRepo } from './git.ts';
import { assetUrl, imageMarkdown, type ManifestEntry } from './manifest.ts';
import type { ReferenceInfo, ScenarioVerdict } from './selection.ts';

export interface Report {
  repo: GitHubRepo;
  branch: string;
  head: string;
  base?: string;
  runUrl?: string;
  reference: ReferenceInfo | null;
  scenarios: { verdict: ScenarioVerdict; images: ManifestEntry[] }[];
}

const VERDICT_LABELS: Record<ScenarioVerdict['kind'], string> = {
  new: 'new, the base has no captures of it',
  named: 'named for publishing',
  changed: 'changed from the base',
  unchanged: 'unchanged from the base',
};

export function renderReadme(report: Report): string {
  const { reference } = report;
  const compared = reference
    ? `${reference.branch} \`${reference.commit}\` from ${reference.runUrl} (${reference.exact ? 'the base commit' : `the newest ${reference.branch} run with captures`})`
    : 'no run of the base branch, so every scenario is published whole';
  const lines = [
    `# Captures of ${report.branch}`,
    '',
    `- Head: \`${report.head}\``,
    ...(report.base ? [`- Base: \`${report.base}\``] : []),
    `- Compared with: ${compared}`,
    ...(report.runUrl ? [`- CI run: ${report.runUrl}`] : []),
    '',
  ];
  for (const { verdict, images } of report.scenarios) {
    if (images.length === 0) continue;
    lines.push(`## \`${verdict.scenario}\`, ${VERDICT_LABELS[verdict.kind]}`, '');
    for (const image of images) {
      const path = [verdict.scenario, image.file].map(encodeURIComponent).join('/');
      lines.push(imageMarkdown(image.title, path), '');
    }
  }
  return [...lines, ...leftOut(report)].join('\n');
}

export function renderSummary(report: Report): string {
  const against = report.reference
    ? `compared with ${report.reference.branch} ${report.reference.commit}`
    : 'no run of the base branch to compare with';
  const lines = [`Captures of ${report.head} (${against})`, ''];
  for (const { verdict, images } of report.scenarios) {
    for (const image of images) {
      const url = assetUrl(report.repo, report.branch, verdict.scenario, image.file);
      lines.push(imageMarkdown(image.title, url), '');
    }
  }
  return [...lines, ...leftOut(report)].join('\n');
}

function leftOut({ scenarios, runUrl }: Report): string[] {
  const lines = scenarios.flatMap(({ verdict }) => {
    if (verdict.kind === 'unchanged') return [`- \`${verdict.scenario}\``];
    if (verdict.kind !== 'changed' || verdict.unchanged.length === 0) return [];
    const files = verdict.unchanged.map((file) => `\`${file}\``).join(', ');
    return [`- \`${verdict.scenario}\`: ${files}`];
  });
  const fullSet = runUrl
    ? `The full set is in the run's artifacts, ${runUrl}#artifacts, for the repository's artifact retention.`
    : 'The full set is in the local `captures/` folder of the machine that published.';
  return [
    ...(lines.length ? ['## Left out (unchanged from the base)', '', ...lines, ''] : []),
    fullSet,
    '',
  ];
}
