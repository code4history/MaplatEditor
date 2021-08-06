const gulp = require("gulp");
const fs = require("fs-extra");

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