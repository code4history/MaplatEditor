const gulp = require('gulp'),
    execSync = require('child_process').execSync,
    fs = require('fs-extra');
require('shelljs/global');
const difference = require('lodash/difference');

const pkg = require('./package.json');
const version = pkg.version;

const requireFiles = [
    'assets',
    'backend',
    'frontend',
    'html',
    'img',
    'node_modules',
    'package.json',
    'README.md',
    'tms_list.json'
];

const additionalIgnores = [
    'frontend/lib',
    'frontend/src'
];

gulp.task('win32', function() {
    runPackager(true);
    return Promise.resolve();
});

gulp.task('darwin', function() {
    runPackager(false);
    return Promise.resolve();
});

gulp.task('ignore', function() {
    console.log(ignoreGenerate());
    return Promise.resolve();
});

function runPackager(isWin) {
    const platform = isWin ? 'win32' : 'darwin';
    const ignore = isWin ? 'mac' : 'win';

    const compiledFolder = `MaplatEditor-${platform}-x64`;
    const compiledZip = `MaplatEditor-${version}-${platform}.zip`;

    try {
        fs.statSync(compiledFolder);
        fs.removeSync(compiledFolder);
    } catch(err) {}
    try {
        fs.statSync(compiledZip);
        fs.removeSync(compiledZip);
    } catch(err) {}

    const ignoreOption = '';//--ignore=assets/win'; //ignoreGenerate(isWin).map((path) => `--ignore="${path}"`).join(' ');
    const compileCommand = `electron-packager . --platform=${platform} ${ignoreOption}`;
    execSync(compileCommand);

    const zipCommand = `zip -r ${compiledZip} ${compiledFolder}`;
    execSync(zipCommand);

    fs.removeSync(compiledFolder);
}

//https://qiita.com/gin0606/items/8a76695e8a3263549bd4
function ignoreGenerate(isWin) {
    const assetsIgnore = `assets/${isWin ? 'mac' : 'win'}`;
    const installedNodeModules = ls('node_modules').map((e) => e);

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

    const devDependencies = difference(installedNodeModules, productionDependencies);

    // これを electron-packager の ignore に指定する
    const ignoreFiles = difference(ls('./').map(e => e), requireFiles)
        .concat(additionalIgnores)
        .concat([assetsIgnore])
        .concat(devDependencies.map(name => `node_modules/${name}(/|$)`));

    return ignoreFiles;
}