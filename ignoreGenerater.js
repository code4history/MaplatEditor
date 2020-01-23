//https://qiita.com/gin0606/items/8a76695e8a3263549bd4

require('shelljs/global');
const difference = require('lodash/difference');


const requireFiles = [
  'bundle.js',
  'index.html',
  'main.js',
  'node_modules',
  'package.json',
];

const installedNodeModules = ls('node_modules').map(e => e);

console.log(installedNodeModules);

const productionInfo = JSON.parse(
  exec('npm list --production --depth=1000 --json', { silent: true }).stdout
);

function extractDependencies(info) {
  if (!info.dependencies) { return []; }
  return Object.keys(info.dependencies).reduce((pkgs, name) => {
    const childDeps = extractDependencies(info.dependencies[name]);
    return pkgs.concat(name, childDeps);
  }, []);
}

const productionDependencies = extractDependencies(productionInfo).reduce((prev, curr, index, array) =>{
  const name = curr.split('/')[0];
  prev[name] = 1;
  if (index == array.length -1) {
    return Object.keys(prev);
  } else {
    return prev;
  }
},{});

console.log(productionDependencies);

const devDependencies = difference(installedNodeModules, productionDependencies);

// これを electron-packager の ignore に指定する
const ignoreFiles = difference(ls('./').map(e => e), requireFiles)
  .concat(devDependencies.map(name => `/node_modules/${name}(/|$)`));

console.log(ignoreFiles);
