// Nest 12 ships ESM-only; Jest 29 runs CommonJS, so transpile @nestjs/* to CJS on the fly.
const { transformSync } = require('esbuild');

module.exports = {
  process(src, filename) {
    const { code, map } = transformSync(src, {
      format: 'cjs',
      loader: 'js',
      sourcefile: filename,
      sourcemap: 'external',
      define: { 'import.meta.url': '__importMetaUrl' },
      banner: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
    });
    return { code, map };
  },
};
