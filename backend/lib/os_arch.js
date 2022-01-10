const pf = process.platform; // eslint-disable-line no-undef
const arch = process.arch; // eslint-disable-line no-undef

module.exports = function (arch_specified) { // eslint-disable-line no-undef
  const arch_decided = arch_specified || arch;
  return [
    pf === "win32" ? "win" : pf === "darwin" ? "mac" : "",
    arch_decided === "x64" ? "x64" : arch_decided === "arm64" ? "arm" : "",
    pf,
    arch_decided
  ];
};