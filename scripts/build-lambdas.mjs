/**
 * Builds all Lambda handlers using esbuild.
 * Bundles each handler with its dependencies into dist/lambdas/{name}/handler.mjs
 * Also copies template files for pattern-related handlers.
 */
import { build } from 'esbuild';
import { readdirSync, existsSync, mkdirSync, cpSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const LAMBDAS_DIR = join(ROOT, 'src', 'lambdas');
const DIST_DIR = join(ROOT, 'dist', 'lambdas');
const TEMPLATES_DIR = join(ROOT, 'templates');

// Get all Lambda handler directories
const lambdaDirs = readdirSync(LAMBDAS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

console.log(`Building ${lambdaDirs.length} Lambda handlers...`);

// Handlers that need templates
const NEEDS_TEMPLATES = ['pattern-generate', 'pattern-grade', 'pattern-serialize'];

for (const name of lambdaDirs) {
  const entryPoint = join(LAMBDAS_DIR, name, 'handler.ts');
  if (!existsSync(entryPoint)) {
    console.warn(`  ⚠ Skipping ${name} (no handler.ts)`);
    continue;
  }

  const outDir = join(DIST_DIR, name);
  mkdirSync(outDir, { recursive: true });

  try {
    await build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: join(outDir, 'handler.mjs'),
      external: ['@aws-sdk/*', 'sharp'],
      sourcemap: true,
      minify: false,
      banner: {
        js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    // Copy templates for pattern handlers
    // Lambda deploys only the CodeUri directory, so templates must be inside it.
    // The TEMPLATES_PATH env var will point to /var/task/templates/parametric
    if (NEEDS_TEMPLATES.includes(name)) {
      const destTemplates = join(outDir, 'templates', 'parametric');
      mkdirSync(destTemplates, { recursive: true });
      cpSync(join(TEMPLATES_DIR, 'parametric'), destTemplates, { recursive: true });
    }

    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

console.log('Done!');
