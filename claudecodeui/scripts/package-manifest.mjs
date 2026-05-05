import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createBuildManifest({
  version,
  commit,
  channel,
  artifact,
  outputPath,
  nodeVersion = process.version,
  bunVersion = process.env.BUN_VERSION || '',
  builtAt = new Date().toISOString(),
}) {
  const normalizedChannel = ['debug', 'release', 'preview'].includes(channel)
    ? channel
    : 'release';
  return {
    schemaVersion: 1,
    productName: 'Argus',
    version,
    commit,
    builtAt,
    channel: normalizedChannel,
    artifact,
    outputPath,
    debug: normalizedChannel === 'debug',
    runtimes: {
      node: nodeVersion,
      bun: bunVersion,
    },
  };
}

export function writeBuildManifest(outputDir, manifest) {
  writeFileSync(join(outputDir, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
