const webpack = require('webpack');
const Generator = require('@electron-forge/plugin-webpack/dist/WebpackConfig').default;
const config = require('./forge.config').plugins.find(p => p.name === '@electron-forge/plugin-webpack').config;
async function compile(config) {
  const compiler = webpack(config);
  await new Promise((resolve, reject) => compiler.run((err, stats) => {
    compiler.close(() => {
      if (err) return reject(err);
      if (stats.hasErrors()) return reject(new Error(stats.toString({all:false, errors:true})));
      console.log(stats.toString({all:false, timings:true, errorsCount:true, warningsCount:true}));
      resolve();
    });
  }));
}
(async () => {
  const generator = new Generator(config, __dirname, true, 3000);
  await compile(await generator.getMainConfig());
  await compile(await generator.getRendererConfig(config.renderer));
})().catch(e => { console.error(e); process.exitCode=1; });
