const gulp = require("gulp"); // eslint-disable-line no-undef
const fs = require("fs-extra"); // eslint-disable-line no-undef
const { execSync } = require('child_process'); // eslint-disable-line no-undef

const minimist = require('minimist'); // eslint-disable-line no-undef
const osArchFinder = require("./backend/lib/os_arch"); // eslint-disable-line no-undef

gulp.task("git_switch", async () => {
  try {
    fs.statSync('.git.open');
    fs.moveSync('.git', '.git.keep');
    fs.moveSync('.git.open', '.git');
  } catch(e) {
    fs.moveSync('.git', '.git.open');
    fs.moveSync('.git.keep', '.git');
  }
});

gulp.task("exec", async () => {
  const commands = [];
  if (osArchFinder()[0] === "win") {
    commands.push("chcp 65001");
  }
  commands.push("npm run js_build");
  commands.push("npm run css_build");
  commands.push("electron .");
  execSync(commands.join(" && "), {stdio: 'inherit'});
});

gulp.task("build", async () => {
  const [os, arch_abbr, pf, arch] = getArchOption();
  const commands = [
    "npm run lint",
    "npm run js_build",
    "npm run css_build"
  ];
  const packege_cmd = `electron-builder --${os} --${arch} --config ./build_${os}.js`;
  console.log(packege_cmd);
  commands.push(packege_cmd);
  execSync(commands.join(" && "), {stdio: 'inherit'});
});

function getArchOption() {
  const options = minimist(process.argv.slice(2), { // eslint-disable-line no-undef
    string: 'arch'
  });
  return osArchFinder(options.arch);
}