var gulp = require('gulp'),
    execSync = require('child_process').execSync,
    spawn = require('child_process').spawn,
    fs = require('fs-extra');

var pkg = require('./package.json');
var version = pkg.version;

gulp.task('win32', function() {
    runPackager(true);
});

gulp.task('darwin', function() {
    runPackager(false);
});

function runPackager(isWin) {
    var platform = isWin ? 'win32' : 'darwin';
    var ignore = isWin ? 'mac' : 'win';

    var compiledFolder = 'MaplatEditor-' + platform + '-x64';
    var compiledZip = 'MaplatEditor-' + version + '-' + platform + '.zip';

    try {
        fs.statSync(compiledFolder);
        fs.removeSync(compiledFolder);
    } catch(err) {
    }
    try {
        fs.statSync(compiledZip);
        fs.removeSync(compiledZip);
    } catch(err) {
    }

    var compileCommand = 'electron-packager . --platform=' + platform +' --ignore=assets/' + ignore;
    execSync(compileCommand);

    var zipCommand = 'zip -r ' + compiledZip + ' ' + compiledFolder;
    execSync(zipCommand);

    fs.removeSync(compiledFolder);
}