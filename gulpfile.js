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

gulp.task("canvas_rebuild", async () => {
  const [os, arch_abbr, pf, arch] = getArchOption();

  execSync(`electron-rebuild --arch ${arch}`, {stdio: 'inherit'});
  const assets_root = `./assets/${os}_${arch_abbr}`;
  fs.ensureDirSync(assets_root);
  try {
    fs.removeSync(`${assets_root}/canvas`);
  } catch(e) {}
  fs.copySync("./node_modules/canvas", `${assets_root}/canvas`);
  if (os === "mac") dylib_handler(`${assets_root}/canvas/build/Release`);
});

gulp.task("build", async () => {
  const [os, arch_abbr, pf, arch] = getArchOption();
  const commands = [
    "npm run lint",
    "npm run js_build",
    "npm run css_build"
  ];
  const packege_cmd = `electron-builder --${os} --${arch} --config ./build_${os}_${arch_abbr}.js`;
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

gulp.task("canvas_rebuild_dummy", async () => {
  const [os, arch_abbr, pf, arch] = getArchOption();

  const assets_root = `./assets/${os}_${arch_abbr}`;
  fs.ensureDirSync(assets_root);
  if (os === "mac") dylib_handler(`${assets_root}/canvas/build/Release`);
});

function dylib_handler(root) {
  const moved = {};
  const targets = fs.readdirSync(root).filter(x => x.match(/(?:^canvas\.node|\.dylib)$/));
  targets.forEach((target) => {
    moved[target] = 1
  });
  while (targets.length > 0) {
    const next = `${root}/${targets.shift()}`;
    const links = execSync(`otool -L ${next}`).toString().split(/\n\t/).filter((line) => {
      if (!line.match(/^\//)) return false;
      if (line.match(/^\/(?:System|usr\/lib)/)) return false;
      return true;
    }).map((line) => {
      return line.split(' (compatibility')[0];
    });
    links.forEach((libPath) => {
      const base = libPath.match(/\/([^/]+\.dylib)$/)[1];
      if (!moved[base]) {
        execSync(`cp ${libPath} ${root}/${base}`);
        execSync(`install_name_tool -id "@rpath/${base}" ${root}/${base}`);
        targets.push(base);
        moved[base] = 1;
      }
      execSync(`install_name_tool -change "${libPath}" "@loader_path/${base}" ${next}`);
    });
  }
}