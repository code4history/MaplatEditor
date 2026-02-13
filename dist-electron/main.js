var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var _validator, _encryptionKey, _encryptionAlgorithm, _options, _defaultValues, _isInMigration, _watcher, _watchFile, _debouncedChangeHandler, _Conf_instances, prepareOptions_fn, setupValidator_fn, captureSchemaDefaults_fn, applyDefaultValues_fn, configureSerialization_fn, resolvePath_fn, initializeStore_fn, runMigrations_fn;
import electron, { app as app$1, dialog, ipcMain as ipcMain$1, BrowserWindow, Menu } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path$d from "node:path";
import process$1 from "node:process";
import { promisify, isDeepStrictEqual } from "node:util";
import fs$k from "node:fs";
import crypto$1 from "node:crypto";
import assert from "node:assert";
import os from "node:os";
import "node:events";
import "node:stream";
import require$$0$3 from "fs";
import require$$0$1 from "constants";
import require$$0$2 from "stream";
import require$$1$1 from "util";
import require$$5$1 from "assert";
import path$e from "path";
import require$$0$5, { EventEmitter as EventEmitter$1 } from "events";
import require$$0$4 from "crypto";
import require$$1$2 from "timers";
import require$$2$1 from "buffer";
const isObject$1 = (value) => {
  const type2 = typeof value;
  return value !== null && (type2 === "object" || type2 === "function");
};
const disallowedKeys = /* @__PURE__ */ new Set([
  "__proto__",
  "prototype",
  "constructor"
]);
const MAX_ARRAY_INDEX = 1e6;
const isDigit = (character) => character >= "0" && character <= "9";
function shouldCoerceToNumber(segment) {
  if (segment === "0") {
    return true;
  }
  if (/^[1-9]\d*$/.test(segment)) {
    const parsedNumber = Number.parseInt(segment, 10);
    return parsedNumber <= Number.MAX_SAFE_INTEGER && parsedNumber <= MAX_ARRAY_INDEX;
  }
  return false;
}
function processSegment(segment, parts) {
  if (disallowedKeys.has(segment)) {
    return false;
  }
  if (segment && shouldCoerceToNumber(segment)) {
    parts.push(Number.parseInt(segment, 10));
  } else {
    parts.push(segment);
  }
  return true;
}
function parsePath(path2) {
  if (typeof path2 !== "string") {
    throw new TypeError(`Expected a string, got ${typeof path2}`);
  }
  const parts = [];
  let currentSegment = "";
  let currentPart = "start";
  let isEscaping = false;
  let position = 0;
  for (const character of path2) {
    position++;
    if (isEscaping) {
      currentSegment += character;
      isEscaping = false;
      continue;
    }
    if (character === "\\") {
      if (currentPart === "index") {
        throw new Error(`Invalid character '${character}' in an index at position ${position}`);
      }
      if (currentPart === "indexEnd") {
        throw new Error(`Invalid character '${character}' after an index at position ${position}`);
      }
      isEscaping = true;
      currentPart = currentPart === "start" ? "property" : currentPart;
      continue;
    }
    switch (character) {
      case ".": {
        if (currentPart === "index") {
          throw new Error(`Invalid character '${character}' in an index at position ${position}`);
        }
        if (currentPart === "indexEnd") {
          currentPart = "property";
          break;
        }
        if (!processSegment(currentSegment, parts)) {
          return [];
        }
        currentSegment = "";
        currentPart = "property";
        break;
      }
      case "[": {
        if (currentPart === "index") {
          throw new Error(`Invalid character '${character}' in an index at position ${position}`);
        }
        if (currentPart === "indexEnd") {
          currentPart = "index";
          break;
        }
        if (currentPart === "property" || currentPart === "start") {
          if ((currentSegment || currentPart === "property") && !processSegment(currentSegment, parts)) {
            return [];
          }
          currentSegment = "";
        }
        currentPart = "index";
        break;
      }
      case "]": {
        if (currentPart === "index") {
          if (currentSegment === "") {
            const lastSegment = parts.pop() || "";
            currentSegment = lastSegment + "[]";
            currentPart = "property";
          } else {
            const parsedNumber = Number.parseInt(currentSegment, 10);
            const isValidInteger = !Number.isNaN(parsedNumber) && Number.isFinite(parsedNumber) && parsedNumber >= 0 && parsedNumber <= Number.MAX_SAFE_INTEGER && parsedNumber <= MAX_ARRAY_INDEX && currentSegment === String(parsedNumber);
            if (isValidInteger) {
              parts.push(parsedNumber);
            } else {
              parts.push(currentSegment);
            }
            currentSegment = "";
            currentPart = "indexEnd";
          }
          break;
        }
        if (currentPart === "indexEnd") {
          throw new Error(`Invalid character '${character}' after an index at position ${position}`);
        }
        currentSegment += character;
        break;
      }
      default: {
        if (currentPart === "index" && !isDigit(character)) {
          throw new Error(`Invalid character '${character}' in an index at position ${position}`);
        }
        if (currentPart === "indexEnd") {
          throw new Error(`Invalid character '${character}' after an index at position ${position}`);
        }
        if (currentPart === "start") {
          currentPart = "property";
        }
        currentSegment += character;
      }
    }
  }
  if (isEscaping) {
    currentSegment += "\\";
  }
  switch (currentPart) {
    case "property": {
      if (!processSegment(currentSegment, parts)) {
        return [];
      }
      break;
    }
    case "index": {
      throw new Error("Index was not closed");
    }
    case "start": {
      parts.push("");
      break;
    }
  }
  return parts;
}
function normalizePath(path2) {
  if (typeof path2 === "string") {
    return parsePath(path2);
  }
  if (Array.isArray(path2)) {
    const normalized = [];
    for (const [index, segment] of path2.entries()) {
      if (typeof segment !== "string" && typeof segment !== "number") {
        throw new TypeError(`Expected a string or number for path segment at index ${index}, got ${typeof segment}`);
      }
      if (typeof segment === "number" && !Number.isFinite(segment)) {
        throw new TypeError(`Path segment at index ${index} must be a finite number, got ${segment}`);
      }
      if (disallowedKeys.has(segment)) {
        return [];
      }
      if (typeof segment === "string" && shouldCoerceToNumber(segment)) {
        normalized.push(Number.parseInt(segment, 10));
      } else {
        normalized.push(segment);
      }
    }
    return normalized;
  }
  return [];
}
function getProperty(object, path2, value) {
  if (!isObject$1(object) || typeof path2 !== "string" && !Array.isArray(path2)) {
    return value === void 0 ? object : value;
  }
  const pathArray = normalizePath(path2);
  if (pathArray.length === 0) {
    return value;
  }
  for (let index = 0; index < pathArray.length; index++) {
    const key = pathArray[index];
    object = object[key];
    if (object === void 0 || object === null) {
      if (index !== pathArray.length - 1) {
        return value;
      }
      break;
    }
  }
  return object === void 0 ? value : object;
}
function setProperty(object, path2, value) {
  if (!isObject$1(object) || typeof path2 !== "string" && !Array.isArray(path2)) {
    return object;
  }
  const root = object;
  const pathArray = normalizePath(path2);
  if (pathArray.length === 0) {
    return object;
  }
  for (let index = 0; index < pathArray.length; index++) {
    const key = pathArray[index];
    if (index === pathArray.length - 1) {
      object[key] = value;
    } else if (!isObject$1(object[key])) {
      const nextKey = pathArray[index + 1];
      const shouldCreateArray = typeof nextKey === "number";
      object[key] = shouldCreateArray ? [] : {};
    }
    object = object[key];
  }
  return root;
}
function deleteProperty(object, path2) {
  if (!isObject$1(object) || typeof path2 !== "string" && !Array.isArray(path2)) {
    return false;
  }
  const pathArray = normalizePath(path2);
  if (pathArray.length === 0) {
    return false;
  }
  for (let index = 0; index < pathArray.length; index++) {
    const key = pathArray[index];
    if (index === pathArray.length - 1) {
      const existed = Object.hasOwn(object, key);
      if (!existed) {
        return false;
      }
      delete object[key];
      return true;
    }
    object = object[key];
    if (!isObject$1(object)) {
      return false;
    }
  }
}
function hasProperty(object, path2) {
  if (!isObject$1(object) || typeof path2 !== "string" && !Array.isArray(path2)) {
    return false;
  }
  const pathArray = normalizePath(path2);
  if (pathArray.length === 0) {
    return false;
  }
  for (const key of pathArray) {
    if (!isObject$1(object) || !(key in object)) {
      return false;
    }
    object = object[key];
  }
  return true;
}
const homedir = os.homedir();
const tmpdir = os.tmpdir();
const { env } = process$1;
const macos = (name) => {
  const library = path$d.join(homedir, "Library");
  return {
    data: path$d.join(library, "Application Support", name),
    config: path$d.join(library, "Preferences", name),
    cache: path$d.join(library, "Caches", name),
    log: path$d.join(library, "Logs", name),
    temp: path$d.join(tmpdir, name)
  };
};
const windows = (name) => {
  const appData = env.APPDATA || path$d.join(homedir, "AppData", "Roaming");
  const localAppData = env.LOCALAPPDATA || path$d.join(homedir, "AppData", "Local");
  return {
    // Data/config/cache/log are invented by me as Windows isn't opinionated about this
    data: path$d.join(localAppData, name, "Data"),
    config: path$d.join(appData, name, "Config"),
    cache: path$d.join(localAppData, name, "Cache"),
    log: path$d.join(localAppData, name, "Log"),
    temp: path$d.join(tmpdir, name)
  };
};
const linux = (name) => {
  const username = path$d.basename(homedir);
  return {
    data: path$d.join(env.XDG_DATA_HOME || path$d.join(homedir, ".local", "share"), name),
    config: path$d.join(env.XDG_CONFIG_HOME || path$d.join(homedir, ".config"), name),
    cache: path$d.join(env.XDG_CACHE_HOME || path$d.join(homedir, ".cache"), name),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: path$d.join(env.XDG_STATE_HOME || path$d.join(homedir, ".local", "state"), name),
    temp: path$d.join(tmpdir, username, name)
  };
};
function envPaths(name, { suffix = "nodejs" } = {}) {
  if (typeof name !== "string") {
    throw new TypeError(`Expected a string, got ${typeof name}`);
  }
  if (suffix) {
    name += `-${suffix}`;
  }
  if (process$1.platform === "darwin") {
    return macos(name);
  }
  if (process$1.platform === "win32") {
    return windows(name);
  }
  return linux(name);
}
const attemptifyAsync = (fn, options) => {
  const { onError } = options;
  return function attemptified(...args) {
    return fn.apply(void 0, args).catch(onError);
  };
};
const attemptifySync = (fn, options) => {
  const { onError } = options;
  return function attemptified(...args) {
    try {
      return fn.apply(void 0, args);
    } catch (error2) {
      return onError(error2);
    }
  };
};
const RETRY_INTERVAL = 250;
const retryifyAsync = (fn, options) => {
  const { isRetriable } = options;
  return function retryified(options2) {
    const { timeout } = options2;
    const interval = options2.interval ?? RETRY_INTERVAL;
    const timestamp = Date.now() + timeout;
    return function attempt(...args) {
      return fn.apply(void 0, args).catch((error2) => {
        if (!isRetriable(error2))
          throw error2;
        if (Date.now() >= timestamp)
          throw error2;
        const delay = Math.round(interval * Math.random());
        if (delay > 0) {
          const delayPromise = new Promise((resolve2) => setTimeout(resolve2, delay));
          return delayPromise.then(() => attempt.apply(void 0, args));
        } else {
          return attempt.apply(void 0, args);
        }
      });
    };
  };
};
const retryifySync = (fn, options) => {
  const { isRetriable } = options;
  return function retryified(options2) {
    const { timeout } = options2;
    const timestamp = Date.now() + timeout;
    return function attempt(...args) {
      while (true) {
        try {
          return fn.apply(void 0, args);
        } catch (error2) {
          if (!isRetriable(error2))
            throw error2;
          if (Date.now() >= timestamp)
            throw error2;
          continue;
        }
      }
    };
  };
};
const Handlers = {
  /* API */
  isChangeErrorOk: (error2) => {
    if (!Handlers.isNodeError(error2))
      return false;
    const { code: code2 } = error2;
    if (code2 === "ENOSYS")
      return true;
    if (!IS_USER_ROOT && (code2 === "EINVAL" || code2 === "EPERM"))
      return true;
    return false;
  },
  isNodeError: (error2) => {
    return error2 instanceof Error;
  },
  isRetriableError: (error2) => {
    if (!Handlers.isNodeError(error2))
      return false;
    const { code: code2 } = error2;
    if (code2 === "EMFILE" || code2 === "ENFILE" || code2 === "EAGAIN" || code2 === "EBUSY" || code2 === "EACCESS" || code2 === "EACCES" || code2 === "EACCS" || code2 === "EPERM")
      return true;
    return false;
  },
  onChangeError: (error2) => {
    if (!Handlers.isNodeError(error2))
      throw error2;
    if (Handlers.isChangeErrorOk(error2))
      return;
    throw error2;
  }
};
const ATTEMPTIFY_CHANGE_ERROR_OPTIONS = {
  onError: Handlers.onChangeError
};
const ATTEMPTIFY_NOOP_OPTIONS = {
  onError: () => void 0
};
const IS_USER_ROOT = process$1.getuid ? !process$1.getuid() : false;
const RETRYIFY_OPTIONS = {
  isRetriable: Handlers.isRetriableError
};
const FS = {
  attempt: {
    /* ASYNC */
    chmod: attemptifyAsync(promisify(fs$k.chmod), ATTEMPTIFY_CHANGE_ERROR_OPTIONS),
    chown: attemptifyAsync(promisify(fs$k.chown), ATTEMPTIFY_CHANGE_ERROR_OPTIONS),
    close: attemptifyAsync(promisify(fs$k.close), ATTEMPTIFY_NOOP_OPTIONS),
    fsync: attemptifyAsync(promisify(fs$k.fsync), ATTEMPTIFY_NOOP_OPTIONS),
    mkdir: attemptifyAsync(promisify(fs$k.mkdir), ATTEMPTIFY_NOOP_OPTIONS),
    realpath: attemptifyAsync(promisify(fs$k.realpath), ATTEMPTIFY_NOOP_OPTIONS),
    stat: attemptifyAsync(promisify(fs$k.stat), ATTEMPTIFY_NOOP_OPTIONS),
    unlink: attemptifyAsync(promisify(fs$k.unlink), ATTEMPTIFY_NOOP_OPTIONS),
    /* SYNC */
    chmodSync: attemptifySync(fs$k.chmodSync, ATTEMPTIFY_CHANGE_ERROR_OPTIONS),
    chownSync: attemptifySync(fs$k.chownSync, ATTEMPTIFY_CHANGE_ERROR_OPTIONS),
    closeSync: attemptifySync(fs$k.closeSync, ATTEMPTIFY_NOOP_OPTIONS),
    existsSync: attemptifySync(fs$k.existsSync, ATTEMPTIFY_NOOP_OPTIONS),
    fsyncSync: attemptifySync(fs$k.fsync, ATTEMPTIFY_NOOP_OPTIONS),
    mkdirSync: attemptifySync(fs$k.mkdirSync, ATTEMPTIFY_NOOP_OPTIONS),
    realpathSync: attemptifySync(fs$k.realpathSync, ATTEMPTIFY_NOOP_OPTIONS),
    statSync: attemptifySync(fs$k.statSync, ATTEMPTIFY_NOOP_OPTIONS),
    unlinkSync: attemptifySync(fs$k.unlinkSync, ATTEMPTIFY_NOOP_OPTIONS)
  },
  retry: {
    /* ASYNC */
    close: retryifyAsync(promisify(fs$k.close), RETRYIFY_OPTIONS),
    fsync: retryifyAsync(promisify(fs$k.fsync), RETRYIFY_OPTIONS),
    open: retryifyAsync(promisify(fs$k.open), RETRYIFY_OPTIONS),
    readFile: retryifyAsync(promisify(fs$k.readFile), RETRYIFY_OPTIONS),
    rename: retryifyAsync(promisify(fs$k.rename), RETRYIFY_OPTIONS),
    stat: retryifyAsync(promisify(fs$k.stat), RETRYIFY_OPTIONS),
    write: retryifyAsync(promisify(fs$k.write), RETRYIFY_OPTIONS),
    writeFile: retryifyAsync(promisify(fs$k.writeFile), RETRYIFY_OPTIONS),
    /* SYNC */
    closeSync: retryifySync(fs$k.closeSync, RETRYIFY_OPTIONS),
    fsyncSync: retryifySync(fs$k.fsyncSync, RETRYIFY_OPTIONS),
    openSync: retryifySync(fs$k.openSync, RETRYIFY_OPTIONS),
    readFileSync: retryifySync(fs$k.readFileSync, RETRYIFY_OPTIONS),
    renameSync: retryifySync(fs$k.renameSync, RETRYIFY_OPTIONS),
    statSync: retryifySync(fs$k.statSync, RETRYIFY_OPTIONS),
    writeSync: retryifySync(fs$k.writeSync, RETRYIFY_OPTIONS),
    writeFileSync: retryifySync(fs$k.writeFileSync, RETRYIFY_OPTIONS)
  }
};
const DEFAULT_ENCODING = "utf8";
const DEFAULT_FILE_MODE$2 = 438;
const DEFAULT_FOLDER_MODE = 511;
const DEFAULT_WRITE_OPTIONS = {};
const DEFAULT_USER_UID = process$1.geteuid ? process$1.geteuid() : -1;
const DEFAULT_USER_GID = process$1.getegid ? process$1.getegid() : -1;
const DEFAULT_TIMEOUT_SYNC = 1e3;
const IS_POSIX = !!process$1.getuid;
process$1.getuid ? !process$1.getuid() : false;
const LIMIT_BASENAME_LENGTH = 128;
const isException = (value) => {
  return value instanceof Error && "code" in value;
};
const isString = (value) => {
  return typeof value === "string";
};
const isUndefined = (value) => {
  return value === void 0;
};
const IS_LINUX = process$1.platform === "linux";
const IS_WINDOWS = process$1.platform === "win32";
const Signals = ["SIGHUP", "SIGINT", "SIGTERM"];
if (!IS_WINDOWS) {
  Signals.push("SIGALRM", "SIGABRT", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGUSR2", "SIGTRAP", "SIGSYS", "SIGQUIT", "SIGIOT");
}
if (IS_LINUX) {
  Signals.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
}
class Interceptor {
  /* CONSTRUCTOR */
  constructor() {
    this.callbacks = /* @__PURE__ */ new Set();
    this.exited = false;
    this.exit = (signal) => {
      if (this.exited)
        return;
      this.exited = true;
      for (const callback of this.callbacks) {
        callback();
      }
      if (signal) {
        if (IS_WINDOWS && (signal !== "SIGINT" && signal !== "SIGTERM" && signal !== "SIGKILL")) {
          process$1.kill(process$1.pid, "SIGTERM");
        } else {
          process$1.kill(process$1.pid, signal);
        }
      }
    };
    this.hook = () => {
      process$1.once("exit", () => this.exit());
      for (const signal of Signals) {
        try {
          process$1.once(signal, () => this.exit(signal));
        } catch {
        }
      }
    };
    this.register = (callback) => {
      this.callbacks.add(callback);
      return () => {
        this.callbacks.delete(callback);
      };
    };
    this.hook();
  }
}
const Interceptor$1 = new Interceptor();
const whenExit = Interceptor$1.register;
const Temp = {
  /* VARIABLES */
  store: {},
  // filePath => purge
  /* API */
  create: (filePath) => {
    const randomness = `000000${Math.floor(Math.random() * 16777215).toString(16)}`.slice(-6);
    const timestamp = Date.now().toString().slice(-10);
    const prefix = "tmp-";
    const suffix = `.${prefix}${timestamp}${randomness}`;
    const tempPath = `${filePath}${suffix}`;
    return tempPath;
  },
  get: (filePath, creator, purge = true) => {
    const tempPath = Temp.truncate(creator(filePath));
    if (tempPath in Temp.store)
      return Temp.get(filePath, creator, purge);
    Temp.store[tempPath] = purge;
    const disposer = () => delete Temp.store[tempPath];
    return [tempPath, disposer];
  },
  purge: (filePath) => {
    if (!Temp.store[filePath])
      return;
    delete Temp.store[filePath];
    FS.attempt.unlink(filePath);
  },
  purgeSync: (filePath) => {
    if (!Temp.store[filePath])
      return;
    delete Temp.store[filePath];
    FS.attempt.unlinkSync(filePath);
  },
  purgeSyncAll: () => {
    for (const filePath in Temp.store) {
      Temp.purgeSync(filePath);
    }
  },
  truncate: (filePath) => {
    const basename = path$d.basename(filePath);
    if (basename.length <= LIMIT_BASENAME_LENGTH)
      return filePath;
    const truncable = /^(\.?)(.*?)((?:\.[^.]+)?(?:\.tmp-\d{10}[a-f0-9]{6})?)$/.exec(basename);
    if (!truncable)
      return filePath;
    const truncationLength = basename.length - LIMIT_BASENAME_LENGTH;
    return `${filePath.slice(0, -basename.length)}${truncable[1]}${truncable[2].slice(0, -truncationLength)}${truncable[3]}`;
  }
};
whenExit(Temp.purgeSyncAll);
function writeFileSync$1(filePath, data, options = DEFAULT_WRITE_OPTIONS) {
  if (isString(options))
    return writeFileSync$1(filePath, data, { encoding: options });
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_SYNC;
  const retryOptions = { timeout };
  let tempDisposer = null;
  let tempPath = null;
  let fd = null;
  try {
    const filePathReal = FS.attempt.realpathSync(filePath);
    const filePathExists = !!filePathReal;
    filePath = filePathReal || filePath;
    [tempPath, tempDisposer] = Temp.get(filePath, options.tmpCreate || Temp.create, !(options.tmpPurge === false));
    const useStatChown = IS_POSIX && isUndefined(options.chown);
    const useStatMode = isUndefined(options.mode);
    if (filePathExists && (useStatChown || useStatMode)) {
      const stats = FS.attempt.statSync(filePath);
      if (stats) {
        options = { ...options };
        if (useStatChown) {
          options.chown = { uid: stats.uid, gid: stats.gid };
        }
        if (useStatMode) {
          options.mode = stats.mode;
        }
      }
    }
    if (!filePathExists) {
      const parentPath = path$d.dirname(filePath);
      FS.attempt.mkdirSync(parentPath, {
        mode: DEFAULT_FOLDER_MODE,
        recursive: true
      });
    }
    fd = FS.retry.openSync(retryOptions)(tempPath, "w", options.mode || DEFAULT_FILE_MODE$2);
    if (options.tmpCreated) {
      options.tmpCreated(tempPath);
    }
    if (isString(data)) {
      FS.retry.writeSync(retryOptions)(fd, data, 0, options.encoding || DEFAULT_ENCODING);
    } else if (!isUndefined(data)) {
      FS.retry.writeSync(retryOptions)(fd, data, 0, data.length, 0);
    }
    if (options.fsync !== false) {
      if (options.fsyncWait !== false) {
        FS.retry.fsyncSync(retryOptions)(fd);
      } else {
        FS.attempt.fsync(fd);
      }
    }
    FS.retry.closeSync(retryOptions)(fd);
    fd = null;
    if (options.chown && (options.chown.uid !== DEFAULT_USER_UID || options.chown.gid !== DEFAULT_USER_GID)) {
      FS.attempt.chownSync(tempPath, options.chown.uid, options.chown.gid);
    }
    if (options.mode && options.mode !== DEFAULT_FILE_MODE$2) {
      FS.attempt.chmodSync(tempPath, options.mode);
    }
    try {
      FS.retry.renameSync(retryOptions)(tempPath, filePath);
    } catch (error2) {
      if (!isException(error2))
        throw error2;
      if (error2.code !== "ENAMETOOLONG")
        throw error2;
      FS.retry.renameSync(retryOptions)(tempPath, Temp.truncate(filePath));
    }
    tempDisposer();
    tempPath = null;
  } finally {
    if (fd)
      FS.attempt.closeSync(fd);
    if (tempPath)
      Temp.purge(tempPath);
  }
}
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x2) {
  return x2 && x2.__esModule && Object.prototype.hasOwnProperty.call(x2, "default") ? x2["default"] : x2;
}
var _2020 = { exports: {} };
var core$3 = {};
var validate = {};
var boolSchema = {};
var errors = {};
var codegen = {};
var code$1 = {};
(function(exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.regexpCode = exports$1.getEsmExportName = exports$1.getProperty = exports$1.safeStringify = exports$1.stringify = exports$1.strConcat = exports$1.addCodeArg = exports$1.str = exports$1._ = exports$1.nil = exports$1._Code = exports$1.Name = exports$1.IDENTIFIER = exports$1._CodeOrName = void 0;
  class _CodeOrName {
  }
  exports$1._CodeOrName = _CodeOrName;
  exports$1.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
  class Name extends _CodeOrName {
    constructor(s) {
      super();
      if (!exports$1.IDENTIFIER.test(s))
        throw new Error("CodeGen: name must be a valid identifier");
      this.str = s;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      return false;
    }
    get names() {
      return { [this.str]: 1 };
    }
  }
  exports$1.Name = Name;
  class _Code extends _CodeOrName {
    constructor(code2) {
      super();
      this._items = typeof code2 === "string" ? [code2] : code2;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return false;
      const item = this._items[0];
      return item === "" || item === '""';
    }
    get str() {
      var _a;
      return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
    }
    get names() {
      var _a;
      return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names2, c) => {
        if (c instanceof Name)
          names2[c.str] = (names2[c.str] || 0) + 1;
        return names2;
      }, {});
    }
  }
  exports$1._Code = _Code;
  exports$1.nil = new _Code("");
  function _(strs, ...args) {
    const code2 = [strs[0]];
    let i = 0;
    while (i < args.length) {
      addCodeArg(code2, args[i]);
      code2.push(strs[++i]);
    }
    return new _Code(code2);
  }
  exports$1._ = _;
  const plus = new _Code("+");
  function str(strs, ...args) {
    const expr = [safeStringify(strs[0])];
    let i = 0;
    while (i < args.length) {
      expr.push(plus);
      addCodeArg(expr, args[i]);
      expr.push(plus, safeStringify(strs[++i]));
    }
    optimize(expr);
    return new _Code(expr);
  }
  exports$1.str = str;
  function addCodeArg(code2, arg) {
    if (arg instanceof _Code)
      code2.push(...arg._items);
    else if (arg instanceof Name)
      code2.push(arg);
    else
      code2.push(interpolate(arg));
  }
  exports$1.addCodeArg = addCodeArg;
  function optimize(expr) {
    let i = 1;
    while (i < expr.length - 1) {
      if (expr[i] === plus) {
        const res = mergeExprItems(expr[i - 1], expr[i + 1]);
        if (res !== void 0) {
          expr.splice(i - 1, 3, res);
          continue;
        }
        expr[i++] = "+";
      }
      i++;
    }
  }
  function mergeExprItems(a, b) {
    if (b === '""')
      return a;
    if (a === '""')
      return b;
    if (typeof a == "string") {
      if (b instanceof Name || a[a.length - 1] !== '"')
        return;
      if (typeof b != "string")
        return `${a.slice(0, -1)}${b}"`;
      if (b[0] === '"')
        return a.slice(0, -1) + b.slice(1);
      return;
    }
    if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
      return `"${a}${b.slice(1)}`;
    return;
  }
  function strConcat(c1, c2) {
    return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
  }
  exports$1.strConcat = strConcat;
  function interpolate(x2) {
    return typeof x2 == "number" || typeof x2 == "boolean" || x2 === null ? x2 : safeStringify(Array.isArray(x2) ? x2.join(",") : x2);
  }
  function stringify2(x2) {
    return new _Code(safeStringify(x2));
  }
  exports$1.stringify = stringify2;
  function safeStringify(x2) {
    return JSON.stringify(x2).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  exports$1.safeStringify = safeStringify;
  function getProperty2(key) {
    return typeof key == "string" && exports$1.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
  }
  exports$1.getProperty = getProperty2;
  function getEsmExportName(key) {
    if (typeof key == "string" && exports$1.IDENTIFIER.test(key)) {
      return new _Code(`${key}`);
    }
    throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
  }
  exports$1.getEsmExportName = getEsmExportName;
  function regexpCode(rx) {
    return new _Code(rx.toString());
  }
  exports$1.regexpCode = regexpCode;
})(code$1);
var scope = {};
(function(exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.ValueScope = exports$1.ValueScopeName = exports$1.Scope = exports$1.varKinds = exports$1.UsedValueState = void 0;
  const code_12 = code$1;
  class ValueError extends Error {
    constructor(name) {
      super(`CodeGen: "code" for ${name} not defined`);
      this.value = name.value;
    }
  }
  var UsedValueState;
  (function(UsedValueState2) {
    UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
    UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
  })(UsedValueState || (exports$1.UsedValueState = UsedValueState = {}));
  exports$1.varKinds = {
    const: new code_12.Name("const"),
    let: new code_12.Name("let"),
    var: new code_12.Name("var")
  };
  class Scope {
    constructor({ prefixes, parent } = {}) {
      this._names = {};
      this._prefixes = prefixes;
      this._parent = parent;
    }
    toName(nameOrPrefix) {
      return nameOrPrefix instanceof code_12.Name ? nameOrPrefix : this.name(nameOrPrefix);
    }
    name(prefix) {
      return new code_12.Name(this._newName(prefix));
    }
    _newName(prefix) {
      const ng = this._names[prefix] || this._nameGroup(prefix);
      return `${prefix}${ng.index++}`;
    }
    _nameGroup(prefix) {
      var _a, _b;
      if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
        throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
      }
      return this._names[prefix] = { prefix, index: 0 };
    }
  }
  exports$1.Scope = Scope;
  class ValueScopeName extends code_12.Name {
    constructor(prefix, nameStr) {
      super(nameStr);
      this.prefix = prefix;
    }
    setValue(value, { property, itemIndex }) {
      this.value = value;
      this.scopePath = (0, code_12._)`.${new code_12.Name(property)}[${itemIndex}]`;
    }
  }
  exports$1.ValueScopeName = ValueScopeName;
  const line = (0, code_12._)`\n`;
  class ValueScope extends Scope {
    constructor(opts) {
      super(opts);
      this._values = {};
      this._scope = opts.scope;
      this.opts = { ...opts, _n: opts.lines ? line : code_12.nil };
    }
    get() {
      return this._scope;
    }
    name(prefix) {
      return new ValueScopeName(prefix, this._newName(prefix));
    }
    value(nameOrPrefix, value) {
      var _a;
      if (value.ref === void 0)
        throw new Error("CodeGen: ref must be passed in value");
      const name = this.toName(nameOrPrefix);
      const { prefix } = name;
      const valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref;
      let vs = this._values[prefix];
      if (vs) {
        const _name = vs.get(valueKey);
        if (_name)
          return _name;
      } else {
        vs = this._values[prefix] = /* @__PURE__ */ new Map();
      }
      vs.set(valueKey, name);
      const s = this._scope[prefix] || (this._scope[prefix] = []);
      const itemIndex = s.length;
      s[itemIndex] = value.ref;
      name.setValue(value, { property: prefix, itemIndex });
      return name;
    }
    getValue(prefix, keyOrRef) {
      const vs = this._values[prefix];
      if (!vs)
        return;
      return vs.get(keyOrRef);
    }
    scopeRefs(scopeName, values = this._values) {
      return this._reduceValues(values, (name) => {
        if (name.scopePath === void 0)
          throw new Error(`CodeGen: name "${name}" has no value`);
        return (0, code_12._)`${scopeName}${name.scopePath}`;
      });
    }
    scopeCode(values = this._values, usedValues, getCode) {
      return this._reduceValues(values, (name) => {
        if (name.value === void 0)
          throw new Error(`CodeGen: name "${name}" has no value`);
        return name.value.code;
      }, usedValues, getCode);
    }
    _reduceValues(values, valueCode, usedValues = {}, getCode) {
      let code2 = code_12.nil;
      for (const prefix in values) {
        const vs = values[prefix];
        if (!vs)
          continue;
        const nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map();
        vs.forEach((name) => {
          if (nameSet.has(name))
            return;
          nameSet.set(name, UsedValueState.Started);
          let c = valueCode(name);
          if (c) {
            const def2 = this.opts.es5 ? exports$1.varKinds.var : exports$1.varKinds.const;
            code2 = (0, code_12._)`${code2}${def2} ${name} = ${c};${this.opts._n}`;
          } else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name)) {
            code2 = (0, code_12._)`${code2}${c}${this.opts._n}`;
          } else {
            throw new ValueError(name);
          }
          nameSet.set(name, UsedValueState.Completed);
        });
      }
      return code2;
    }
  }
  exports$1.ValueScope = ValueScope;
})(scope);
(function(exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.or = exports$1.and = exports$1.not = exports$1.CodeGen = exports$1.operators = exports$1.varKinds = exports$1.ValueScopeName = exports$1.ValueScope = exports$1.Scope = exports$1.Name = exports$1.regexpCode = exports$1.stringify = exports$1.getProperty = exports$1.nil = exports$1.strConcat = exports$1.str = exports$1._ = void 0;
  const code_12 = code$1;
  const scope_1 = scope;
  var code_2 = code$1;
  Object.defineProperty(exports$1, "_", { enumerable: true, get: function() {
    return code_2._;
  } });
  Object.defineProperty(exports$1, "str", { enumerable: true, get: function() {
    return code_2.str;
  } });
  Object.defineProperty(exports$1, "strConcat", { enumerable: true, get: function() {
    return code_2.strConcat;
  } });
  Object.defineProperty(exports$1, "nil", { enumerable: true, get: function() {
    return code_2.nil;
  } });
  Object.defineProperty(exports$1, "getProperty", { enumerable: true, get: function() {
    return code_2.getProperty;
  } });
  Object.defineProperty(exports$1, "stringify", { enumerable: true, get: function() {
    return code_2.stringify;
  } });
  Object.defineProperty(exports$1, "regexpCode", { enumerable: true, get: function() {
    return code_2.regexpCode;
  } });
  Object.defineProperty(exports$1, "Name", { enumerable: true, get: function() {
    return code_2.Name;
  } });
  var scope_2 = scope;
  Object.defineProperty(exports$1, "Scope", { enumerable: true, get: function() {
    return scope_2.Scope;
  } });
  Object.defineProperty(exports$1, "ValueScope", { enumerable: true, get: function() {
    return scope_2.ValueScope;
  } });
  Object.defineProperty(exports$1, "ValueScopeName", { enumerable: true, get: function() {
    return scope_2.ValueScopeName;
  } });
  Object.defineProperty(exports$1, "varKinds", { enumerable: true, get: function() {
    return scope_2.varKinds;
  } });
  exports$1.operators = {
    GT: new code_12._Code(">"),
    GTE: new code_12._Code(">="),
    LT: new code_12._Code("<"),
    LTE: new code_12._Code("<="),
    EQ: new code_12._Code("==="),
    NEQ: new code_12._Code("!=="),
    NOT: new code_12._Code("!"),
    OR: new code_12._Code("||"),
    AND: new code_12._Code("&&"),
    ADD: new code_12._Code("+")
  };
  class Node {
    optimizeNodes() {
      return this;
    }
    optimizeNames(_names, _constants) {
      return this;
    }
  }
  class Def extends Node {
    constructor(varKind, name, rhs) {
      super();
      this.varKind = varKind;
      this.name = name;
      this.rhs = rhs;
    }
    render({ es5, _n }) {
      const varKind = es5 ? scope_1.varKinds.var : this.varKind;
      const rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
      return `${varKind} ${this.name}${rhs};` + _n;
    }
    optimizeNames(names2, constants2) {
      if (!names2[this.name.str])
        return;
      if (this.rhs)
        this.rhs = optimizeExpr(this.rhs, names2, constants2);
      return this;
    }
    get names() {
      return this.rhs instanceof code_12._CodeOrName ? this.rhs.names : {};
    }
  }
  class Assign extends Node {
    constructor(lhs, rhs, sideEffects) {
      super();
      this.lhs = lhs;
      this.rhs = rhs;
      this.sideEffects = sideEffects;
    }
    render({ _n }) {
      return `${this.lhs} = ${this.rhs};` + _n;
    }
    optimizeNames(names2, constants2) {
      if (this.lhs instanceof code_12.Name && !names2[this.lhs.str] && !this.sideEffects)
        return;
      this.rhs = optimizeExpr(this.rhs, names2, constants2);
      return this;
    }
    get names() {
      const names2 = this.lhs instanceof code_12.Name ? {} : { ...this.lhs.names };
      return addExprNames(names2, this.rhs);
    }
  }
  class AssignOp extends Assign {
    constructor(lhs, op, rhs, sideEffects) {
      super(lhs, rhs, sideEffects);
      this.op = op;
    }
    render({ _n }) {
      return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
    }
  }
  class Label extends Node {
    constructor(label) {
      super();
      this.label = label;
      this.names = {};
    }
    render({ _n }) {
      return `${this.label}:` + _n;
    }
  }
  class Break extends Node {
    constructor(label) {
      super();
      this.label = label;
      this.names = {};
    }
    render({ _n }) {
      const label = this.label ? ` ${this.label}` : "";
      return `break${label};` + _n;
    }
  }
  class Throw extends Node {
    constructor(error2) {
      super();
      this.error = error2;
    }
    render({ _n }) {
      return `throw ${this.error};` + _n;
    }
    get names() {
      return this.error.names;
    }
  }
  class AnyCode extends Node {
    constructor(code2) {
      super();
      this.code = code2;
    }
    render({ _n }) {
      return `${this.code};` + _n;
    }
    optimizeNodes() {
      return `${this.code}` ? this : void 0;
    }
    optimizeNames(names2, constants2) {
      this.code = optimizeExpr(this.code, names2, constants2);
      return this;
    }
    get names() {
      return this.code instanceof code_12._CodeOrName ? this.code.names : {};
    }
  }
  class ParentNode extends Node {
    constructor(nodes = []) {
      super();
      this.nodes = nodes;
    }
    render(opts) {
      return this.nodes.reduce((code2, n) => code2 + n.render(opts), "");
    }
    optimizeNodes() {
      const { nodes } = this;
      let i = nodes.length;
      while (i--) {
        const n = nodes[i].optimizeNodes();
        if (Array.isArray(n))
          nodes.splice(i, 1, ...n);
        else if (n)
          nodes[i] = n;
        else
          nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : void 0;
    }
    optimizeNames(names2, constants2) {
      const { nodes } = this;
      let i = nodes.length;
      while (i--) {
        const n = nodes[i];
        if (n.optimizeNames(names2, constants2))
          continue;
        subtractNames(names2, n.names);
        nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : void 0;
    }
    get names() {
      return this.nodes.reduce((names2, n) => addNames(names2, n.names), {});
    }
  }
  class BlockNode extends ParentNode {
    render(opts) {
      return "{" + opts._n + super.render(opts) + "}" + opts._n;
    }
  }
  class Root extends ParentNode {
  }
  class Else extends BlockNode {
  }
  Else.kind = "else";
  class If extends BlockNode {
    constructor(condition, nodes) {
      super(nodes);
      this.condition = condition;
    }
    render(opts) {
      let code2 = `if(${this.condition})` + super.render(opts);
      if (this.else)
        code2 += "else " + this.else.render(opts);
      return code2;
    }
    optimizeNodes() {
      super.optimizeNodes();
      const cond = this.condition;
      if (cond === true)
        return this.nodes;
      let e = this.else;
      if (e) {
        const ns = e.optimizeNodes();
        e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
      }
      if (e) {
        if (cond === false)
          return e instanceof If ? e : e.nodes;
        if (this.nodes.length)
          return this;
        return new If(not2(cond), e instanceof If ? [e] : e.nodes);
      }
      if (cond === false || !this.nodes.length)
        return void 0;
      return this;
    }
    optimizeNames(names2, constants2) {
      var _a;
      this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names2, constants2);
      if (!(super.optimizeNames(names2, constants2) || this.else))
        return;
      this.condition = optimizeExpr(this.condition, names2, constants2);
      return this;
    }
    get names() {
      const names2 = super.names;
      addExprNames(names2, this.condition);
      if (this.else)
        addNames(names2, this.else.names);
      return names2;
    }
  }
  If.kind = "if";
  class For extends BlockNode {
  }
  For.kind = "for";
  class ForLoop extends For {
    constructor(iteration) {
      super();
      this.iteration = iteration;
    }
    render(opts) {
      return `for(${this.iteration})` + super.render(opts);
    }
    optimizeNames(names2, constants2) {
      if (!super.optimizeNames(names2, constants2))
        return;
      this.iteration = optimizeExpr(this.iteration, names2, constants2);
      return this;
    }
    get names() {
      return addNames(super.names, this.iteration.names);
    }
  }
  class ForRange extends For {
    constructor(varKind, name, from, to) {
      super();
      this.varKind = varKind;
      this.name = name;
      this.from = from;
      this.to = to;
    }
    render(opts) {
      const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
      const { name, from, to } = this;
      return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
    }
    get names() {
      const names2 = addExprNames(super.names, this.from);
      return addExprNames(names2, this.to);
    }
  }
  class ForIter extends For {
    constructor(loop, varKind, name, iterable) {
      super();
      this.loop = loop;
      this.varKind = varKind;
      this.name = name;
      this.iterable = iterable;
    }
    render(opts) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
    }
    optimizeNames(names2, constants2) {
      if (!super.optimizeNames(names2, constants2))
        return;
      this.iterable = optimizeExpr(this.iterable, names2, constants2);
      return this;
    }
    get names() {
      return addNames(super.names, this.iterable.names);
    }
  }
  class Func extends BlockNode {
    constructor(name, args, async2) {
      super();
      this.name = name;
      this.args = args;
      this.async = async2;
    }
    render(opts) {
      const _async = this.async ? "async " : "";
      return `${_async}function ${this.name}(${this.args})` + super.render(opts);
    }
  }
  Func.kind = "func";
  class Return extends ParentNode {
    render(opts) {
      return "return " + super.render(opts);
    }
  }
  Return.kind = "return";
  class Try extends BlockNode {
    render(opts) {
      let code2 = "try" + super.render(opts);
      if (this.catch)
        code2 += this.catch.render(opts);
      if (this.finally)
        code2 += this.finally.render(opts);
      return code2;
    }
    optimizeNodes() {
      var _a, _b;
      super.optimizeNodes();
      (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNodes();
      (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNodes();
      return this;
    }
    optimizeNames(names2, constants2) {
      var _a, _b;
      super.optimizeNames(names2, constants2);
      (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNames(names2, constants2);
      (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNames(names2, constants2);
      return this;
    }
    get names() {
      const names2 = super.names;
      if (this.catch)
        addNames(names2, this.catch.names);
      if (this.finally)
        addNames(names2, this.finally.names);
      return names2;
    }
  }
  class Catch extends BlockNode {
    constructor(error2) {
      super();
      this.error = error2;
    }
    render(opts) {
      return `catch(${this.error})` + super.render(opts);
    }
  }
  Catch.kind = "catch";
  class Finally extends BlockNode {
    render(opts) {
      return "finally" + super.render(opts);
    }
  }
  Finally.kind = "finally";
  class CodeGen {
    constructor(extScope, opts = {}) {
      this._values = {};
      this._blockStarts = [];
      this._constants = {};
      this.opts = { ...opts, _n: opts.lines ? "\n" : "" };
      this._extScope = extScope;
      this._scope = new scope_1.Scope({ parent: extScope });
      this._nodes = [new Root()];
    }
    toString() {
      return this._root.render(this.opts);
    }
    // returns unique name in the internal scope
    name(prefix) {
      return this._scope.name(prefix);
    }
    // reserves unique name in the external scope
    scopeName(prefix) {
      return this._extScope.name(prefix);
    }
    // reserves unique name in the external scope and assigns value to it
    scopeValue(prefixOrName, value) {
      const name = this._extScope.value(prefixOrName, value);
      const vs = this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set());
      vs.add(name);
      return name;
    }
    getScopeValue(prefix, keyOrRef) {
      return this._extScope.getValue(prefix, keyOrRef);
    }
    // return code that assigns values in the external scope to the names that are used internally
    // (same names that were returned by gen.scopeName or gen.scopeValue)
    scopeRefs(scopeName) {
      return this._extScope.scopeRefs(scopeName, this._values);
    }
    scopeCode() {
      return this._extScope.scopeCode(this._values);
    }
    _def(varKind, nameOrPrefix, rhs, constant) {
      const name = this._scope.toName(nameOrPrefix);
      if (rhs !== void 0 && constant)
        this._constants[name.str] = rhs;
      this._leafNode(new Def(varKind, name, rhs));
      return name;
    }
    // `const` declaration (`var` in es5 mode)
    const(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
    }
    // `let` declaration with optional assignment (`var` in es5 mode)
    let(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
    }
    // `var` declaration with optional assignment
    var(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
    }
    // assignment code
    assign(lhs, rhs, sideEffects) {
      return this._leafNode(new Assign(lhs, rhs, sideEffects));
    }
    // `+=` code
    add(lhs, rhs) {
      return this._leafNode(new AssignOp(lhs, exports$1.operators.ADD, rhs));
    }
    // appends passed SafeExpr to code or executes Block
    code(c) {
      if (typeof c == "function")
        c();
      else if (c !== code_12.nil)
        this._leafNode(new AnyCode(c));
      return this;
    }
    // returns code for object literal for the passed argument list of key-value pairs
    object(...keyValues) {
      const code2 = ["{"];
      for (const [key, value] of keyValues) {
        if (code2.length > 1)
          code2.push(",");
        code2.push(key);
        if (key !== value || this.opts.es5) {
          code2.push(":");
          (0, code_12.addCodeArg)(code2, value);
        }
      }
      code2.push("}");
      return new code_12._Code(code2);
    }
    // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
    if(condition, thenBody, elseBody) {
      this._blockNode(new If(condition));
      if (thenBody && elseBody) {
        this.code(thenBody).else().code(elseBody).endIf();
      } else if (thenBody) {
        this.code(thenBody).endIf();
      } else if (elseBody) {
        throw new Error('CodeGen: "else" body without "then" body');
      }
      return this;
    }
    // `else if` clause - invalid without `if` or after `else` clauses
    elseIf(condition) {
      return this._elseNode(new If(condition));
    }
    // `else` clause - only valid after `if` or `else if` clauses
    else() {
      return this._elseNode(new Else());
    }
    // end `if` statement (needed if gen.if was used only with condition)
    endIf() {
      return this._endBlockNode(If, Else);
    }
    _for(node, forBody) {
      this._blockNode(node);
      if (forBody)
        this.code(forBody).endFor();
      return this;
    }
    // a generic `for` clause (or statement if `forBody` is passed)
    for(iteration, forBody) {
      return this._for(new ForLoop(iteration), forBody);
    }
    // `for` statement for a range of values
    forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
      const name = this._scope.toName(nameOrPrefix);
      return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
    }
    // `for-of` statement (in es5 mode replace with a normal for loop)
    forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
      const name = this._scope.toName(nameOrPrefix);
      if (this.opts.es5) {
        const arr = iterable instanceof code_12.Name ? iterable : this.var("_arr", iterable);
        return this.forRange("_i", 0, (0, code_12._)`${arr}.length`, (i) => {
          this.var(name, (0, code_12._)`${arr}[${i}]`);
          forBody(name);
        });
      }
      return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
    }
    // `for-in` statement.
    // With option `ownProperties` replaced with a `for-of` loop for object keys
    forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
      if (this.opts.ownProperties) {
        return this.forOf(nameOrPrefix, (0, code_12._)`Object.keys(${obj})`, forBody);
      }
      const name = this._scope.toName(nameOrPrefix);
      return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
    }
    // end `for` loop
    endFor() {
      return this._endBlockNode(For);
    }
    // `label` statement
    label(label) {
      return this._leafNode(new Label(label));
    }
    // `break` statement
    break(label) {
      return this._leafNode(new Break(label));
    }
    // `return` statement
    return(value) {
      const node = new Return();
      this._blockNode(node);
      this.code(value);
      if (node.nodes.length !== 1)
        throw new Error('CodeGen: "return" should have one node');
      return this._endBlockNode(Return);
    }
    // `try` statement
    try(tryBody, catchCode, finallyCode) {
      if (!catchCode && !finallyCode)
        throw new Error('CodeGen: "try" without "catch" and "finally"');
      const node = new Try();
      this._blockNode(node);
      this.code(tryBody);
      if (catchCode) {
        const error2 = this.name("e");
        this._currNode = node.catch = new Catch(error2);
        catchCode(error2);
      }
      if (finallyCode) {
        this._currNode = node.finally = new Finally();
        this.code(finallyCode);
      }
      return this._endBlockNode(Catch, Finally);
    }
    // `throw` statement
    throw(error2) {
      return this._leafNode(new Throw(error2));
    }
    // start self-balancing block
    block(body, nodeCount) {
      this._blockStarts.push(this._nodes.length);
      if (body)
        this.code(body).endBlock(nodeCount);
      return this;
    }
    // end the current self-balancing block
    endBlock(nodeCount) {
      const len = this._blockStarts.pop();
      if (len === void 0)
        throw new Error("CodeGen: not in self-balancing block");
      const toClose = this._nodes.length - len;
      if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount) {
        throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
      }
      this._nodes.length = len;
      return this;
    }
    // `function` heading (or definition if funcBody is passed)
    func(name, args = code_12.nil, async2, funcBody) {
      this._blockNode(new Func(name, args, async2));
      if (funcBody)
        this.code(funcBody).endFunc();
      return this;
    }
    // end function definition
    endFunc() {
      return this._endBlockNode(Func);
    }
    optimize(n = 1) {
      while (n-- > 0) {
        this._root.optimizeNodes();
        this._root.optimizeNames(this._root.names, this._constants);
      }
    }
    _leafNode(node) {
      this._currNode.nodes.push(node);
      return this;
    }
    _blockNode(node) {
      this._currNode.nodes.push(node);
      this._nodes.push(node);
    }
    _endBlockNode(N1, N2) {
      const n = this._currNode;
      if (n instanceof N1 || N2 && n instanceof N2) {
        this._nodes.pop();
        return this;
      }
      throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
    }
    _elseNode(node) {
      const n = this._currNode;
      if (!(n instanceof If)) {
        throw new Error('CodeGen: "else" without "if"');
      }
      this._currNode = n.else = node;
      return this;
    }
    get _root() {
      return this._nodes[0];
    }
    get _currNode() {
      const ns = this._nodes;
      return ns[ns.length - 1];
    }
    set _currNode(node) {
      const ns = this._nodes;
      ns[ns.length - 1] = node;
    }
  }
  exports$1.CodeGen = CodeGen;
  function addNames(names2, from) {
    for (const n in from)
      names2[n] = (names2[n] || 0) + (from[n] || 0);
    return names2;
  }
  function addExprNames(names2, from) {
    return from instanceof code_12._CodeOrName ? addNames(names2, from.names) : names2;
  }
  function optimizeExpr(expr, names2, constants2) {
    if (expr instanceof code_12.Name)
      return replaceName(expr);
    if (!canOptimize(expr))
      return expr;
    return new code_12._Code(expr._items.reduce((items2, c) => {
      if (c instanceof code_12.Name)
        c = replaceName(c);
      if (c instanceof code_12._Code)
        items2.push(...c._items);
      else
        items2.push(c);
      return items2;
    }, []));
    function replaceName(n) {
      const c = constants2[n.str];
      if (c === void 0 || names2[n.str] !== 1)
        return n;
      delete names2[n.str];
      return c;
    }
    function canOptimize(e) {
      return e instanceof code_12._Code && e._items.some((c) => c instanceof code_12.Name && names2[c.str] === 1 && constants2[c.str] !== void 0);
    }
  }
  function subtractNames(names2, from) {
    for (const n in from)
      names2[n] = (names2[n] || 0) - (from[n] || 0);
  }
  function not2(x2) {
    return typeof x2 == "boolean" || typeof x2 == "number" || x2 === null ? !x2 : (0, code_12._)`!${par(x2)}`;
  }
  exports$1.not = not2;
  const andCode = mappend(exports$1.operators.AND);
  function and(...args) {
    return args.reduce(andCode);
  }
  exports$1.and = and;
  const orCode = mappend(exports$1.operators.OR);
  function or(...args) {
    return args.reduce(orCode);
  }
  exports$1.or = or;
  function mappend(op) {
    return (x2, y) => x2 === code_12.nil ? y : y === code_12.nil ? x2 : (0, code_12._)`${par(x2)} ${op} ${par(y)}`;
  }
  function par(x2) {
    return x2 instanceof code_12.Name ? x2 : (0, code_12._)`(${x2})`;
  }
})(codegen);
var util$1 = {};
Object.defineProperty(util$1, "__esModule", { value: true });
util$1.checkStrictMode = util$1.getErrorPath = util$1.Type = util$1.useFunc = util$1.setEvaluated = util$1.evaluatedPropsToName = util$1.mergeEvaluated = util$1.eachItem = util$1.unescapeJsonPointer = util$1.escapeJsonPointer = util$1.escapeFragment = util$1.unescapeFragment = util$1.schemaRefOrVal = util$1.schemaHasRulesButRef = util$1.schemaHasRules = util$1.checkUnknownRules = util$1.alwaysValidSchema = util$1.toHash = void 0;
const codegen_1$z = codegen;
const code_1$a = code$1;
function toHash(arr) {
  const hash = {};
  for (const item of arr)
    hash[item] = true;
  return hash;
}
util$1.toHash = toHash;
function alwaysValidSchema(it, schema) {
  if (typeof schema == "boolean")
    return schema;
  if (Object.keys(schema).length === 0)
    return true;
  checkUnknownRules(it, schema);
  return !schemaHasRules(schema, it.self.RULES.all);
}
util$1.alwaysValidSchema = alwaysValidSchema;
function checkUnknownRules(it, schema = it.schema) {
  const { opts, self: self2 } = it;
  if (!opts.strictSchema)
    return;
  if (typeof schema === "boolean")
    return;
  const rules2 = self2.RULES.keywords;
  for (const key in schema) {
    if (!rules2[key])
      checkStrictMode(it, `unknown keyword: "${key}"`);
  }
}
util$1.checkUnknownRules = checkUnknownRules;
function schemaHasRules(schema, rules2) {
  if (typeof schema == "boolean")
    return !schema;
  for (const key in schema)
    if (rules2[key])
      return true;
  return false;
}
util$1.schemaHasRules = schemaHasRules;
function schemaHasRulesButRef(schema, RULES) {
  if (typeof schema == "boolean")
    return !schema;
  for (const key in schema)
    if (key !== "$ref" && RULES.all[key])
      return true;
  return false;
}
util$1.schemaHasRulesButRef = schemaHasRulesButRef;
function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword2, $data) {
  if (!$data) {
    if (typeof schema == "number" || typeof schema == "boolean")
      return schema;
    if (typeof schema == "string")
      return (0, codegen_1$z._)`${schema}`;
  }
  return (0, codegen_1$z._)`${topSchemaRef}${schemaPath}${(0, codegen_1$z.getProperty)(keyword2)}`;
}
util$1.schemaRefOrVal = schemaRefOrVal;
function unescapeFragment(str) {
  return unescapeJsonPointer(decodeURIComponent(str));
}
util$1.unescapeFragment = unescapeFragment;
function escapeFragment(str) {
  return encodeURIComponent(escapeJsonPointer(str));
}
util$1.escapeFragment = escapeFragment;
function escapeJsonPointer(str) {
  if (typeof str == "number")
    return `${str}`;
  return str.replace(/~/g, "~0").replace(/\//g, "~1");
}
util$1.escapeJsonPointer = escapeJsonPointer;
function unescapeJsonPointer(str) {
  return str.replace(/~1/g, "/").replace(/~0/g, "~");
}
util$1.unescapeJsonPointer = unescapeJsonPointer;
function eachItem(xs, f) {
  if (Array.isArray(xs)) {
    for (const x2 of xs)
      f(x2);
  } else {
    f(xs);
  }
}
util$1.eachItem = eachItem;
function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
  return (gen, from, to, toName) => {
    const res = to === void 0 ? from : to instanceof codegen_1$z.Name ? (from instanceof codegen_1$z.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1$z.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
    return toName === codegen_1$z.Name && !(res instanceof codegen_1$z.Name) ? resultToName(gen, res) : res;
  };
}
util$1.mergeEvaluated = {
  props: makeMergeEvaluated({
    mergeNames: (gen, from, to) => gen.if((0, codegen_1$z._)`${to} !== true && ${from} !== undefined`, () => {
      gen.if((0, codegen_1$z._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1$z._)`${to} || {}`).code((0, codegen_1$z._)`Object.assign(${to}, ${from})`));
    }),
    mergeToName: (gen, from, to) => gen.if((0, codegen_1$z._)`${to} !== true`, () => {
      if (from === true) {
        gen.assign(to, true);
      } else {
        gen.assign(to, (0, codegen_1$z._)`${to} || {}`);
        setEvaluated(gen, to, from);
      }
    }),
    mergeValues: (from, to) => from === true ? true : { ...from, ...to },
    resultToName: evaluatedPropsToName
  }),
  items: makeMergeEvaluated({
    mergeNames: (gen, from, to) => gen.if((0, codegen_1$z._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1$z._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
    mergeToName: (gen, from, to) => gen.if((0, codegen_1$z._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1$z._)`${to} > ${from} ? ${to} : ${from}`)),
    mergeValues: (from, to) => from === true ? true : Math.max(from, to),
    resultToName: (gen, items2) => gen.var("items", items2)
  })
};
function evaluatedPropsToName(gen, ps) {
  if (ps === true)
    return gen.var("props", true);
  const props = gen.var("props", (0, codegen_1$z._)`{}`);
  if (ps !== void 0)
    setEvaluated(gen, props, ps);
  return props;
}
util$1.evaluatedPropsToName = evaluatedPropsToName;
function setEvaluated(gen, props, ps) {
  Object.keys(ps).forEach((p) => gen.assign((0, codegen_1$z._)`${props}${(0, codegen_1$z.getProperty)(p)}`, true));
}
util$1.setEvaluated = setEvaluated;
const snippets = {};
function useFunc(gen, f) {
  return gen.scopeValue("func", {
    ref: f,
    code: snippets[f.code] || (snippets[f.code] = new code_1$a._Code(f.code))
  });
}
util$1.useFunc = useFunc;
var Type;
(function(Type2) {
  Type2[Type2["Num"] = 0] = "Num";
  Type2[Type2["Str"] = 1] = "Str";
})(Type || (util$1.Type = Type = {}));
function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
  if (dataProp instanceof codegen_1$z.Name) {
    const isNumber = dataPropType === Type.Num;
    return jsPropertySyntax ? isNumber ? (0, codegen_1$z._)`"[" + ${dataProp} + "]"` : (0, codegen_1$z._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1$z._)`"/" + ${dataProp}` : (0, codegen_1$z._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
  }
  return jsPropertySyntax ? (0, codegen_1$z.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
}
util$1.getErrorPath = getErrorPath;
function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
  if (!mode)
    return;
  msg = `strict mode: ${msg}`;
  if (mode === true)
    throw new Error(msg);
  it.self.logger.warn(msg);
}
util$1.checkStrictMode = checkStrictMode;
var names$1 = {};
Object.defineProperty(names$1, "__esModule", { value: true });
const codegen_1$y = codegen;
const names = {
  // validation function arguments
  data: new codegen_1$y.Name("data"),
  // data passed to validation function
  // args passed from referencing schema
  valCxt: new codegen_1$y.Name("valCxt"),
  // validation/data context - should not be used directly, it is destructured to the names below
  instancePath: new codegen_1$y.Name("instancePath"),
  parentData: new codegen_1$y.Name("parentData"),
  parentDataProperty: new codegen_1$y.Name("parentDataProperty"),
  rootData: new codegen_1$y.Name("rootData"),
  // root data - same as the data passed to the first/top validation function
  dynamicAnchors: new codegen_1$y.Name("dynamicAnchors"),
  // used to support recursiveRef and dynamicRef
  // function scoped variables
  vErrors: new codegen_1$y.Name("vErrors"),
  // null or array of validation errors
  errors: new codegen_1$y.Name("errors"),
  // counter of validation errors
  this: new codegen_1$y.Name("this"),
  // "globals"
  self: new codegen_1$y.Name("self"),
  scope: new codegen_1$y.Name("scope"),
  // JTD serialize/parse name for JSON string and position
  json: new codegen_1$y.Name("json"),
  jsonPos: new codegen_1$y.Name("jsonPos"),
  jsonLen: new codegen_1$y.Name("jsonLen"),
  jsonPart: new codegen_1$y.Name("jsonPart")
};
names$1.default = names;
(function(exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.extendErrors = exports$1.resetErrorsCount = exports$1.reportExtraError = exports$1.reportError = exports$1.keyword$DataError = exports$1.keywordError = void 0;
  const codegen_12 = codegen;
  const util_12 = util$1;
  const names_12 = names$1;
  exports$1.keywordError = {
    message: ({ keyword: keyword2 }) => (0, codegen_12.str)`must pass "${keyword2}" keyword validation`
  };
  exports$1.keyword$DataError = {
    message: ({ keyword: keyword2, schemaType }) => schemaType ? (0, codegen_12.str)`"${keyword2}" keyword must be ${schemaType} ($data)` : (0, codegen_12.str)`"${keyword2}" keyword is invalid ($data)`
  };
  function reportError(cxt, error2 = exports$1.keywordError, errorPaths, overrideAllErrors) {
    const { it } = cxt;
    const { gen, compositeRule, allErrors } = it;
    const errObj = errorObjectCode(cxt, error2, errorPaths);
    if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors) {
      addError(gen, errObj);
    } else {
      returnErrors(it, (0, codegen_12._)`[${errObj}]`);
    }
  }
  exports$1.reportError = reportError;
  function reportExtraError(cxt, error2 = exports$1.keywordError, errorPaths) {
    const { it } = cxt;
    const { gen, compositeRule, allErrors } = it;
    const errObj = errorObjectCode(cxt, error2, errorPaths);
    addError(gen, errObj);
    if (!(compositeRule || allErrors)) {
      returnErrors(it, names_12.default.vErrors);
    }
  }
  exports$1.reportExtraError = reportExtraError;
  function resetErrorsCount(gen, errsCount) {
    gen.assign(names_12.default.errors, errsCount);
    gen.if((0, codegen_12._)`${names_12.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_12._)`${names_12.default.vErrors}.length`, errsCount), () => gen.assign(names_12.default.vErrors, null)));
  }
  exports$1.resetErrorsCount = resetErrorsCount;
  function extendErrors({ gen, keyword: keyword2, schemaValue, data, errsCount, it }) {
    if (errsCount === void 0)
      throw new Error("ajv implementation error");
    const err = gen.name("err");
    gen.forRange("i", errsCount, names_12.default.errors, (i) => {
      gen.const(err, (0, codegen_12._)`${names_12.default.vErrors}[${i}]`);
      gen.if((0, codegen_12._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_12._)`${err}.instancePath`, (0, codegen_12.strConcat)(names_12.default.instancePath, it.errorPath)));
      gen.assign((0, codegen_12._)`${err}.schemaPath`, (0, codegen_12.str)`${it.errSchemaPath}/${keyword2}`);
      if (it.opts.verbose) {
        gen.assign((0, codegen_12._)`${err}.schema`, schemaValue);
        gen.assign((0, codegen_12._)`${err}.data`, data);
      }
    });
  }
  exports$1.extendErrors = extendErrors;
  function addError(gen, errObj) {
    const err = gen.const("err", errObj);
    gen.if((0, codegen_12._)`${names_12.default.vErrors} === null`, () => gen.assign(names_12.default.vErrors, (0, codegen_12._)`[${err}]`), (0, codegen_12._)`${names_12.default.vErrors}.push(${err})`);
    gen.code((0, codegen_12._)`${names_12.default.errors}++`);
  }
  function returnErrors(it, errs) {
    const { gen, validateName, schemaEnv } = it;
    if (schemaEnv.$async) {
      gen.throw((0, codegen_12._)`new ${it.ValidationError}(${errs})`);
    } else {
      gen.assign((0, codegen_12._)`${validateName}.errors`, errs);
      gen.return(false);
    }
  }
  const E3 = {
    keyword: new codegen_12.Name("keyword"),
    schemaPath: new codegen_12.Name("schemaPath"),
    // also used in JTD errors
    params: new codegen_12.Name("params"),
    propertyName: new codegen_12.Name("propertyName"),
    message: new codegen_12.Name("message"),
    schema: new codegen_12.Name("schema"),
    parentSchema: new codegen_12.Name("parentSchema")
  };
  function errorObjectCode(cxt, error2, errorPaths) {
    const { createErrors } = cxt.it;
    if (createErrors === false)
      return (0, codegen_12._)`{}`;
    return errorObject(cxt, error2, errorPaths);
  }
  function errorObject(cxt, error2, errorPaths = {}) {
    const { gen, it } = cxt;
    const keyValues = [
      errorInstancePath(it, errorPaths),
      errorSchemaPath(cxt, errorPaths)
    ];
    extraErrorProps(cxt, error2, keyValues);
    return gen.object(...keyValues);
  }
  function errorInstancePath({ errorPath }, { instancePath }) {
    const instPath = instancePath ? (0, codegen_12.str)`${errorPath}${(0, util_12.getErrorPath)(instancePath, util_12.Type.Str)}` : errorPath;
    return [names_12.default.instancePath, (0, codegen_12.strConcat)(names_12.default.instancePath, instPath)];
  }
  function errorSchemaPath({ keyword: keyword2, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
    let schPath = parentSchema ? errSchemaPath : (0, codegen_12.str)`${errSchemaPath}/${keyword2}`;
    if (schemaPath) {
      schPath = (0, codegen_12.str)`${schPath}${(0, util_12.getErrorPath)(schemaPath, util_12.Type.Str)}`;
    }
    return [E3.schemaPath, schPath];
  }
  function extraErrorProps(cxt, { params, message }, keyValues) {
    const { keyword: keyword2, data, schemaValue, it } = cxt;
    const { opts, propertyName, topSchemaRef, schemaPath } = it;
    keyValues.push([E3.keyword, keyword2], [E3.params, typeof params == "function" ? params(cxt) : params || (0, codegen_12._)`{}`]);
    if (opts.messages) {
      keyValues.push([E3.message, typeof message == "function" ? message(cxt) : message]);
    }
    if (opts.verbose) {
      keyValues.push([E3.schema, schemaValue], [E3.parentSchema, (0, codegen_12._)`${topSchemaRef}${schemaPath}`], [names_12.default.data, data]);
    }
    if (propertyName)
      keyValues.push([E3.propertyName, propertyName]);
  }
})(errors);
Object.defineProperty(boolSchema, "__esModule", { value: true });
boolSchema.boolOrEmptySchema = boolSchema.topBoolOrEmptySchema = void 0;
const errors_1$3 = errors;
const codegen_1$x = codegen;
const names_1$9 = names$1;
const boolError = {
  message: "boolean schema is false"
};
function topBoolOrEmptySchema(it) {
  const { gen, schema, validateName } = it;
  if (schema === false) {
    falseSchemaError(it, false);
  } else if (typeof schema == "object" && schema.$async === true) {
    gen.return(names_1$9.default.data);
  } else {
    gen.assign((0, codegen_1$x._)`${validateName}.errors`, null);
    gen.return(true);
  }
}
boolSchema.topBoolOrEmptySchema = topBoolOrEmptySchema;
function boolOrEmptySchema(it, valid2) {
  const { gen, schema } = it;
  if (schema === false) {
    gen.var(valid2, false);
    falseSchemaError(it);
  } else {
    gen.var(valid2, true);
  }
}
boolSchema.boolOrEmptySchema = boolOrEmptySchema;
function falseSchemaError(it, overrideAllErrors) {
  const { gen, data } = it;
  const cxt = {
    gen,
    keyword: "false schema",
    data,
    schema: false,
    schemaCode: false,
    schemaValue: false,
    params: {},
    it
  };
  (0, errors_1$3.reportError)(cxt, boolError, void 0, overrideAllErrors);
}
var dataType = {};
var rules = {};
Object.defineProperty(rules, "__esModule", { value: true });
rules.getRules = rules.isJSONType = void 0;
const _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
const jsonTypes = new Set(_jsonTypes);
function isJSONType(x2) {
  return typeof x2 == "string" && jsonTypes.has(x2);
}
rules.isJSONType = isJSONType;
function getRules() {
  const groups = {
    number: { type: "number", rules: [] },
    string: { type: "string", rules: [] },
    array: { type: "array", rules: [] },
    object: { type: "object", rules: [] }
  };
  return {
    types: { ...groups, integer: true, boolean: true, null: true },
    rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
    post: { rules: [] },
    all: {},
    keywords: {}
  };
}
rules.getRules = getRules;
var applicability = {};
Object.defineProperty(applicability, "__esModule", { value: true });
applicability.shouldUseRule = applicability.shouldUseGroup = applicability.schemaHasRulesForType = void 0;
function schemaHasRulesForType({ schema, self: self2 }, type2) {
  const group = self2.RULES.types[type2];
  return group && group !== true && shouldUseGroup(schema, group);
}
applicability.schemaHasRulesForType = schemaHasRulesForType;
function shouldUseGroup(schema, group) {
  return group.rules.some((rule) => shouldUseRule(schema, rule));
}
applicability.shouldUseGroup = shouldUseGroup;
function shouldUseRule(schema, rule) {
  var _a;
  return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
}
applicability.shouldUseRule = shouldUseRule;
Object.defineProperty(dataType, "__esModule", { value: true });
dataType.reportTypeError = dataType.checkDataTypes = dataType.checkDataType = dataType.coerceAndCheckDataType = dataType.getJSONTypes = dataType.getSchemaTypes = dataType.DataType = void 0;
const rules_1 = rules;
const applicability_1$1 = applicability;
const errors_1$2 = errors;
const codegen_1$w = codegen;
const util_1$u = util$1;
var DataType;
(function(DataType2) {
  DataType2[DataType2["Correct"] = 0] = "Correct";
  DataType2[DataType2["Wrong"] = 1] = "Wrong";
})(DataType || (dataType.DataType = DataType = {}));
function getSchemaTypes(schema) {
  const types2 = getJSONTypes(schema.type);
  const hasNull = types2.includes("null");
  if (hasNull) {
    if (schema.nullable === false)
      throw new Error("type: null contradicts nullable: false");
  } else {
    if (!types2.length && schema.nullable !== void 0) {
      throw new Error('"nullable" cannot be used without "type"');
    }
    if (schema.nullable === true)
      types2.push("null");
  }
  return types2;
}
dataType.getSchemaTypes = getSchemaTypes;
function getJSONTypes(ts) {
  const types2 = Array.isArray(ts) ? ts : ts ? [ts] : [];
  if (types2.every(rules_1.isJSONType))
    return types2;
  throw new Error("type must be JSONType or JSONType[]: " + types2.join(","));
}
dataType.getJSONTypes = getJSONTypes;
function coerceAndCheckDataType(it, types2) {
  const { gen, data, opts } = it;
  const coerceTo = coerceToTypes(types2, opts.coerceTypes);
  const checkTypes = types2.length > 0 && !(coerceTo.length === 0 && types2.length === 1 && (0, applicability_1$1.schemaHasRulesForType)(it, types2[0]));
  if (checkTypes) {
    const wrongType = checkDataTypes(types2, data, opts.strictNumbers, DataType.Wrong);
    gen.if(wrongType, () => {
      if (coerceTo.length)
        coerceData(it, types2, coerceTo);
      else
        reportTypeError(it);
    });
  }
  return checkTypes;
}
dataType.coerceAndCheckDataType = coerceAndCheckDataType;
const COERCIBLE = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
function coerceToTypes(types2, coerceTypes) {
  return coerceTypes ? types2.filter((t2) => COERCIBLE.has(t2) || coerceTypes === "array" && t2 === "array") : [];
}
function coerceData(it, types2, coerceTo) {
  const { gen, data, opts } = it;
  const dataType2 = gen.let("dataType", (0, codegen_1$w._)`typeof ${data}`);
  const coerced = gen.let("coerced", (0, codegen_1$w._)`undefined`);
  if (opts.coerceTypes === "array") {
    gen.if((0, codegen_1$w._)`${dataType2} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1$w._)`${data}[0]`).assign(dataType2, (0, codegen_1$w._)`typeof ${data}`).if(checkDataTypes(types2, data, opts.strictNumbers), () => gen.assign(coerced, data)));
  }
  gen.if((0, codegen_1$w._)`${coerced} !== undefined`);
  for (const t2 of coerceTo) {
    if (COERCIBLE.has(t2) || t2 === "array" && opts.coerceTypes === "array") {
      coerceSpecificType(t2);
    }
  }
  gen.else();
  reportTypeError(it);
  gen.endIf();
  gen.if((0, codegen_1$w._)`${coerced} !== undefined`, () => {
    gen.assign(data, coerced);
    assignParentData(it, coerced);
  });
  function coerceSpecificType(t2) {
    switch (t2) {
      case "string":
        gen.elseIf((0, codegen_1$w._)`${dataType2} == "number" || ${dataType2} == "boolean"`).assign(coerced, (0, codegen_1$w._)`"" + ${data}`).elseIf((0, codegen_1$w._)`${data} === null`).assign(coerced, (0, codegen_1$w._)`""`);
        return;
      case "number":
        gen.elseIf((0, codegen_1$w._)`${dataType2} == "boolean" || ${data} === null
              || (${dataType2} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1$w._)`+${data}`);
        return;
      case "integer":
        gen.elseIf((0, codegen_1$w._)`${dataType2} === "boolean" || ${data} === null
              || (${dataType2} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1$w._)`+${data}`);
        return;
      case "boolean":
        gen.elseIf((0, codegen_1$w._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1$w._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
        return;
      case "null":
        gen.elseIf((0, codegen_1$w._)`${data} === "" || ${data} === 0 || ${data} === false`);
        gen.assign(coerced, null);
        return;
      case "array":
        gen.elseIf((0, codegen_1$w._)`${dataType2} === "string" || ${dataType2} === "number"
              || ${dataType2} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1$w._)`[${data}]`);
    }
  }
}
function assignParentData({ gen, parentData, parentDataProperty }, expr) {
  gen.if((0, codegen_1$w._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1$w._)`${parentData}[${parentDataProperty}]`, expr));
}
function checkDataType(dataType2, data, strictNums, correct = DataType.Correct) {
  const EQ = correct === DataType.Correct ? codegen_1$w.operators.EQ : codegen_1$w.operators.NEQ;
  let cond;
  switch (dataType2) {
    case "null":
      return (0, codegen_1$w._)`${data} ${EQ} null`;
    case "array":
      cond = (0, codegen_1$w._)`Array.isArray(${data})`;
      break;
    case "object":
      cond = (0, codegen_1$w._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
      break;
    case "integer":
      cond = numCond((0, codegen_1$w._)`!(${data} % 1) && !isNaN(${data})`);
      break;
    case "number":
      cond = numCond();
      break;
    default:
      return (0, codegen_1$w._)`typeof ${data} ${EQ} ${dataType2}`;
  }
  return correct === DataType.Correct ? cond : (0, codegen_1$w.not)(cond);
  function numCond(_cond = codegen_1$w.nil) {
    return (0, codegen_1$w.and)((0, codegen_1$w._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1$w._)`isFinite(${data})` : codegen_1$w.nil);
  }
}
dataType.checkDataType = checkDataType;
function checkDataTypes(dataTypes, data, strictNums, correct) {
  if (dataTypes.length === 1) {
    return checkDataType(dataTypes[0], data, strictNums, correct);
  }
  let cond;
  const types2 = (0, util_1$u.toHash)(dataTypes);
  if (types2.array && types2.object) {
    const notObj = (0, codegen_1$w._)`typeof ${data} != "object"`;
    cond = types2.null ? notObj : (0, codegen_1$w._)`!${data} || ${notObj}`;
    delete types2.null;
    delete types2.array;
    delete types2.object;
  } else {
    cond = codegen_1$w.nil;
  }
  if (types2.number)
    delete types2.integer;
  for (const t2 in types2)
    cond = (0, codegen_1$w.and)(cond, checkDataType(t2, data, strictNums, correct));
  return cond;
}
dataType.checkDataTypes = checkDataTypes;
const typeError = {
  message: ({ schema }) => `must be ${schema}`,
  params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1$w._)`{type: ${schema}}` : (0, codegen_1$w._)`{type: ${schemaValue}}`
};
function reportTypeError(it) {
  const cxt = getTypeErrorContext(it);
  (0, errors_1$2.reportError)(cxt, typeError);
}
dataType.reportTypeError = reportTypeError;
function getTypeErrorContext(it) {
  const { gen, data, schema } = it;
  const schemaCode = (0, util_1$u.schemaRefOrVal)(it, schema, "type");
  return {
    gen,
    keyword: "type",
    data,
    schema: schema.type,
    schemaCode,
    schemaValue: schemaCode,
    parentSchema: schema,
    params: {},
    it
  };
}
var defaults = {};
Object.defineProperty(defaults, "__esModule", { value: true });
defaults.assignDefaults = void 0;
const codegen_1$v = codegen;
const util_1$t = util$1;
function assignDefaults(it, ty) {
  const { properties: properties2, items: items2 } = it.schema;
  if (ty === "object" && properties2) {
    for (const key in properties2) {
      assignDefault(it, key, properties2[key].default);
    }
  } else if (ty === "array" && Array.isArray(items2)) {
    items2.forEach((sch, i) => assignDefault(it, i, sch.default));
  }
}
defaults.assignDefaults = assignDefaults;
function assignDefault(it, prop, defaultValue) {
  const { gen, compositeRule, data, opts } = it;
  if (defaultValue === void 0)
    return;
  const childData = (0, codegen_1$v._)`${data}${(0, codegen_1$v.getProperty)(prop)}`;
  if (compositeRule) {
    (0, util_1$t.checkStrictMode)(it, `default is ignored for: ${childData}`);
    return;
  }
  let condition = (0, codegen_1$v._)`${childData} === undefined`;
  if (opts.useDefaults === "empty") {
    condition = (0, codegen_1$v._)`${condition} || ${childData} === null || ${childData} === ""`;
  }
  gen.if(condition, (0, codegen_1$v._)`${childData} = ${(0, codegen_1$v.stringify)(defaultValue)}`);
}
var keyword = {};
var code = {};
Object.defineProperty(code, "__esModule", { value: true });
code.validateUnion = code.validateArray = code.usePattern = code.callValidateCode = code.schemaProperties = code.allSchemaProperties = code.noPropertyInData = code.propertyInData = code.isOwnProperty = code.hasPropFunc = code.reportMissingProp = code.checkMissingProp = code.checkReportMissingProp = void 0;
const codegen_1$u = codegen;
const util_1$s = util$1;
const names_1$8 = names$1;
const util_2$1 = util$1;
function checkReportMissingProp(cxt, prop) {
  const { gen, data, it } = cxt;
  gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
    cxt.setParams({ missingProperty: (0, codegen_1$u._)`${prop}` }, true);
    cxt.error();
  });
}
code.checkReportMissingProp = checkReportMissingProp;
function checkMissingProp({ gen, data, it: { opts } }, properties2, missing) {
  return (0, codegen_1$u.or)(...properties2.map((prop) => (0, codegen_1$u.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1$u._)`${missing} = ${prop}`)));
}
code.checkMissingProp = checkMissingProp;
function reportMissingProp(cxt, missing) {
  cxt.setParams({ missingProperty: missing }, true);
  cxt.error();
}
code.reportMissingProp = reportMissingProp;
function hasPropFunc(gen) {
  return gen.scopeValue("func", {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    ref: Object.prototype.hasOwnProperty,
    code: (0, codegen_1$u._)`Object.prototype.hasOwnProperty`
  });
}
code.hasPropFunc = hasPropFunc;
function isOwnProperty(gen, data, property) {
  return (0, codegen_1$u._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
}
code.isOwnProperty = isOwnProperty;
function propertyInData(gen, data, property, ownProperties) {
  const cond = (0, codegen_1$u._)`${data}${(0, codegen_1$u.getProperty)(property)} !== undefined`;
  return ownProperties ? (0, codegen_1$u._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
}
code.propertyInData = propertyInData;
function noPropertyInData(gen, data, property, ownProperties) {
  const cond = (0, codegen_1$u._)`${data}${(0, codegen_1$u.getProperty)(property)} === undefined`;
  return ownProperties ? (0, codegen_1$u.or)(cond, (0, codegen_1$u.not)(isOwnProperty(gen, data, property))) : cond;
}
code.noPropertyInData = noPropertyInData;
function allSchemaProperties(schemaMap) {
  return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
}
code.allSchemaProperties = allSchemaProperties;
function schemaProperties(it, schemaMap) {
  return allSchemaProperties(schemaMap).filter((p) => !(0, util_1$s.alwaysValidSchema)(it, schemaMap[p]));
}
code.schemaProperties = schemaProperties;
function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
  const dataAndSchema = passSchema ? (0, codegen_1$u._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
  const valCxt = [
    [names_1$8.default.instancePath, (0, codegen_1$u.strConcat)(names_1$8.default.instancePath, errorPath)],
    [names_1$8.default.parentData, it.parentData],
    [names_1$8.default.parentDataProperty, it.parentDataProperty],
    [names_1$8.default.rootData, names_1$8.default.rootData]
  ];
  if (it.opts.dynamicRef)
    valCxt.push([names_1$8.default.dynamicAnchors, names_1$8.default.dynamicAnchors]);
  const args = (0, codegen_1$u._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
  return context !== codegen_1$u.nil ? (0, codegen_1$u._)`${func}.call(${context}, ${args})` : (0, codegen_1$u._)`${func}(${args})`;
}
code.callValidateCode = callValidateCode;
const newRegExp = (0, codegen_1$u._)`new RegExp`;
function usePattern({ gen, it: { opts } }, pattern2) {
  const u2 = opts.unicodeRegExp ? "u" : "";
  const { regExp } = opts.code;
  const rx = regExp(pattern2, u2);
  return gen.scopeValue("pattern", {
    key: rx.toString(),
    ref: rx,
    code: (0, codegen_1$u._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2$1.useFunc)(gen, regExp)}(${pattern2}, ${u2})`
  });
}
code.usePattern = usePattern;
function validateArray(cxt) {
  const { gen, data, keyword: keyword2, it } = cxt;
  const valid2 = gen.name("valid");
  if (it.allErrors) {
    const validArr = gen.let("valid", true);
    validateItems(() => gen.assign(validArr, false));
    return validArr;
  }
  gen.var(valid2, true);
  validateItems(() => gen.break());
  return valid2;
  function validateItems(notValid) {
    const len = gen.const("len", (0, codegen_1$u._)`${data}.length`);
    gen.forRange("i", 0, len, (i) => {
      cxt.subschema({
        keyword: keyword2,
        dataProp: i,
        dataPropType: util_1$s.Type.Num
      }, valid2);
      gen.if((0, codegen_1$u.not)(valid2), notValid);
    });
  }
}
code.validateArray = validateArray;
function validateUnion(cxt) {
  const { gen, schema, keyword: keyword2, it } = cxt;
  if (!Array.isArray(schema))
    throw new Error("ajv implementation error");
  const alwaysValid = schema.some((sch) => (0, util_1$s.alwaysValidSchema)(it, sch));
  if (alwaysValid && !it.opts.unevaluated)
    return;
  const valid2 = gen.let("valid", false);
  const schValid = gen.name("_valid");
  gen.block(() => schema.forEach((_sch, i) => {
    const schCxt = cxt.subschema({
      keyword: keyword2,
      schemaProp: i,
      compositeRule: true
    }, schValid);
    gen.assign(valid2, (0, codegen_1$u._)`${valid2} || ${schValid}`);
    const merged = cxt.mergeValidEvaluated(schCxt, schValid);
    if (!merged)
      gen.if((0, codegen_1$u.not)(valid2));
  }));
  cxt.result(valid2, () => cxt.reset(), () => cxt.error(true));
}
code.validateUnion = validateUnion;
Object.defineProperty(keyword, "__esModule", { value: true });
keyword.validateKeywordUsage = keyword.validSchemaType = keyword.funcKeywordCode = keyword.macroKeywordCode = void 0;
const codegen_1$t = codegen;
const names_1$7 = names$1;
const code_1$9 = code;
const errors_1$1 = errors;
function macroKeywordCode(cxt, def2) {
  const { gen, keyword: keyword2, schema, parentSchema, it } = cxt;
  const macroSchema = def2.macro.call(it.self, schema, parentSchema, it);
  const schemaRef = useKeyword(gen, keyword2, macroSchema);
  if (it.opts.validateSchema !== false)
    it.self.validateSchema(macroSchema, true);
  const valid2 = gen.name("valid");
  cxt.subschema({
    schema: macroSchema,
    schemaPath: codegen_1$t.nil,
    errSchemaPath: `${it.errSchemaPath}/${keyword2}`,
    topSchemaRef: schemaRef,
    compositeRule: true
  }, valid2);
  cxt.pass(valid2, () => cxt.error(true));
}
keyword.macroKeywordCode = macroKeywordCode;
function funcKeywordCode(cxt, def2) {
  var _a;
  const { gen, keyword: keyword2, schema, parentSchema, $data, it } = cxt;
  checkAsyncKeyword(it, def2);
  const validate2 = !$data && def2.compile ? def2.compile.call(it.self, schema, parentSchema, it) : def2.validate;
  const validateRef = useKeyword(gen, keyword2, validate2);
  const valid2 = gen.let("valid");
  cxt.block$data(valid2, validateKeyword);
  cxt.ok((_a = def2.valid) !== null && _a !== void 0 ? _a : valid2);
  function validateKeyword() {
    if (def2.errors === false) {
      assignValid();
      if (def2.modifying)
        modifyData(cxt);
      reportErrs(() => cxt.error());
    } else {
      const ruleErrs = def2.async ? validateAsync() : validateSync();
      if (def2.modifying)
        modifyData(cxt);
      reportErrs(() => addErrs(cxt, ruleErrs));
    }
  }
  function validateAsync() {
    const ruleErrs = gen.let("ruleErrs", null);
    gen.try(() => assignValid((0, codegen_1$t._)`await `), (e) => gen.assign(valid2, false).if((0, codegen_1$t._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1$t._)`${e}.errors`), () => gen.throw(e)));
    return ruleErrs;
  }
  function validateSync() {
    const validateErrs = (0, codegen_1$t._)`${validateRef}.errors`;
    gen.assign(validateErrs, null);
    assignValid(codegen_1$t.nil);
    return validateErrs;
  }
  function assignValid(_await = def2.async ? (0, codegen_1$t._)`await ` : codegen_1$t.nil) {
    const passCxt = it.opts.passContext ? names_1$7.default.this : names_1$7.default.self;
    const passSchema = !("compile" in def2 && !$data || def2.schema === false);
    gen.assign(valid2, (0, codegen_1$t._)`${_await}${(0, code_1$9.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def2.modifying);
  }
  function reportErrs(errors2) {
    var _a2;
    gen.if((0, codegen_1$t.not)((_a2 = def2.valid) !== null && _a2 !== void 0 ? _a2 : valid2), errors2);
  }
}
keyword.funcKeywordCode = funcKeywordCode;
function modifyData(cxt) {
  const { gen, data, it } = cxt;
  gen.if(it.parentData, () => gen.assign(data, (0, codegen_1$t._)`${it.parentData}[${it.parentDataProperty}]`));
}
function addErrs(cxt, errs) {
  const { gen } = cxt;
  gen.if((0, codegen_1$t._)`Array.isArray(${errs})`, () => {
    gen.assign(names_1$7.default.vErrors, (0, codegen_1$t._)`${names_1$7.default.vErrors} === null ? ${errs} : ${names_1$7.default.vErrors}.concat(${errs})`).assign(names_1$7.default.errors, (0, codegen_1$t._)`${names_1$7.default.vErrors}.length`);
    (0, errors_1$1.extendErrors)(cxt);
  }, () => cxt.error());
}
function checkAsyncKeyword({ schemaEnv }, def2) {
  if (def2.async && !schemaEnv.$async)
    throw new Error("async keyword in sync schema");
}
function useKeyword(gen, keyword2, result) {
  if (result === void 0)
    throw new Error(`keyword "${keyword2}" failed to compile`);
  return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1$t.stringify)(result) });
}
function validSchemaType(schema, schemaType, allowUndefined = false) {
  return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
}
keyword.validSchemaType = validSchemaType;
function validateKeywordUsage({ schema, opts, self: self2, errSchemaPath }, def2, keyword2) {
  if (Array.isArray(def2.keyword) ? !def2.keyword.includes(keyword2) : def2.keyword !== keyword2) {
    throw new Error("ajv implementation error");
  }
  const deps = def2.dependencies;
  if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
    throw new Error(`parent schema must have dependencies of ${keyword2}: ${deps.join(",")}`);
  }
  if (def2.validateSchema) {
    const valid2 = def2.validateSchema(schema[keyword2]);
    if (!valid2) {
      const msg = `keyword "${keyword2}" value is invalid at path "${errSchemaPath}": ` + self2.errorsText(def2.validateSchema.errors);
      if (opts.validateSchema === "log")
        self2.logger.error(msg);
      else
        throw new Error(msg);
    }
  }
}
keyword.validateKeywordUsage = validateKeywordUsage;
var subschema = {};
Object.defineProperty(subschema, "__esModule", { value: true });
subschema.extendSubschemaMode = subschema.extendSubschemaData = subschema.getSubschema = void 0;
const codegen_1$s = codegen;
const util_1$r = util$1;
function getSubschema(it, { keyword: keyword2, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
  if (keyword2 !== void 0 && schema !== void 0) {
    throw new Error('both "keyword" and "schema" passed, only one allowed');
  }
  if (keyword2 !== void 0) {
    const sch = it.schema[keyword2];
    return schemaProp === void 0 ? {
      schema: sch,
      schemaPath: (0, codegen_1$s._)`${it.schemaPath}${(0, codegen_1$s.getProperty)(keyword2)}`,
      errSchemaPath: `${it.errSchemaPath}/${keyword2}`
    } : {
      schema: sch[schemaProp],
      schemaPath: (0, codegen_1$s._)`${it.schemaPath}${(0, codegen_1$s.getProperty)(keyword2)}${(0, codegen_1$s.getProperty)(schemaProp)}`,
      errSchemaPath: `${it.errSchemaPath}/${keyword2}/${(0, util_1$r.escapeFragment)(schemaProp)}`
    };
  }
  if (schema !== void 0) {
    if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0) {
      throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
    }
    return {
      schema,
      schemaPath,
      topSchemaRef,
      errSchemaPath
    };
  }
  throw new Error('either "keyword" or "schema" must be passed');
}
subschema.getSubschema = getSubschema;
function extendSubschemaData(subschema2, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
  if (data !== void 0 && dataProp !== void 0) {
    throw new Error('both "data" and "dataProp" passed, only one allowed');
  }
  const { gen } = it;
  if (dataProp !== void 0) {
    const { errorPath, dataPathArr, opts } = it;
    const nextData = gen.let("data", (0, codegen_1$s._)`${it.data}${(0, codegen_1$s.getProperty)(dataProp)}`, true);
    dataContextProps(nextData);
    subschema2.errorPath = (0, codegen_1$s.str)`${errorPath}${(0, util_1$r.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
    subschema2.parentDataProperty = (0, codegen_1$s._)`${dataProp}`;
    subschema2.dataPathArr = [...dataPathArr, subschema2.parentDataProperty];
  }
  if (data !== void 0) {
    const nextData = data instanceof codegen_1$s.Name ? data : gen.let("data", data, true);
    dataContextProps(nextData);
    if (propertyName !== void 0)
      subschema2.propertyName = propertyName;
  }
  if (dataTypes)
    subschema2.dataTypes = dataTypes;
  function dataContextProps(_nextData) {
    subschema2.data = _nextData;
    subschema2.dataLevel = it.dataLevel + 1;
    subschema2.dataTypes = [];
    it.definedProperties = /* @__PURE__ */ new Set();
    subschema2.parentData = it.data;
    subschema2.dataNames = [...it.dataNames, _nextData];
  }
}
subschema.extendSubschemaData = extendSubschemaData;
function extendSubschemaMode(subschema2, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
  if (compositeRule !== void 0)
    subschema2.compositeRule = compositeRule;
  if (createErrors !== void 0)
    subschema2.createErrors = createErrors;
  if (allErrors !== void 0)
    subschema2.allErrors = allErrors;
  subschema2.jtdDiscriminator = jtdDiscriminator;
  subschema2.jtdMetadata = jtdMetadata;
}
subschema.extendSubschemaMode = extendSubschemaMode;
var resolve$2 = {};
var fastDeepEqual = function equal(a, b) {
  if (a === b) return true;
  if (a && b && typeof a == "object" && typeof b == "object") {
    if (a.constructor !== b.constructor) return false;
    var length, i, keys2;
    if (Array.isArray(a)) {
      length = a.length;
      if (length != b.length) return false;
      for (i = length; i-- !== 0; )
        if (!equal(a[i], b[i])) return false;
      return true;
    }
    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
    keys2 = Object.keys(a);
    length = keys2.length;
    if (length !== Object.keys(b).length) return false;
    for (i = length; i-- !== 0; )
      if (!Object.prototype.hasOwnProperty.call(b, keys2[i])) return false;
    for (i = length; i-- !== 0; ) {
      var key = keys2[i];
      if (!equal(a[key], b[key])) return false;
    }
    return true;
  }
  return a !== a && b !== b;
};
var jsonSchemaTraverse = { exports: {} };
var traverse$1 = jsonSchemaTraverse.exports = function(schema, opts, cb) {
  if (typeof opts == "function") {
    cb = opts;
    opts = {};
  }
  cb = opts.cb || cb;
  var pre = typeof cb == "function" ? cb : cb.pre || function() {
  };
  var post = cb.post || function() {
  };
  _traverse(opts, pre, post, schema, "", schema);
};
traverse$1.keywords = {
  additionalItems: true,
  items: true,
  contains: true,
  additionalProperties: true,
  propertyNames: true,
  not: true,
  if: true,
  then: true,
  else: true
};
traverse$1.arrayKeywords = {
  items: true,
  allOf: true,
  anyOf: true,
  oneOf: true
};
traverse$1.propsKeywords = {
  $defs: true,
  definitions: true,
  properties: true,
  patternProperties: true,
  dependencies: true
};
traverse$1.skipKeywords = {
  default: true,
  enum: true,
  const: true,
  required: true,
  maximum: true,
  minimum: true,
  exclusiveMaximum: true,
  exclusiveMinimum: true,
  multipleOf: true,
  maxLength: true,
  minLength: true,
  pattern: true,
  format: true,
  maxItems: true,
  minItems: true,
  uniqueItems: true,
  maxProperties: true,
  minProperties: true
};
function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
  if (schema && typeof schema == "object" && !Array.isArray(schema)) {
    pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
    for (var key in schema) {
      var sch = schema[key];
      if (Array.isArray(sch)) {
        if (key in traverse$1.arrayKeywords) {
          for (var i = 0; i < sch.length; i++)
            _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
        }
      } else if (key in traverse$1.propsKeywords) {
        if (sch && typeof sch == "object") {
          for (var prop in sch)
            _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
        }
      } else if (key in traverse$1.keywords || opts.allKeys && !(key in traverse$1.skipKeywords)) {
        _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
      }
    }
    post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
  }
}
function escapeJsonPtr(str) {
  return str.replace(/~/g, "~0").replace(/\//g, "~1");
}
var jsonSchemaTraverseExports = jsonSchemaTraverse.exports;
Object.defineProperty(resolve$2, "__esModule", { value: true });
resolve$2.getSchemaRefs = resolve$2.resolveUrl = resolve$2.normalizeId = resolve$2._getFullPath = resolve$2.getFullPath = resolve$2.inlineRef = void 0;
const util_1$q = util$1;
const equal$3 = fastDeepEqual;
const traverse = jsonSchemaTraverseExports;
const SIMPLE_INLINED = /* @__PURE__ */ new Set([
  "type",
  "format",
  "pattern",
  "maxLength",
  "minLength",
  "maxProperties",
  "minProperties",
  "maxItems",
  "minItems",
  "maximum",
  "minimum",
  "uniqueItems",
  "multipleOf",
  "required",
  "enum",
  "const"
]);
function inlineRef(schema, limit2 = true) {
  if (typeof schema == "boolean")
    return true;
  if (limit2 === true)
    return !hasRef(schema);
  if (!limit2)
    return false;
  return countKeys(schema) <= limit2;
}
resolve$2.inlineRef = inlineRef;
const REF_KEYWORDS = /* @__PURE__ */ new Set([
  "$ref",
  "$recursiveRef",
  "$recursiveAnchor",
  "$dynamicRef",
  "$dynamicAnchor"
]);
function hasRef(schema) {
  for (const key in schema) {
    if (REF_KEYWORDS.has(key))
      return true;
    const sch = schema[key];
    if (Array.isArray(sch) && sch.some(hasRef))
      return true;
    if (typeof sch == "object" && hasRef(sch))
      return true;
  }
  return false;
}
function countKeys(schema) {
  let count = 0;
  for (const key in schema) {
    if (key === "$ref")
      return Infinity;
    count++;
    if (SIMPLE_INLINED.has(key))
      continue;
    if (typeof schema[key] == "object") {
      (0, util_1$q.eachItem)(schema[key], (sch) => count += countKeys(sch));
    }
    if (count === Infinity)
      return Infinity;
  }
  return count;
}
function getFullPath(resolver, id2 = "", normalize2) {
  if (normalize2 !== false)
    id2 = normalizeId(id2);
  const p = resolver.parse(id2);
  return _getFullPath(resolver, p);
}
resolve$2.getFullPath = getFullPath;
function _getFullPath(resolver, p) {
  const serialized = resolver.serialize(p);
  return serialized.split("#")[0] + "#";
}
resolve$2._getFullPath = _getFullPath;
const TRAILING_SLASH_HASH = /#\/?$/;
function normalizeId(id2) {
  return id2 ? id2.replace(TRAILING_SLASH_HASH, "") : "";
}
resolve$2.normalizeId = normalizeId;
function resolveUrl(resolver, baseId, id2) {
  id2 = normalizeId(id2);
  return resolver.resolve(baseId, id2);
}
resolve$2.resolveUrl = resolveUrl;
const ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
function getSchemaRefs(schema, baseId) {
  if (typeof schema == "boolean")
    return {};
  const { schemaId, uriResolver } = this.opts;
  const schId = normalizeId(schema[schemaId] || baseId);
  const baseIds = { "": schId };
  const pathPrefix = getFullPath(uriResolver, schId, false);
  const localRefs = {};
  const schemaRefs = /* @__PURE__ */ new Set();
  traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
    if (parentJsonPtr === void 0)
      return;
    const fullPath = pathPrefix + jsonPtr;
    let innerBaseId = baseIds[parentJsonPtr];
    if (typeof sch[schemaId] == "string")
      innerBaseId = addRef.call(this, sch[schemaId]);
    addAnchor.call(this, sch.$anchor);
    addAnchor.call(this, sch.$dynamicAnchor);
    baseIds[jsonPtr] = innerBaseId;
    function addRef(ref2) {
      const _resolve = this.opts.uriResolver.resolve;
      ref2 = normalizeId(innerBaseId ? _resolve(innerBaseId, ref2) : ref2);
      if (schemaRefs.has(ref2))
        throw ambiguos(ref2);
      schemaRefs.add(ref2);
      let schOrRef = this.refs[ref2];
      if (typeof schOrRef == "string")
        schOrRef = this.refs[schOrRef];
      if (typeof schOrRef == "object") {
        checkAmbiguosRef(sch, schOrRef.schema, ref2);
      } else if (ref2 !== normalizeId(fullPath)) {
        if (ref2[0] === "#") {
          checkAmbiguosRef(sch, localRefs[ref2], ref2);
          localRefs[ref2] = sch;
        } else {
          this.refs[ref2] = fullPath;
        }
      }
      return ref2;
    }
    function addAnchor(anchor) {
      if (typeof anchor == "string") {
        if (!ANCHOR.test(anchor))
          throw new Error(`invalid anchor "${anchor}"`);
        addRef.call(this, `#${anchor}`);
      }
    }
  });
  return localRefs;
  function checkAmbiguosRef(sch1, sch2, ref2) {
    if (sch2 !== void 0 && !equal$3(sch1, sch2))
      throw ambiguos(ref2);
  }
  function ambiguos(ref2) {
    return new Error(`reference "${ref2}" resolves to more than one schema`);
  }
}
resolve$2.getSchemaRefs = getSchemaRefs;
Object.defineProperty(validate, "__esModule", { value: true });
validate.getData = validate.KeywordCxt = validate.validateFunctionCode = void 0;
const boolSchema_1 = boolSchema;
const dataType_1$1 = dataType;
const applicability_1 = applicability;
const dataType_2 = dataType;
const defaults_1 = defaults;
const keyword_1 = keyword;
const subschema_1 = subschema;
const codegen_1$r = codegen;
const names_1$6 = names$1;
const resolve_1$2 = resolve$2;
const util_1$p = util$1;
const errors_1 = errors;
function validateFunctionCode(it) {
  if (isSchemaObj(it)) {
    checkKeywords(it);
    if (schemaCxtHasRules(it)) {
      topSchemaObjCode(it);
      return;
    }
  }
  validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
}
validate.validateFunctionCode = validateFunctionCode;
function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
  if (opts.code.es5) {
    gen.func(validateName, (0, codegen_1$r._)`${names_1$6.default.data}, ${names_1$6.default.valCxt}`, schemaEnv.$async, () => {
      gen.code((0, codegen_1$r._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
      destructureValCxtES5(gen, opts);
      gen.code(body);
    });
  } else {
    gen.func(validateName, (0, codegen_1$r._)`${names_1$6.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
  }
}
function destructureValCxt(opts) {
  return (0, codegen_1$r._)`{${names_1$6.default.instancePath}="", ${names_1$6.default.parentData}, ${names_1$6.default.parentDataProperty}, ${names_1$6.default.rootData}=${names_1$6.default.data}${opts.dynamicRef ? (0, codegen_1$r._)`, ${names_1$6.default.dynamicAnchors}={}` : codegen_1$r.nil}}={}`;
}
function destructureValCxtES5(gen, opts) {
  gen.if(names_1$6.default.valCxt, () => {
    gen.var(names_1$6.default.instancePath, (0, codegen_1$r._)`${names_1$6.default.valCxt}.${names_1$6.default.instancePath}`);
    gen.var(names_1$6.default.parentData, (0, codegen_1$r._)`${names_1$6.default.valCxt}.${names_1$6.default.parentData}`);
    gen.var(names_1$6.default.parentDataProperty, (0, codegen_1$r._)`${names_1$6.default.valCxt}.${names_1$6.default.parentDataProperty}`);
    gen.var(names_1$6.default.rootData, (0, codegen_1$r._)`${names_1$6.default.valCxt}.${names_1$6.default.rootData}`);
    if (opts.dynamicRef)
      gen.var(names_1$6.default.dynamicAnchors, (0, codegen_1$r._)`${names_1$6.default.valCxt}.${names_1$6.default.dynamicAnchors}`);
  }, () => {
    gen.var(names_1$6.default.instancePath, (0, codegen_1$r._)`""`);
    gen.var(names_1$6.default.parentData, (0, codegen_1$r._)`undefined`);
    gen.var(names_1$6.default.parentDataProperty, (0, codegen_1$r._)`undefined`);
    gen.var(names_1$6.default.rootData, names_1$6.default.data);
    if (opts.dynamicRef)
      gen.var(names_1$6.default.dynamicAnchors, (0, codegen_1$r._)`{}`);
  });
}
function topSchemaObjCode(it) {
  const { schema, opts, gen } = it;
  validateFunction(it, () => {
    if (opts.$comment && schema.$comment)
      commentKeyword(it);
    checkNoDefault(it);
    gen.let(names_1$6.default.vErrors, null);
    gen.let(names_1$6.default.errors, 0);
    if (opts.unevaluated)
      resetEvaluated(it);
    typeAndKeywords(it);
    returnResults(it);
  });
  return;
}
function resetEvaluated(it) {
  const { gen, validateName } = it;
  it.evaluated = gen.const("evaluated", (0, codegen_1$r._)`${validateName}.evaluated`);
  gen.if((0, codegen_1$r._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1$r._)`${it.evaluated}.props`, (0, codegen_1$r._)`undefined`));
  gen.if((0, codegen_1$r._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1$r._)`${it.evaluated}.items`, (0, codegen_1$r._)`undefined`));
}
function funcSourceUrl(schema, opts) {
  const schId = typeof schema == "object" && schema[opts.schemaId];
  return schId && (opts.code.source || opts.code.process) ? (0, codegen_1$r._)`/*# sourceURL=${schId} */` : codegen_1$r.nil;
}
function subschemaCode(it, valid2) {
  if (isSchemaObj(it)) {
    checkKeywords(it);
    if (schemaCxtHasRules(it)) {
      subSchemaObjCode(it, valid2);
      return;
    }
  }
  (0, boolSchema_1.boolOrEmptySchema)(it, valid2);
}
function schemaCxtHasRules({ schema, self: self2 }) {
  if (typeof schema == "boolean")
    return !schema;
  for (const key in schema)
    if (self2.RULES.all[key])
      return true;
  return false;
}
function isSchemaObj(it) {
  return typeof it.schema != "boolean";
}
function subSchemaObjCode(it, valid2) {
  const { schema, gen, opts } = it;
  if (opts.$comment && schema.$comment)
    commentKeyword(it);
  updateContext(it);
  checkAsyncSchema(it);
  const errsCount = gen.const("_errs", names_1$6.default.errors);
  typeAndKeywords(it, errsCount);
  gen.var(valid2, (0, codegen_1$r._)`${errsCount} === ${names_1$6.default.errors}`);
}
function checkKeywords(it) {
  (0, util_1$p.checkUnknownRules)(it);
  checkRefsAndKeywords(it);
}
function typeAndKeywords(it, errsCount) {
  if (it.opts.jtd)
    return schemaKeywords(it, [], false, errsCount);
  const types2 = (0, dataType_1$1.getSchemaTypes)(it.schema);
  const checkedTypes = (0, dataType_1$1.coerceAndCheckDataType)(it, types2);
  schemaKeywords(it, types2, !checkedTypes, errsCount);
}
function checkRefsAndKeywords(it) {
  const { schema, errSchemaPath, opts, self: self2 } = it;
  if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1$p.schemaHasRulesButRef)(schema, self2.RULES)) {
    self2.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
  }
}
function checkNoDefault(it) {
  const { schema, opts } = it;
  if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema) {
    (0, util_1$p.checkStrictMode)(it, "default is ignored in the schema root");
  }
}
function updateContext(it) {
  const schId = it.schema[it.opts.schemaId];
  if (schId)
    it.baseId = (0, resolve_1$2.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
}
function checkAsyncSchema(it) {
  if (it.schema.$async && !it.schemaEnv.$async)
    throw new Error("async schema in sync schema");
}
function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
  const msg = schema.$comment;
  if (opts.$comment === true) {
    gen.code((0, codegen_1$r._)`${names_1$6.default.self}.logger.log(${msg})`);
  } else if (typeof opts.$comment == "function") {
    const schemaPath = (0, codegen_1$r.str)`${errSchemaPath}/$comment`;
    const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
    gen.code((0, codegen_1$r._)`${names_1$6.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
  }
}
function returnResults(it) {
  const { gen, schemaEnv, validateName, ValidationError: ValidationError2, opts } = it;
  if (schemaEnv.$async) {
    gen.if((0, codegen_1$r._)`${names_1$6.default.errors} === 0`, () => gen.return(names_1$6.default.data), () => gen.throw((0, codegen_1$r._)`new ${ValidationError2}(${names_1$6.default.vErrors})`));
  } else {
    gen.assign((0, codegen_1$r._)`${validateName}.errors`, names_1$6.default.vErrors);
    if (opts.unevaluated)
      assignEvaluated(it);
    gen.return((0, codegen_1$r._)`${names_1$6.default.errors} === 0`);
  }
}
function assignEvaluated({ gen, evaluated, props, items: items2 }) {
  if (props instanceof codegen_1$r.Name)
    gen.assign((0, codegen_1$r._)`${evaluated}.props`, props);
  if (items2 instanceof codegen_1$r.Name)
    gen.assign((0, codegen_1$r._)`${evaluated}.items`, items2);
}
function schemaKeywords(it, types2, typeErrors, errsCount) {
  const { gen, schema, data, allErrors, opts, self: self2 } = it;
  const { RULES } = self2;
  if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1$p.schemaHasRulesButRef)(schema, RULES))) {
    gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
    return;
  }
  if (!opts.jtd)
    checkStrictTypes(it, types2);
  gen.block(() => {
    for (const group of RULES.rules)
      groupKeywords(group);
    groupKeywords(RULES.post);
  });
  function groupKeywords(group) {
    if (!(0, applicability_1.shouldUseGroup)(schema, group))
      return;
    if (group.type) {
      gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
      iterateKeywords(it, group);
      if (types2.length === 1 && types2[0] === group.type && typeErrors) {
        gen.else();
        (0, dataType_2.reportTypeError)(it);
      }
      gen.endIf();
    } else {
      iterateKeywords(it, group);
    }
    if (!allErrors)
      gen.if((0, codegen_1$r._)`${names_1$6.default.errors} === ${errsCount || 0}`);
  }
}
function iterateKeywords(it, group) {
  const { gen, schema, opts: { useDefaults } } = it;
  if (useDefaults)
    (0, defaults_1.assignDefaults)(it, group.type);
  gen.block(() => {
    for (const rule of group.rules) {
      if ((0, applicability_1.shouldUseRule)(schema, rule)) {
        keywordCode(it, rule.keyword, rule.definition, group.type);
      }
    }
  });
}
function checkStrictTypes(it, types2) {
  if (it.schemaEnv.meta || !it.opts.strictTypes)
    return;
  checkContextTypes(it, types2);
  if (!it.opts.allowUnionTypes)
    checkMultipleTypes(it, types2);
  checkKeywordTypes(it, it.dataTypes);
}
function checkContextTypes(it, types2) {
  if (!types2.length)
    return;
  if (!it.dataTypes.length) {
    it.dataTypes = types2;
    return;
  }
  types2.forEach((t2) => {
    if (!includesType(it.dataTypes, t2)) {
      strictTypesError(it, `type "${t2}" not allowed by context "${it.dataTypes.join(",")}"`);
    }
  });
  narrowSchemaTypes(it, types2);
}
function checkMultipleTypes(it, ts) {
  if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
    strictTypesError(it, "use allowUnionTypes to allow union type keyword");
  }
}
function checkKeywordTypes(it, ts) {
  const rules2 = it.self.RULES.all;
  for (const keyword2 in rules2) {
    const rule = rules2[keyword2];
    if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
      const { type: type2 } = rule.definition;
      if (type2.length && !type2.some((t2) => hasApplicableType(ts, t2))) {
        strictTypesError(it, `missing type "${type2.join(",")}" for keyword "${keyword2}"`);
      }
    }
  }
}
function hasApplicableType(schTs, kwdT) {
  return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
}
function includesType(ts, t2) {
  return ts.includes(t2) || t2 === "integer" && ts.includes("number");
}
function narrowSchemaTypes(it, withTypes) {
  const ts = [];
  for (const t2 of it.dataTypes) {
    if (includesType(withTypes, t2))
      ts.push(t2);
    else if (withTypes.includes("integer") && t2 === "number")
      ts.push("integer");
  }
  it.dataTypes = ts;
}
function strictTypesError(it, msg) {
  const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
  msg += ` at "${schemaPath}" (strictTypes)`;
  (0, util_1$p.checkStrictMode)(it, msg, it.opts.strictTypes);
}
class KeywordCxt {
  constructor(it, def2, keyword2) {
    (0, keyword_1.validateKeywordUsage)(it, def2, keyword2);
    this.gen = it.gen;
    this.allErrors = it.allErrors;
    this.keyword = keyword2;
    this.data = it.data;
    this.schema = it.schema[keyword2];
    this.$data = def2.$data && it.opts.$data && this.schema && this.schema.$data;
    this.schemaValue = (0, util_1$p.schemaRefOrVal)(it, this.schema, keyword2, this.$data);
    this.schemaType = def2.schemaType;
    this.parentSchema = it.schema;
    this.params = {};
    this.it = it;
    this.def = def2;
    if (this.$data) {
      this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
    } else {
      this.schemaCode = this.schemaValue;
      if (!(0, keyword_1.validSchemaType)(this.schema, def2.schemaType, def2.allowUndefined)) {
        throw new Error(`${keyword2} value must be ${JSON.stringify(def2.schemaType)}`);
      }
    }
    if ("code" in def2 ? def2.trackErrors : def2.errors !== false) {
      this.errsCount = it.gen.const("_errs", names_1$6.default.errors);
    }
  }
  result(condition, successAction, failAction) {
    this.failResult((0, codegen_1$r.not)(condition), successAction, failAction);
  }
  failResult(condition, successAction, failAction) {
    this.gen.if(condition);
    if (failAction)
      failAction();
    else
      this.error();
    if (successAction) {
      this.gen.else();
      successAction();
      if (this.allErrors)
        this.gen.endIf();
    } else {
      if (this.allErrors)
        this.gen.endIf();
      else
        this.gen.else();
    }
  }
  pass(condition, failAction) {
    this.failResult((0, codegen_1$r.not)(condition), void 0, failAction);
  }
  fail(condition) {
    if (condition === void 0) {
      this.error();
      if (!this.allErrors)
        this.gen.if(false);
      return;
    }
    this.gen.if(condition);
    this.error();
    if (this.allErrors)
      this.gen.endIf();
    else
      this.gen.else();
  }
  fail$data(condition) {
    if (!this.$data)
      return this.fail(condition);
    const { schemaCode } = this;
    this.fail((0, codegen_1$r._)`${schemaCode} !== undefined && (${(0, codegen_1$r.or)(this.invalid$data(), condition)})`);
  }
  error(append2, errorParams, errorPaths) {
    if (errorParams) {
      this.setParams(errorParams);
      this._error(append2, errorPaths);
      this.setParams({});
      return;
    }
    this._error(append2, errorPaths);
  }
  _error(append2, errorPaths) {
    (append2 ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
  }
  $dataError() {
    (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
  }
  reset() {
    if (this.errsCount === void 0)
      throw new Error('add "trackErrors" to keyword definition');
    (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
  }
  ok(cond) {
    if (!this.allErrors)
      this.gen.if(cond);
  }
  setParams(obj, assign) {
    if (assign)
      Object.assign(this.params, obj);
    else
      this.params = obj;
  }
  block$data(valid2, codeBlock, $dataValid = codegen_1$r.nil) {
    this.gen.block(() => {
      this.check$data(valid2, $dataValid);
      codeBlock();
    });
  }
  check$data(valid2 = codegen_1$r.nil, $dataValid = codegen_1$r.nil) {
    if (!this.$data)
      return;
    const { gen, schemaCode, schemaType, def: def2 } = this;
    gen.if((0, codegen_1$r.or)((0, codegen_1$r._)`${schemaCode} === undefined`, $dataValid));
    if (valid2 !== codegen_1$r.nil)
      gen.assign(valid2, true);
    if (schemaType.length || def2.validateSchema) {
      gen.elseIf(this.invalid$data());
      this.$dataError();
      if (valid2 !== codegen_1$r.nil)
        gen.assign(valid2, false);
    }
    gen.else();
  }
  invalid$data() {
    const { gen, schemaCode, schemaType, def: def2, it } = this;
    return (0, codegen_1$r.or)(wrong$DataType(), invalid$DataSchema());
    function wrong$DataType() {
      if (schemaType.length) {
        if (!(schemaCode instanceof codegen_1$r.Name))
          throw new Error("ajv implementation error");
        const st = Array.isArray(schemaType) ? schemaType : [schemaType];
        return (0, codegen_1$r._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
      }
      return codegen_1$r.nil;
    }
    function invalid$DataSchema() {
      if (def2.validateSchema) {
        const validateSchemaRef = gen.scopeValue("validate$data", { ref: def2.validateSchema });
        return (0, codegen_1$r._)`!${validateSchemaRef}(${schemaCode})`;
      }
      return codegen_1$r.nil;
    }
  }
  subschema(appl, valid2) {
    const subschema2 = (0, subschema_1.getSubschema)(this.it, appl);
    (0, subschema_1.extendSubschemaData)(subschema2, this.it, appl);
    (0, subschema_1.extendSubschemaMode)(subschema2, appl);
    const nextContext = { ...this.it, ...subschema2, items: void 0, props: void 0 };
    subschemaCode(nextContext, valid2);
    return nextContext;
  }
  mergeEvaluated(schemaCxt, toName) {
    const { it, gen } = this;
    if (!it.opts.unevaluated)
      return;
    if (it.props !== true && schemaCxt.props !== void 0) {
      it.props = util_1$p.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
    }
    if (it.items !== true && schemaCxt.items !== void 0) {
      it.items = util_1$p.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
    }
  }
  mergeValidEvaluated(schemaCxt, valid2) {
    const { it, gen } = this;
    if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
      gen.if(valid2, () => this.mergeEvaluated(schemaCxt, codegen_1$r.Name));
      return true;
    }
  }
}
validate.KeywordCxt = KeywordCxt;
function keywordCode(it, keyword2, def2, ruleType) {
  const cxt = new KeywordCxt(it, def2, keyword2);
  if ("code" in def2) {
    def2.code(cxt, ruleType);
  } else if (cxt.$data && def2.validate) {
    (0, keyword_1.funcKeywordCode)(cxt, def2);
  } else if ("macro" in def2) {
    (0, keyword_1.macroKeywordCode)(cxt, def2);
  } else if (def2.compile || def2.validate) {
    (0, keyword_1.funcKeywordCode)(cxt, def2);
  }
}
const JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
const RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
function getData($data, { dataLevel, dataNames, dataPathArr }) {
  let jsonPointer;
  let data;
  if ($data === "")
    return names_1$6.default.rootData;
  if ($data[0] === "/") {
    if (!JSON_POINTER.test($data))
      throw new Error(`Invalid JSON-pointer: ${$data}`);
    jsonPointer = $data;
    data = names_1$6.default.rootData;
  } else {
    const matches = RELATIVE_JSON_POINTER.exec($data);
    if (!matches)
      throw new Error(`Invalid JSON-pointer: ${$data}`);
    const up = +matches[1];
    jsonPointer = matches[2];
    if (jsonPointer === "#") {
      if (up >= dataLevel)
        throw new Error(errorMsg("property/index", up));
      return dataPathArr[dataLevel - up];
    }
    if (up > dataLevel)
      throw new Error(errorMsg("data", up));
    data = dataNames[dataLevel - up];
    if (!jsonPointer)
      return data;
  }
  let expr = data;
  const segments = jsonPointer.split("/");
  for (const segment of segments) {
    if (segment) {
      data = (0, codegen_1$r._)`${data}${(0, codegen_1$r.getProperty)((0, util_1$p.unescapeJsonPointer)(segment))}`;
      expr = (0, codegen_1$r._)`${expr} && ${data}`;
    }
  }
  return expr;
  function errorMsg(pointerType, up) {
    return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
  }
}
validate.getData = getData;
var validation_error = {};
Object.defineProperty(validation_error, "__esModule", { value: true });
class ValidationError extends Error {
  constructor(errors2) {
    super("validation failed");
    this.errors = errors2;
    this.ajv = this.validation = true;
  }
}
validation_error.default = ValidationError;
var ref_error = {};
Object.defineProperty(ref_error, "__esModule", { value: true });
const resolve_1$1 = resolve$2;
class MissingRefError extends Error {
  constructor(resolver, baseId, ref2, msg) {
    super(msg || `can't resolve reference ${ref2} from id ${baseId}`);
    this.missingRef = (0, resolve_1$1.resolveUrl)(resolver, baseId, ref2);
    this.missingSchema = (0, resolve_1$1.normalizeId)((0, resolve_1$1.getFullPath)(resolver, this.missingRef));
  }
}
ref_error.default = MissingRefError;
var compile = {};
Object.defineProperty(compile, "__esModule", { value: true });
compile.resolveSchema = compile.getCompilingSchema = compile.resolveRef = compile.compileSchema = compile.SchemaEnv = void 0;
const codegen_1$q = codegen;
const validation_error_1 = validation_error;
const names_1$5 = names$1;
const resolve_1 = resolve$2;
const util_1$o = util$1;
const validate_1$1 = validate;
class SchemaEnv {
  constructor(env2) {
    var _a;
    this.refs = {};
    this.dynamicAnchors = {};
    let schema;
    if (typeof env2.schema == "object")
      schema = env2.schema;
    this.schema = env2.schema;
    this.schemaId = env2.schemaId;
    this.root = env2.root || this;
    this.baseId = (_a = env2.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env2.schemaId || "$id"]);
    this.schemaPath = env2.schemaPath;
    this.localRefs = env2.localRefs;
    this.meta = env2.meta;
    this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
    this.refs = {};
  }
}
compile.SchemaEnv = SchemaEnv;
function compileSchema(sch) {
  const _sch = getCompilingSchema.call(this, sch);
  if (_sch)
    return _sch;
  const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
  const { es5, lines } = this.opts.code;
  const { ownProperties } = this.opts;
  const gen = new codegen_1$q.CodeGen(this.scope, { es5, lines, ownProperties });
  let _ValidationError;
  if (sch.$async) {
    _ValidationError = gen.scopeValue("Error", {
      ref: validation_error_1.default,
      code: (0, codegen_1$q._)`require("ajv/dist/runtime/validation_error").default`
    });
  }
  const validateName = gen.scopeName("validate");
  sch.validateName = validateName;
  const schemaCxt = {
    gen,
    allErrors: this.opts.allErrors,
    data: names_1$5.default.data,
    parentData: names_1$5.default.parentData,
    parentDataProperty: names_1$5.default.parentDataProperty,
    dataNames: [names_1$5.default.data],
    dataPathArr: [codegen_1$q.nil],
    // TODO can its length be used as dataLevel if nil is removed?
    dataLevel: 0,
    dataTypes: [],
    definedProperties: /* @__PURE__ */ new Set(),
    topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1$q.stringify)(sch.schema) } : { ref: sch.schema }),
    validateName,
    ValidationError: _ValidationError,
    schema: sch.schema,
    schemaEnv: sch,
    rootId,
    baseId: sch.baseId || rootId,
    schemaPath: codegen_1$q.nil,
    errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
    errorPath: (0, codegen_1$q._)`""`,
    opts: this.opts,
    self: this
  };
  let sourceCode;
  try {
    this._compilations.add(sch);
    (0, validate_1$1.validateFunctionCode)(schemaCxt);
    gen.optimize(this.opts.code.optimize);
    const validateCode = gen.toString();
    sourceCode = `${gen.scopeRefs(names_1$5.default.scope)}return ${validateCode}`;
    if (this.opts.code.process)
      sourceCode = this.opts.code.process(sourceCode, sch);
    const makeValidate = new Function(`${names_1$5.default.self}`, `${names_1$5.default.scope}`, sourceCode);
    const validate2 = makeValidate(this, this.scope.get());
    this.scope.value(validateName, { ref: validate2 });
    validate2.errors = null;
    validate2.schema = sch.schema;
    validate2.schemaEnv = sch;
    if (sch.$async)
      validate2.$async = true;
    if (this.opts.code.source === true) {
      validate2.source = { validateName, validateCode, scopeValues: gen._values };
    }
    if (this.opts.unevaluated) {
      const { props, items: items2 } = schemaCxt;
      validate2.evaluated = {
        props: props instanceof codegen_1$q.Name ? void 0 : props,
        items: items2 instanceof codegen_1$q.Name ? void 0 : items2,
        dynamicProps: props instanceof codegen_1$q.Name,
        dynamicItems: items2 instanceof codegen_1$q.Name
      };
      if (validate2.source)
        validate2.source.evaluated = (0, codegen_1$q.stringify)(validate2.evaluated);
    }
    sch.validate = validate2;
    return sch;
  } catch (e) {
    delete sch.validate;
    delete sch.validateName;
    if (sourceCode)
      this.logger.error("Error compiling schema, function code:", sourceCode);
    throw e;
  } finally {
    this._compilations.delete(sch);
  }
}
compile.compileSchema = compileSchema;
function resolveRef(root, baseId, ref2) {
  var _a;
  ref2 = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref2);
  const schOrFunc = root.refs[ref2];
  if (schOrFunc)
    return schOrFunc;
  let _sch = resolve$1.call(this, root, ref2);
  if (_sch === void 0) {
    const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref2];
    const { schemaId } = this.opts;
    if (schema)
      _sch = new SchemaEnv({ schema, schemaId, root, baseId });
  }
  if (_sch === void 0)
    return;
  return root.refs[ref2] = inlineOrCompile.call(this, _sch);
}
compile.resolveRef = resolveRef;
function inlineOrCompile(sch) {
  if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
    return sch.schema;
  return sch.validate ? sch : compileSchema.call(this, sch);
}
function getCompilingSchema(schEnv) {
  for (const sch of this._compilations) {
    if (sameSchemaEnv(sch, schEnv))
      return sch;
  }
}
compile.getCompilingSchema = getCompilingSchema;
function sameSchemaEnv(s1, s2) {
  return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
}
function resolve$1(root, ref2) {
  let sch;
  while (typeof (sch = this.refs[ref2]) == "string")
    ref2 = sch;
  return sch || this.schemas[ref2] || resolveSchema.call(this, root, ref2);
}
function resolveSchema(root, ref2) {
  const p = this.opts.uriResolver.parse(ref2);
  const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
  let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, void 0);
  if (Object.keys(root.schema).length > 0 && refPath === baseId) {
    return getJsonPointer.call(this, p, root);
  }
  const id2 = (0, resolve_1.normalizeId)(refPath);
  const schOrRef = this.refs[id2] || this.schemas[id2];
  if (typeof schOrRef == "string") {
    const sch = resolveSchema.call(this, root, schOrRef);
    if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
      return;
    return getJsonPointer.call(this, p, sch);
  }
  if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
    return;
  if (!schOrRef.validate)
    compileSchema.call(this, schOrRef);
  if (id2 === (0, resolve_1.normalizeId)(ref2)) {
    const { schema } = schOrRef;
    const { schemaId } = this.opts;
    const schId = schema[schemaId];
    if (schId)
      baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
    return new SchemaEnv({ schema, schemaId, root, baseId });
  }
  return getJsonPointer.call(this, p, schOrRef);
}
compile.resolveSchema = resolveSchema;
const PREVENT_SCOPE_CHANGE = /* @__PURE__ */ new Set([
  "properties",
  "patternProperties",
  "enum",
  "dependencies",
  "definitions"
]);
function getJsonPointer(parsedRef, { baseId, schema, root }) {
  var _a;
  if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
    return;
  for (const part of parsedRef.fragment.slice(1).split("/")) {
    if (typeof schema === "boolean")
      return;
    const partSchema = schema[(0, util_1$o.unescapeFragment)(part)];
    if (partSchema === void 0)
      return;
    schema = partSchema;
    const schId = typeof schema === "object" && schema[this.opts.schemaId];
    if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
      baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
    }
  }
  let env2;
  if (typeof schema != "boolean" && schema.$ref && !(0, util_1$o.schemaHasRulesButRef)(schema, this.RULES)) {
    const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
    env2 = resolveSchema.call(this, root, $ref);
  }
  const { schemaId } = this.opts;
  env2 = env2 || new SchemaEnv({ schema, schemaId, root, baseId });
  if (env2.schema !== env2.root.schema)
    return env2;
  return void 0;
}
const $id$9 = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#";
const description = "Meta-schema for $data reference (JSON AnySchema extension proposal)";
const type$9 = "object";
const required$1 = [
  "$data"
];
const properties$a = {
  $data: {
    type: "string",
    anyOf: [
      {
        format: "relative-json-pointer"
      },
      {
        format: "json-pointer"
      }
    ]
  }
};
const additionalProperties$1 = false;
const require$$9 = {
  $id: $id$9,
  description,
  type: type$9,
  required: required$1,
  properties: properties$a,
  additionalProperties: additionalProperties$1
};
var uri$1 = {};
var fastUri$1 = { exports: {} };
const isUUID$1 = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
const isIPv4$1 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
function stringArrayToHexStripped(input) {
  let acc = "";
  let code2 = 0;
  let i = 0;
  for (i = 0; i < input.length; i++) {
    code2 = input[i].charCodeAt(0);
    if (code2 === 48) {
      continue;
    }
    if (!(code2 >= 48 && code2 <= 57 || code2 >= 65 && code2 <= 70 || code2 >= 97 && code2 <= 102)) {
      return "";
    }
    acc += input[i];
    break;
  }
  for (i += 1; i < input.length; i++) {
    code2 = input[i].charCodeAt(0);
    if (!(code2 >= 48 && code2 <= 57 || code2 >= 65 && code2 <= 70 || code2 >= 97 && code2 <= 102)) {
      return "";
    }
    acc += input[i];
  }
  return acc;
}
const nonSimpleDomain$1 = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
function consumeIsZone(buffer) {
  buffer.length = 0;
  return true;
}
function consumeHextets(buffer, address, output) {
  if (buffer.length) {
    const hex = stringArrayToHexStripped(buffer);
    if (hex !== "") {
      address.push(hex);
    } else {
      output.error = true;
      return false;
    }
    buffer.length = 0;
  }
  return true;
}
function getIPV6(input) {
  let tokenCount = 0;
  const output = { error: false, address: "", zone: "" };
  const address = [];
  const buffer = [];
  let endipv6Encountered = false;
  let endIpv6 = false;
  let consume = consumeHextets;
  for (let i = 0; i < input.length; i++) {
    const cursor2 = input[i];
    if (cursor2 === "[" || cursor2 === "]") {
      continue;
    }
    if (cursor2 === ":") {
      if (endipv6Encountered === true) {
        endIpv6 = true;
      }
      if (!consume(buffer, address, output)) {
        break;
      }
      if (++tokenCount > 7) {
        output.error = true;
        break;
      }
      if (i > 0 && input[i - 1] === ":") {
        endipv6Encountered = true;
      }
      address.push(":");
      continue;
    } else if (cursor2 === "%") {
      if (!consume(buffer, address, output)) {
        break;
      }
      consume = consumeIsZone;
    } else {
      buffer.push(cursor2);
      continue;
    }
  }
  if (buffer.length) {
    if (consume === consumeIsZone) {
      output.zone = buffer.join("");
    } else if (endIpv6) {
      address.push(buffer.join(""));
    } else {
      address.push(stringArrayToHexStripped(buffer));
    }
  }
  output.address = address.join("");
  return output;
}
function normalizeIPv6$1(host) {
  if (findToken(host, ":") < 2) {
    return { host, isIPV6: false };
  }
  const ipv6 = getIPV6(host);
  if (!ipv6.error) {
    let newHost = ipv6.address;
    let escapedHost = ipv6.address;
    if (ipv6.zone) {
      newHost += "%" + ipv6.zone;
      escapedHost += "%25" + ipv6.zone;
    }
    return { host: newHost, isIPV6: true, escapedHost };
  } else {
    return { host, isIPV6: false };
  }
}
function findToken(str, token) {
  let ind = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === token) ind++;
  }
  return ind;
}
function removeDotSegments$1(path2) {
  let input = path2;
  const output = [];
  let nextSlash = -1;
  let len = 0;
  while (len = input.length) {
    if (len === 1) {
      if (input === ".") {
        break;
      } else if (input === "/") {
        output.push("/");
        break;
      } else {
        output.push(input);
        break;
      }
    } else if (len === 2) {
      if (input[0] === ".") {
        if (input[1] === ".") {
          break;
        } else if (input[1] === "/") {
          input = input.slice(2);
          continue;
        }
      } else if (input[0] === "/") {
        if (input[1] === "." || input[1] === "/") {
          output.push("/");
          break;
        }
      }
    } else if (len === 3) {
      if (input === "/..") {
        if (output.length !== 0) {
          output.pop();
        }
        output.push("/");
        break;
      }
    }
    if (input[0] === ".") {
      if (input[1] === ".") {
        if (input[2] === "/") {
          input = input.slice(3);
          continue;
        }
      } else if (input[1] === "/") {
        input = input.slice(2);
        continue;
      }
    } else if (input[0] === "/") {
      if (input[1] === ".") {
        if (input[2] === "/") {
          input = input.slice(2);
          continue;
        } else if (input[2] === ".") {
          if (input[3] === "/") {
            input = input.slice(3);
            if (output.length !== 0) {
              output.pop();
            }
            continue;
          }
        }
      }
    }
    if ((nextSlash = input.indexOf("/", 1)) === -1) {
      output.push(input);
      break;
    } else {
      output.push(input.slice(0, nextSlash));
      input = input.slice(nextSlash);
    }
  }
  return output.join("");
}
function normalizeComponentEncoding$1(component, esc) {
  const func = esc !== true ? escape : unescape;
  if (component.scheme !== void 0) {
    component.scheme = func(component.scheme);
  }
  if (component.userinfo !== void 0) {
    component.userinfo = func(component.userinfo);
  }
  if (component.host !== void 0) {
    component.host = func(component.host);
  }
  if (component.path !== void 0) {
    component.path = func(component.path);
  }
  if (component.query !== void 0) {
    component.query = func(component.query);
  }
  if (component.fragment !== void 0) {
    component.fragment = func(component.fragment);
  }
  return component;
}
function recomposeAuthority$1(component) {
  const uriTokens = [];
  if (component.userinfo !== void 0) {
    uriTokens.push(component.userinfo);
    uriTokens.push("@");
  }
  if (component.host !== void 0) {
    let host = unescape(component.host);
    if (!isIPv4$1(host)) {
      const ipV6res = normalizeIPv6$1(host);
      if (ipV6res.isIPV6 === true) {
        host = `[${ipV6res.escapedHost}]`;
      } else {
        host = component.host;
      }
    }
    uriTokens.push(host);
  }
  if (typeof component.port === "number" || typeof component.port === "string") {
    uriTokens.push(":");
    uriTokens.push(String(component.port));
  }
  return uriTokens.length ? uriTokens.join("") : void 0;
}
var utils$3 = {
  nonSimpleDomain: nonSimpleDomain$1,
  recomposeAuthority: recomposeAuthority$1,
  normalizeComponentEncoding: normalizeComponentEncoding$1,
  removeDotSegments: removeDotSegments$1,
  isIPv4: isIPv4$1,
  isUUID: isUUID$1,
  normalizeIPv6: normalizeIPv6$1
};
const { isUUID } = utils$3;
const URN_REG = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
function wsIsSecure(wsComponent) {
  if (wsComponent.secure === true) {
    return true;
  } else if (wsComponent.secure === false) {
    return false;
  } else if (wsComponent.scheme) {
    return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
  } else {
    return false;
  }
}
function httpParse(component) {
  if (!component.host) {
    component.error = component.error || "HTTP URIs must have a host.";
  }
  return component;
}
function httpSerialize(component) {
  const secure = String(component.scheme).toLowerCase() === "https";
  if (component.port === (secure ? 443 : 80) || component.port === "") {
    component.port = void 0;
  }
  if (!component.path) {
    component.path = "/";
  }
  return component;
}
function wsParse(wsComponent) {
  wsComponent.secure = wsIsSecure(wsComponent);
  wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
  wsComponent.path = void 0;
  wsComponent.query = void 0;
  return wsComponent;
}
function wsSerialize(wsComponent) {
  if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
    wsComponent.port = void 0;
  }
  if (typeof wsComponent.secure === "boolean") {
    wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
    wsComponent.secure = void 0;
  }
  if (wsComponent.resourceName) {
    const [path2, query] = wsComponent.resourceName.split("?");
    wsComponent.path = path2 && path2 !== "/" ? path2 : void 0;
    wsComponent.query = query;
    wsComponent.resourceName = void 0;
  }
  wsComponent.fragment = void 0;
  return wsComponent;
}
function urnParse(urnComponent, options) {
  if (!urnComponent.path) {
    urnComponent.error = "URN can not be parsed";
    return urnComponent;
  }
  const matches = urnComponent.path.match(URN_REG);
  if (matches) {
    const scheme = options.scheme || urnComponent.scheme || "urn";
    urnComponent.nid = matches[1].toLowerCase();
    urnComponent.nss = matches[2];
    const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
    const schemeHandler = getSchemeHandler$1(urnScheme);
    urnComponent.path = void 0;
    if (schemeHandler) {
      urnComponent = schemeHandler.parse(urnComponent, options);
    }
  } else {
    urnComponent.error = urnComponent.error || "URN can not be parsed.";
  }
  return urnComponent;
}
function urnSerialize(urnComponent, options) {
  if (urnComponent.nid === void 0) {
    throw new Error("URN without nid cannot be serialized");
  }
  const scheme = options.scheme || urnComponent.scheme || "urn";
  const nid = urnComponent.nid.toLowerCase();
  const urnScheme = `${scheme}:${options.nid || nid}`;
  const schemeHandler = getSchemeHandler$1(urnScheme);
  if (schemeHandler) {
    urnComponent = schemeHandler.serialize(urnComponent, options);
  }
  const uriComponent = urnComponent;
  const nss = urnComponent.nss;
  uriComponent.path = `${nid || options.nid}:${nss}`;
  options.skipEscape = true;
  return uriComponent;
}
function urnuuidParse(urnComponent, options) {
  const uuidComponent = urnComponent;
  uuidComponent.uuid = uuidComponent.nss;
  uuidComponent.nss = void 0;
  if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
    uuidComponent.error = uuidComponent.error || "UUID is not valid.";
  }
  return uuidComponent;
}
function urnuuidSerialize(uuidComponent) {
  const urnComponent = uuidComponent;
  urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
  return urnComponent;
}
const http = (
  /** @type {SchemeHandler} */
  {
    scheme: "http",
    domainHost: true,
    parse: httpParse,
    serialize: httpSerialize
  }
);
const https = (
  /** @type {SchemeHandler} */
  {
    scheme: "https",
    domainHost: http.domainHost,
    parse: httpParse,
    serialize: httpSerialize
  }
);
const ws = (
  /** @type {SchemeHandler} */
  {
    scheme: "ws",
    domainHost: true,
    parse: wsParse,
    serialize: wsSerialize
  }
);
const wss = (
  /** @type {SchemeHandler} */
  {
    scheme: "wss",
    domainHost: ws.domainHost,
    parse: ws.parse,
    serialize: ws.serialize
  }
);
const urn = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn",
    parse: urnParse,
    serialize: urnSerialize,
    skipNormalize: true
  }
);
const urnuuid = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn:uuid",
    parse: urnuuidParse,
    serialize: urnuuidSerialize,
    skipNormalize: true
  }
);
const SCHEMES$1 = (
  /** @type {Record<SchemeName, SchemeHandler>} */
  {
    http,
    https,
    ws,
    wss,
    urn,
    "urn:uuid": urnuuid
  }
);
Object.setPrototypeOf(SCHEMES$1, null);
function getSchemeHandler$1(scheme) {
  return scheme && (SCHEMES$1[
    /** @type {SchemeName} */
    scheme
  ] || SCHEMES$1[
    /** @type {SchemeName} */
    scheme.toLowerCase()
  ]) || void 0;
}
var schemes = {
  SCHEMES: SCHEMES$1,
  getSchemeHandler: getSchemeHandler$1
};
const { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizeComponentEncoding, isIPv4, nonSimpleDomain } = utils$3;
const { SCHEMES, getSchemeHandler } = schemes;
function normalize(uri2, options) {
  if (typeof uri2 === "string") {
    uri2 = /** @type {T} */
    serialize$1(parse$7(uri2, options), options);
  } else if (typeof uri2 === "object") {
    uri2 = /** @type {T} */
    parse$7(serialize$1(uri2, options), options);
  }
  return uri2;
}
function resolve(baseURI, relativeURI, options) {
  const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
  const resolved = resolveComponent(parse$7(baseURI, schemelessOptions), parse$7(relativeURI, schemelessOptions), schemelessOptions, true);
  schemelessOptions.skipEscape = true;
  return serialize$1(resolved, schemelessOptions);
}
function resolveComponent(base, relative, options, skipNormalization) {
  const target = {};
  if (!skipNormalization) {
    base = parse$7(serialize$1(base, options), options);
    relative = parse$7(serialize$1(relative, options), options);
  }
  options = options || {};
  if (!options.tolerant && relative.scheme) {
    target.scheme = relative.scheme;
    target.userinfo = relative.userinfo;
    target.host = relative.host;
    target.port = relative.port;
    target.path = removeDotSegments(relative.path || "");
    target.query = relative.query;
  } else {
    if (relative.userinfo !== void 0 || relative.host !== void 0 || relative.port !== void 0) {
      target.userinfo = relative.userinfo;
      target.host = relative.host;
      target.port = relative.port;
      target.path = removeDotSegments(relative.path || "");
      target.query = relative.query;
    } else {
      if (!relative.path) {
        target.path = base.path;
        if (relative.query !== void 0) {
          target.query = relative.query;
        } else {
          target.query = base.query;
        }
      } else {
        if (relative.path[0] === "/") {
          target.path = removeDotSegments(relative.path);
        } else {
          if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path) {
            target.path = "/" + relative.path;
          } else if (!base.path) {
            target.path = relative.path;
          } else {
            target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
          }
          target.path = removeDotSegments(target.path);
        }
        target.query = relative.query;
      }
      target.userinfo = base.userinfo;
      target.host = base.host;
      target.port = base.port;
    }
    target.scheme = base.scheme;
  }
  target.fragment = relative.fragment;
  return target;
}
function equal$2(uriA, uriB, options) {
  if (typeof uriA === "string") {
    uriA = unescape(uriA);
    uriA = serialize$1(normalizeComponentEncoding(parse$7(uriA, options), true), { ...options, skipEscape: true });
  } else if (typeof uriA === "object") {
    uriA = serialize$1(normalizeComponentEncoding(uriA, true), { ...options, skipEscape: true });
  }
  if (typeof uriB === "string") {
    uriB = unescape(uriB);
    uriB = serialize$1(normalizeComponentEncoding(parse$7(uriB, options), true), { ...options, skipEscape: true });
  } else if (typeof uriB === "object") {
    uriB = serialize$1(normalizeComponentEncoding(uriB, true), { ...options, skipEscape: true });
  }
  return uriA.toLowerCase() === uriB.toLowerCase();
}
function serialize$1(cmpts, opts) {
  const component = {
    host: cmpts.host,
    scheme: cmpts.scheme,
    userinfo: cmpts.userinfo,
    port: cmpts.port,
    path: cmpts.path,
    query: cmpts.query,
    nid: cmpts.nid,
    nss: cmpts.nss,
    uuid: cmpts.uuid,
    fragment: cmpts.fragment,
    reference: cmpts.reference,
    resourceName: cmpts.resourceName,
    secure: cmpts.secure,
    error: ""
  };
  const options = Object.assign({}, opts);
  const uriTokens = [];
  const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
  if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);
  if (component.path !== void 0) {
    if (!options.skipEscape) {
      component.path = escape(component.path);
      if (component.scheme !== void 0) {
        component.path = component.path.split("%3A").join(":");
      }
    } else {
      component.path = unescape(component.path);
    }
  }
  if (options.reference !== "suffix" && component.scheme) {
    uriTokens.push(component.scheme, ":");
  }
  const authority = recomposeAuthority(component);
  if (authority !== void 0) {
    if (options.reference !== "suffix") {
      uriTokens.push("//");
    }
    uriTokens.push(authority);
    if (component.path && component.path[0] !== "/") {
      uriTokens.push("/");
    }
  }
  if (component.path !== void 0) {
    let s = component.path;
    if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
      s = removeDotSegments(s);
    }
    if (authority === void 0 && s[0] === "/" && s[1] === "/") {
      s = "/%2F" + s.slice(2);
    }
    uriTokens.push(s);
  }
  if (component.query !== void 0) {
    uriTokens.push("?", component.query);
  }
  if (component.fragment !== void 0) {
    uriTokens.push("#", component.fragment);
  }
  return uriTokens.join("");
}
const URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
function parse$7(uri2, opts) {
  const options = Object.assign({}, opts);
  const parsed = {
    scheme: void 0,
    userinfo: void 0,
    host: "",
    port: void 0,
    path: "",
    query: void 0,
    fragment: void 0
  };
  let isIP = false;
  if (options.reference === "suffix") {
    if (options.scheme) {
      uri2 = options.scheme + ":" + uri2;
    } else {
      uri2 = "//" + uri2;
    }
  }
  const matches = uri2.match(URI_PARSE);
  if (matches) {
    parsed.scheme = matches[1];
    parsed.userinfo = matches[3];
    parsed.host = matches[4];
    parsed.port = parseInt(matches[5], 10);
    parsed.path = matches[6] || "";
    parsed.query = matches[7];
    parsed.fragment = matches[8];
    if (isNaN(parsed.port)) {
      parsed.port = matches[5];
    }
    if (parsed.host) {
      const ipv4result = isIPv4(parsed.host);
      if (ipv4result === false) {
        const ipv6result = normalizeIPv6(parsed.host);
        parsed.host = ipv6result.host.toLowerCase();
        isIP = ipv6result.isIPV6;
      } else {
        isIP = true;
      }
    }
    if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path) {
      parsed.reference = "same-document";
    } else if (parsed.scheme === void 0) {
      parsed.reference = "relative";
    } else if (parsed.fragment === void 0) {
      parsed.reference = "absolute";
    } else {
      parsed.reference = "uri";
    }
    if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
      parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
    }
    const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
    if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
      if (parsed.host && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
        try {
          parsed.host = URL.domainToASCII(parsed.host.toLowerCase());
        } catch (e) {
          parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
        }
      }
    }
    if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
      if (uri2.indexOf("%") !== -1) {
        if (parsed.scheme !== void 0) {
          parsed.scheme = unescape(parsed.scheme);
        }
        if (parsed.host !== void 0) {
          parsed.host = unescape(parsed.host);
        }
      }
      if (parsed.path) {
        parsed.path = escape(unescape(parsed.path));
      }
      if (parsed.fragment) {
        parsed.fragment = encodeURI(decodeURIComponent(parsed.fragment));
      }
    }
    if (schemeHandler && schemeHandler.parse) {
      schemeHandler.parse(parsed, options);
    }
  } else {
    parsed.error = parsed.error || "URI can not be parsed.";
  }
  return parsed;
}
const fastUri = {
  SCHEMES,
  normalize,
  resolve,
  resolveComponent,
  equal: equal$2,
  serialize: serialize$1,
  parse: parse$7
};
fastUri$1.exports = fastUri;
fastUri$1.exports.default = fastUri;
fastUri$1.exports.fastUri = fastUri;
var fastUriExports = fastUri$1.exports;
Object.defineProperty(uri$1, "__esModule", { value: true });
const uri = fastUriExports;
uri.code = 'require("ajv/dist/runtime/uri").default';
uri$1.default = uri;
(function(exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.CodeGen = exports$1.Name = exports$1.nil = exports$1.stringify = exports$1.str = exports$1._ = exports$1.KeywordCxt = void 0;
  var validate_12 = validate;
  Object.defineProperty(exports$1, "KeywordCxt", { enumerable: true, get: function() {
    return validate_12.KeywordCxt;
  } });
  var codegen_12 = codegen;
  Object.defineProperty(exports$1, "_", { enumerable: true, get: function() {
    return codegen_12._;
  } });
  Object.defineProperty(exports$1, "str", { enumerable: true, get: function() {
    return codegen_12.str;
  } });
  Object.defineProperty(exports$1, "stringify", { enumerable: true, get: function() {
    return codegen_12.stringify;
  } });
  Object.defineProperty(exports$1, "nil", { enumerable: true, get: function() {
    return codegen_12.nil;
  } });
  Object.defineProperty(exports$1, "Name", { enumerable: true, get: function() {
    return codegen_12.Name;
  } });
  Object.defineProperty(exports$1, "CodeGen", { enumerable: true, get: function() {
    return codegen_12.CodeGen;
  } });
  const validation_error_12 = validation_error;
  const ref_error_12 = ref_error;
  const rules_12 = rules;
  const compile_12 = compile;
  const codegen_2 = codegen;
  const resolve_12 = resolve$2;
  const dataType_12 = dataType;
  const util_12 = util$1;
  const $dataRefSchema = require$$9;
  const uri_1 = uri$1;
  const defaultRegExp = (str, flags) => new RegExp(str, flags);
  defaultRegExp.code = "new RegExp";
  const META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
  const EXT_SCOPE_NAMES = /* @__PURE__ */ new Set([
    "validate",
    "serialize",
    "parse",
    "wrapper",
    "root",
    "schema",
    "keyword",
    "pattern",
    "formats",
    "validate$data",
    "func",
    "obj",
    "Error"
  ]);
  const removedOptions = {
    errorDataPath: "",
    format: "`validateFormats: false` can be used instead.",
    nullable: '"nullable" keyword is supported by default.',
    jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
    extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
    missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
    processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
    sourceCode: "Use option `code: {source: true}`",
    strictDefaults: "It is default now, see option `strict`.",
    strictKeywords: "It is default now, see option `strict`.",
    uniqueItems: '"uniqueItems" keyword is always validated.',
    unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
    cache: "Map is used as cache, schema object as key.",
    serialize: "Map is used as cache, schema object as key.",
    ajvErrors: "It is default now."
  };
  const deprecatedOptions = {
    ignoreKeywordsWithRef: "",
    jsPropertySyntax: "",
    unicode: '"minLength"/"maxLength" account for unicode characters by default.'
  };
  const MAX_EXPRESSION = 200;
  function requiredOptions(o) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t2, _u, _v, _w, _x, _y, _z, _0;
    const s = o.strict;
    const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
    const optimize = _optz === true || _optz === void 0 ? 1 : _optz || 0;
    const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
    const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
    return {
      strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
      strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
      strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
      strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
      strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
      code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
      loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
      loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
      meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
      messages: (_t2 = o.messages) !== null && _t2 !== void 0 ? _t2 : true,
      inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
      schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
      addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
      validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
      validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
      unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
      int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
      uriResolver
    };
  }
  class Ajv {
    constructor(opts = {}) {
      this.schemas = {};
      this.refs = {};
      this.formats = {};
      this._compilations = /* @__PURE__ */ new Set();
      this._loading = {};
      this._cache = /* @__PURE__ */ new Map();
      opts = this.opts = { ...opts, ...requiredOptions(opts) };
      const { es5, lines } = this.opts.code;
      this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
      this.logger = getLogger(opts.logger);
      const formatOpt = opts.validateFormats;
      opts.validateFormats = false;
      this.RULES = (0, rules_12.getRules)();
      checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
      checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
      this._metaOpts = getMetaSchemaOptions.call(this);
      if (opts.formats)
        addInitialFormats.call(this);
      this._addVocabularies();
      this._addDefaultMetaSchema();
      if (opts.keywords)
        addInitialKeywords.call(this, opts.keywords);
      if (typeof opts.meta == "object")
        this.addMetaSchema(opts.meta);
      addInitialSchemas.call(this);
      opts.validateFormats = formatOpt;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      const { $data, meta, schemaId } = this.opts;
      let _dataRefSchema = $dataRefSchema;
      if (schemaId === "id") {
        _dataRefSchema = { ...$dataRefSchema };
        _dataRefSchema.id = _dataRefSchema.$id;
        delete _dataRefSchema.$id;
      }
      if (meta && $data)
        this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
    }
    defaultMeta() {
      const { meta, schemaId } = this.opts;
      return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
    }
    validate(schemaKeyRef, data) {
      let v;
      if (typeof schemaKeyRef == "string") {
        v = this.getSchema(schemaKeyRef);
        if (!v)
          throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
      } else {
        v = this.compile(schemaKeyRef);
      }
      const valid2 = v(data);
      if (!("$async" in v))
        this.errors = v.errors;
      return valid2;
    }
    compile(schema, _meta) {
      const sch = this._addSchema(schema, _meta);
      return sch.validate || this._compileSchemaEnv(sch);
    }
    compileAsync(schema, meta) {
      if (typeof this.opts.loadSchema != "function") {
        throw new Error("options.loadSchema should be a function");
      }
      const { loadSchema } = this.opts;
      return runCompileAsync.call(this, schema, meta);
      async function runCompileAsync(_schema, _meta) {
        await loadMetaSchema.call(this, _schema.$schema);
        const sch = this._addSchema(_schema, _meta);
        return sch.validate || _compileAsync.call(this, sch);
      }
      async function loadMetaSchema($ref) {
        if ($ref && !this.getSchema($ref)) {
          await runCompileAsync.call(this, { $ref }, true);
        }
      }
      async function _compileAsync(sch) {
        try {
          return this._compileSchemaEnv(sch);
        } catch (e) {
          if (!(e instanceof ref_error_12.default))
            throw e;
          checkLoaded.call(this, e);
          await loadMissingSchema.call(this, e.missingSchema);
          return _compileAsync.call(this, sch);
        }
      }
      function checkLoaded({ missingSchema: ref2, missingRef }) {
        if (this.refs[ref2]) {
          throw new Error(`AnySchema ${ref2} is loaded but ${missingRef} cannot be resolved`);
        }
      }
      async function loadMissingSchema(ref2) {
        const _schema = await _loadSchema.call(this, ref2);
        if (!this.refs[ref2])
          await loadMetaSchema.call(this, _schema.$schema);
        if (!this.refs[ref2])
          this.addSchema(_schema, ref2, meta);
      }
      async function _loadSchema(ref2) {
        const p = this._loading[ref2];
        if (p)
          return p;
        try {
          return await (this._loading[ref2] = loadSchema(ref2));
        } finally {
          delete this._loading[ref2];
        }
      }
    }
    // Adds schema to the instance
    addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
      if (Array.isArray(schema)) {
        for (const sch of schema)
          this.addSchema(sch, void 0, _meta, _validateSchema);
        return this;
      }
      let id2;
      if (typeof schema === "object") {
        const { schemaId } = this.opts;
        id2 = schema[schemaId];
        if (id2 !== void 0 && typeof id2 != "string") {
          throw new Error(`schema ${schemaId} must be string`);
        }
      }
      key = (0, resolve_12.normalizeId)(key || id2);
      this._checkUnique(key);
      this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
      return this;
    }
    // Add schema that will be used to validate other schemas
    // options in META_IGNORE_OPTIONS are alway set to false
    addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
      this.addSchema(schema, key, true, _validateSchema);
      return this;
    }
    //  Validate schema against its meta-schema
    validateSchema(schema, throwOrLogError) {
      if (typeof schema == "boolean")
        return true;
      let $schema2;
      $schema2 = schema.$schema;
      if ($schema2 !== void 0 && typeof $schema2 != "string") {
        throw new Error("$schema must be a string");
      }
      $schema2 = $schema2 || this.opts.defaultMeta || this.defaultMeta();
      if (!$schema2) {
        this.logger.warn("meta-schema not available");
        this.errors = null;
        return true;
      }
      const valid2 = this.validate($schema2, schema);
      if (!valid2 && throwOrLogError) {
        const message = "schema is invalid: " + this.errorsText();
        if (this.opts.validateSchema === "log")
          this.logger.error(message);
        else
          throw new Error(message);
      }
      return valid2;
    }
    // Get compiled schema by `key` or `ref`.
    // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
    getSchema(keyRef) {
      let sch;
      while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
        keyRef = sch;
      if (sch === void 0) {
        const { schemaId } = this.opts;
        const root = new compile_12.SchemaEnv({ schema: {}, schemaId });
        sch = compile_12.resolveSchema.call(this, root, keyRef);
        if (!sch)
          return;
        this.refs[keyRef] = sch;
      }
      return sch.validate || this._compileSchemaEnv(sch);
    }
    // Remove cached schema(s).
    // If no parameter is passed all schemas but meta-schemas are removed.
    // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
    // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
    removeSchema(schemaKeyRef) {
      if (schemaKeyRef instanceof RegExp) {
        this._removeAllSchemas(this.schemas, schemaKeyRef);
        this._removeAllSchemas(this.refs, schemaKeyRef);
        return this;
      }
      switch (typeof schemaKeyRef) {
        case "undefined":
          this._removeAllSchemas(this.schemas);
          this._removeAllSchemas(this.refs);
          this._cache.clear();
          return this;
        case "string": {
          const sch = getSchEnv.call(this, schemaKeyRef);
          if (typeof sch == "object")
            this._cache.delete(sch.schema);
          delete this.schemas[schemaKeyRef];
          delete this.refs[schemaKeyRef];
          return this;
        }
        case "object": {
          const cacheKey = schemaKeyRef;
          this._cache.delete(cacheKey);
          let id2 = schemaKeyRef[this.opts.schemaId];
          if (id2) {
            id2 = (0, resolve_12.normalizeId)(id2);
            delete this.schemas[id2];
            delete this.refs[id2];
          }
          return this;
        }
        default:
          throw new Error("ajv.removeSchema: invalid parameter");
      }
    }
    // add "vocabulary" - a collection of keywords
    addVocabulary(definitions2) {
      for (const def2 of definitions2)
        this.addKeyword(def2);
      return this;
    }
    addKeyword(kwdOrDef, def2) {
      let keyword2;
      if (typeof kwdOrDef == "string") {
        keyword2 = kwdOrDef;
        if (typeof def2 == "object") {
          this.logger.warn("these parameters are deprecated, see docs for addKeyword");
          def2.keyword = keyword2;
        }
      } else if (typeof kwdOrDef == "object" && def2 === void 0) {
        def2 = kwdOrDef;
        keyword2 = def2.keyword;
        if (Array.isArray(keyword2) && !keyword2.length) {
          throw new Error("addKeywords: keyword must be string or non-empty array");
        }
      } else {
        throw new Error("invalid addKeywords parameters");
      }
      checkKeyword.call(this, keyword2, def2);
      if (!def2) {
        (0, util_12.eachItem)(keyword2, (kwd) => addRule.call(this, kwd));
        return this;
      }
      keywordMetaschema.call(this, def2);
      const definition = {
        ...def2,
        type: (0, dataType_12.getJSONTypes)(def2.type),
        schemaType: (0, dataType_12.getJSONTypes)(def2.schemaType)
      };
      (0, util_12.eachItem)(keyword2, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t2) => addRule.call(this, k, definition, t2)));
      return this;
    }
    getKeyword(keyword2) {
      const rule = this.RULES.all[keyword2];
      return typeof rule == "object" ? rule.definition : !!rule;
    }
    // Remove keyword
    removeKeyword(keyword2) {
      const { RULES } = this;
      delete RULES.keywords[keyword2];
      delete RULES.all[keyword2];
      for (const group of RULES.rules) {
        const i = group.rules.findIndex((rule) => rule.keyword === keyword2);
        if (i >= 0)
          group.rules.splice(i, 1);
      }
      return this;
    }
    // Add format
    addFormat(name, format2) {
      if (typeof format2 == "string")
        format2 = new RegExp(format2);
      this.formats[name] = format2;
      return this;
    }
    errorsText(errors2 = this.errors, { separator = ", ", dataVar = "data" } = {}) {
      if (!errors2 || errors2.length === 0)
        return "No errors";
      return errors2.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
    }
    $dataMetaSchema(metaSchema2, keywordsJsonPointers) {
      const rules2 = this.RULES.all;
      metaSchema2 = JSON.parse(JSON.stringify(metaSchema2));
      for (const jsonPointer of keywordsJsonPointers) {
        const segments = jsonPointer.split("/").slice(1);
        let keywords = metaSchema2;
        for (const seg of segments)
          keywords = keywords[seg];
        for (const key in rules2) {
          const rule = rules2[key];
          if (typeof rule != "object")
            continue;
          const { $data } = rule.definition;
          const schema = keywords[key];
          if ($data && schema)
            keywords[key] = schemaOrData(schema);
        }
      }
      return metaSchema2;
    }
    _removeAllSchemas(schemas, regex) {
      for (const keyRef in schemas) {
        const sch = schemas[keyRef];
        if (!regex || regex.test(keyRef)) {
          if (typeof sch == "string") {
            delete schemas[keyRef];
          } else if (sch && !sch.meta) {
            this._cache.delete(sch.schema);
            delete schemas[keyRef];
          }
        }
      }
    }
    _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
      let id2;
      const { schemaId } = this.opts;
      if (typeof schema == "object") {
        id2 = schema[schemaId];
      } else {
        if (this.opts.jtd)
          throw new Error("schema must be object");
        else if (typeof schema != "boolean")
          throw new Error("schema must be object or boolean");
      }
      let sch = this._cache.get(schema);
      if (sch !== void 0)
        return sch;
      baseId = (0, resolve_12.normalizeId)(id2 || baseId);
      const localRefs = resolve_12.getSchemaRefs.call(this, schema, baseId);
      sch = new compile_12.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
      this._cache.set(sch.schema, sch);
      if (addSchema && !baseId.startsWith("#")) {
        if (baseId)
          this._checkUnique(baseId);
        this.refs[baseId] = sch;
      }
      if (validateSchema)
        this.validateSchema(schema, true);
      return sch;
    }
    _checkUnique(id2) {
      if (this.schemas[id2] || this.refs[id2]) {
        throw new Error(`schema with key or id "${id2}" already exists`);
      }
    }
    _compileSchemaEnv(sch) {
      if (sch.meta)
        this._compileMetaSchema(sch);
      else
        compile_12.compileSchema.call(this, sch);
      if (!sch.validate)
        throw new Error("ajv implementation error");
      return sch.validate;
    }
    _compileMetaSchema(sch) {
      const currentOpts = this.opts;
      this.opts = this._metaOpts;
      try {
        compile_12.compileSchema.call(this, sch);
      } finally {
        this.opts = currentOpts;
      }
    }
  }
  Ajv.ValidationError = validation_error_12.default;
  Ajv.MissingRefError = ref_error_12.default;
  exports$1.default = Ajv;
  function checkOptions(checkOpts, options, msg, log = "error") {
    for (const key in checkOpts) {
      const opt = key;
      if (opt in options)
        this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
    }
  }
  function getSchEnv(keyRef) {
    keyRef = (0, resolve_12.normalizeId)(keyRef);
    return this.schemas[keyRef] || this.refs[keyRef];
  }
  function addInitialSchemas() {
    const optsSchemas = this.opts.schemas;
    if (!optsSchemas)
      return;
    if (Array.isArray(optsSchemas))
      this.addSchema(optsSchemas);
    else
      for (const key in optsSchemas)
        this.addSchema(optsSchemas[key], key);
  }
  function addInitialFormats() {
    for (const name in this.opts.formats) {
      const format2 = this.opts.formats[name];
      if (format2)
        this.addFormat(name, format2);
    }
  }
  function addInitialKeywords(defs) {
    if (Array.isArray(defs)) {
      this.addVocabulary(defs);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (const keyword2 in defs) {
      const def2 = defs[keyword2];
      if (!def2.keyword)
        def2.keyword = keyword2;
      this.addKeyword(def2);
    }
  }
  function getMetaSchemaOptions() {
    const metaOpts = { ...this.opts };
    for (const opt of META_IGNORE_OPTIONS)
      delete metaOpts[opt];
    return metaOpts;
  }
  const noLogs = { log() {
  }, warn() {
  }, error() {
  } };
  function getLogger(logger) {
    if (logger === false)
      return noLogs;
    if (logger === void 0)
      return console;
    if (logger.log && logger.warn && logger.error)
      return logger;
    throw new Error("logger must implement log, warn and error methods");
  }
  const KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
  function checkKeyword(keyword2, def2) {
    const { RULES } = this;
    (0, util_12.eachItem)(keyword2, (kwd) => {
      if (RULES.keywords[kwd])
        throw new Error(`Keyword ${kwd} is already defined`);
      if (!KEYWORD_NAME.test(kwd))
        throw new Error(`Keyword ${kwd} has invalid name`);
    });
    if (!def2)
      return;
    if (def2.$data && !("code" in def2 || "validate" in def2)) {
      throw new Error('$data keyword must have "code" or "validate" function');
    }
  }
  function addRule(keyword2, definition, dataType2) {
    var _a;
    const post = definition === null || definition === void 0 ? void 0 : definition.post;
    if (dataType2 && post)
      throw new Error('keyword with "post" flag cannot have "type"');
    const { RULES } = this;
    let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t2 }) => t2 === dataType2);
    if (!ruleGroup) {
      ruleGroup = { type: dataType2, rules: [] };
      RULES.rules.push(ruleGroup);
    }
    RULES.keywords[keyword2] = true;
    if (!definition)
      return;
    const rule = {
      keyword: keyword2,
      definition: {
        ...definition,
        type: (0, dataType_12.getJSONTypes)(definition.type),
        schemaType: (0, dataType_12.getJSONTypes)(definition.schemaType)
      }
    };
    if (definition.before)
      addBeforeRule.call(this, ruleGroup, rule, definition.before);
    else
      ruleGroup.rules.push(rule);
    RULES.all[keyword2] = rule;
    (_a = definition.implements) === null || _a === void 0 ? void 0 : _a.forEach((kwd) => this.addKeyword(kwd));
  }
  function addBeforeRule(ruleGroup, rule, before) {
    const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
    if (i >= 0) {
      ruleGroup.rules.splice(i, 0, rule);
    } else {
      ruleGroup.rules.push(rule);
      this.logger.warn(`rule ${before} is not defined`);
    }
  }
  function keywordMetaschema(def2) {
    let { metaSchema: metaSchema2 } = def2;
    if (metaSchema2 === void 0)
      return;
    if (def2.$data && this.opts.$data)
      metaSchema2 = schemaOrData(metaSchema2);
    def2.validateSchema = this.compile(metaSchema2, true);
  }
  const $dataRef = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function schemaOrData(schema) {
    return { anyOf: [schema, $dataRef] };
  }
})(core$3);
var draft2020 = {};
var core$2 = {};
var id = {};
Object.defineProperty(id, "__esModule", { value: true });
const def$B = {
  keyword: "id",
  code() {
    throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
  }
};
id.default = def$B;
var ref = {};
Object.defineProperty(ref, "__esModule", { value: true });
ref.callRef = ref.getValidate = void 0;
const ref_error_1$1 = ref_error;
const code_1$8 = code;
const codegen_1$p = codegen;
const names_1$4 = names$1;
const compile_1$2 = compile;
const util_1$n = util$1;
const def$A = {
  keyword: "$ref",
  schemaType: "string",
  code(cxt) {
    const { gen, schema: $ref, it } = cxt;
    const { baseId, schemaEnv: env2, validateName, opts, self: self2 } = it;
    const { root } = env2;
    if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
      return callRootRef();
    const schOrEnv = compile_1$2.resolveRef.call(self2, root, baseId, $ref);
    if (schOrEnv === void 0)
      throw new ref_error_1$1.default(it.opts.uriResolver, baseId, $ref);
    if (schOrEnv instanceof compile_1$2.SchemaEnv)
      return callValidate(schOrEnv);
    return inlineRefSchema(schOrEnv);
    function callRootRef() {
      if (env2 === root)
        return callRef(cxt, validateName, env2, env2.$async);
      const rootName = gen.scopeValue("root", { ref: root });
      return callRef(cxt, (0, codegen_1$p._)`${rootName}.validate`, root, root.$async);
    }
    function callValidate(sch) {
      const v = getValidate(cxt, sch);
      callRef(cxt, v, sch, sch.$async);
    }
    function inlineRefSchema(sch) {
      const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1$p.stringify)(sch) } : { ref: sch });
      const valid2 = gen.name("valid");
      const schCxt = cxt.subschema({
        schema: sch,
        dataTypes: [],
        schemaPath: codegen_1$p.nil,
        topSchemaRef: schName,
        errSchemaPath: $ref
      }, valid2);
      cxt.mergeEvaluated(schCxt);
      cxt.ok(valid2);
    }
  }
};
function getValidate(cxt, sch) {
  const { gen } = cxt;
  return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1$p._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
}
ref.getValidate = getValidate;
function callRef(cxt, v, sch, $async) {
  const { gen, it } = cxt;
  const { allErrors, schemaEnv: env2, opts } = it;
  const passCxt = opts.passContext ? names_1$4.default.this : codegen_1$p.nil;
  if ($async)
    callAsyncRef();
  else
    callSyncRef();
  function callAsyncRef() {
    if (!env2.$async)
      throw new Error("async schema referenced by sync schema");
    const valid2 = gen.let("valid");
    gen.try(() => {
      gen.code((0, codegen_1$p._)`await ${(0, code_1$8.callValidateCode)(cxt, v, passCxt)}`);
      addEvaluatedFrom(v);
      if (!allErrors)
        gen.assign(valid2, true);
    }, (e) => {
      gen.if((0, codegen_1$p._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
      addErrorsFrom(e);
      if (!allErrors)
        gen.assign(valid2, false);
    });
    cxt.ok(valid2);
  }
  function callSyncRef() {
    cxt.result((0, code_1$8.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
  }
  function addErrorsFrom(source) {
    const errs = (0, codegen_1$p._)`${source}.errors`;
    gen.assign(names_1$4.default.vErrors, (0, codegen_1$p._)`${names_1$4.default.vErrors} === null ? ${errs} : ${names_1$4.default.vErrors}.concat(${errs})`);
    gen.assign(names_1$4.default.errors, (0, codegen_1$p._)`${names_1$4.default.vErrors}.length`);
  }
  function addEvaluatedFrom(source) {
    var _a;
    if (!it.opts.unevaluated)
      return;
    const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
    if (it.props !== true) {
      if (schEvaluated && !schEvaluated.dynamicProps) {
        if (schEvaluated.props !== void 0) {
          it.props = util_1$n.mergeEvaluated.props(gen, schEvaluated.props, it.props);
        }
      } else {
        const props = gen.var("props", (0, codegen_1$p._)`${source}.evaluated.props`);
        it.props = util_1$n.mergeEvaluated.props(gen, props, it.props, codegen_1$p.Name);
      }
    }
    if (it.items !== true) {
      if (schEvaluated && !schEvaluated.dynamicItems) {
        if (schEvaluated.items !== void 0) {
          it.items = util_1$n.mergeEvaluated.items(gen, schEvaluated.items, it.items);
        }
      } else {
        const items2 = gen.var("items", (0, codegen_1$p._)`${source}.evaluated.items`);
        it.items = util_1$n.mergeEvaluated.items(gen, items2, it.items, codegen_1$p.Name);
      }
    }
  }
}
ref.callRef = callRef;
ref.default = def$A;
Object.defineProperty(core$2, "__esModule", { value: true });
const id_1 = id;
const ref_1$2 = ref;
const core$1 = [
  "$schema",
  "$id",
  "$defs",
  "$vocabulary",
  { keyword: "$comment" },
  "definitions",
  id_1.default,
  ref_1$2.default
];
core$2.default = core$1;
var validation$2 = {};
var limitNumber = {};
Object.defineProperty(limitNumber, "__esModule", { value: true });
const codegen_1$o = codegen;
const ops = codegen_1$o.operators;
const KWDs = {
  maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
  minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
  exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
  exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
};
const error$k = {
  message: ({ keyword: keyword2, schemaCode }) => (0, codegen_1$o.str)`must be ${KWDs[keyword2].okStr} ${schemaCode}`,
  params: ({ keyword: keyword2, schemaCode }) => (0, codegen_1$o._)`{comparison: ${KWDs[keyword2].okStr}, limit: ${schemaCode}}`
};
const def$z = {
  keyword: Object.keys(KWDs),
  type: "number",
  schemaType: "number",
  $data: true,
  error: error$k,
  code(cxt) {
    const { keyword: keyword2, data, schemaCode } = cxt;
    cxt.fail$data((0, codegen_1$o._)`${data} ${KWDs[keyword2].fail} ${schemaCode} || isNaN(${data})`);
  }
};
limitNumber.default = def$z;
var multipleOf = {};
Object.defineProperty(multipleOf, "__esModule", { value: true });
const codegen_1$n = codegen;
const error$j = {
  message: ({ schemaCode }) => (0, codegen_1$n.str)`must be multiple of ${schemaCode}`,
  params: ({ schemaCode }) => (0, codegen_1$n._)`{multipleOf: ${schemaCode}}`
};
const def$y = {
  keyword: "multipleOf",
  type: "number",
  schemaType: "number",
  $data: true,
  error: error$j,
  code(cxt) {
    const { gen, data, schemaCode, it } = cxt;
    const prec = it.opts.multipleOfPrecision;
    const res = gen.let("res");
    const invalid = prec ? (0, codegen_1$n._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1$n._)`${res} !== parseInt(${res})`;
    cxt.fail$data((0, codegen_1$n._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
  }
};
multipleOf.default = def$y;
var limitLength = {};
var ucs2length$1 = {};
Object.defineProperty(ucs2length$1, "__esModule", { value: true });
function ucs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  let value;
  while (pos < len) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 55296 && value <= 56319 && pos < len) {
      value = str.charCodeAt(pos);
      if ((value & 64512) === 56320)
        pos++;
    }
  }
  return length;
}
ucs2length$1.default = ucs2length;
ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
Object.defineProperty(limitLength, "__esModule", { value: true });
const codegen_1$m = codegen;
const util_1$m = util$1;
const ucs2length_1 = ucs2length$1;
const error$i = {
  message({ keyword: keyword2, schemaCode }) {
    const comp = keyword2 === "maxLength" ? "more" : "fewer";
    return (0, codegen_1$m.str)`must NOT have ${comp} than ${schemaCode} characters`;
  },
  params: ({ schemaCode }) => (0, codegen_1$m._)`{limit: ${schemaCode}}`
};
const def$x = {
  keyword: ["maxLength", "minLength"],
  type: "string",
  schemaType: "number",
  $data: true,
  error: error$i,
  code(cxt) {
    const { keyword: keyword2, data, schemaCode, it } = cxt;
    const op = keyword2 === "maxLength" ? codegen_1$m.operators.GT : codegen_1$m.operators.LT;
    const len = it.opts.unicode === false ? (0, codegen_1$m._)`${data}.length` : (0, codegen_1$m._)`${(0, util_1$m.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
    cxt.fail$data((0, codegen_1$m._)`${len} ${op} ${schemaCode}`);
  }
};
limitLength.default = def$x;
var pattern = {};
Object.defineProperty(pattern, "__esModule", { value: true });
const code_1$7 = code;
const codegen_1$l = codegen;
const error$h = {
  message: ({ schemaCode }) => (0, codegen_1$l.str)`must match pattern "${schemaCode}"`,
  params: ({ schemaCode }) => (0, codegen_1$l._)`{pattern: ${schemaCode}}`
};
const def$w = {
  keyword: "pattern",
  type: "string",
  schemaType: "string",
  $data: true,
  error: error$h,
  code(cxt) {
    const { data, $data, schema, schemaCode, it } = cxt;
    const u2 = it.opts.unicodeRegExp ? "u" : "";
    const regExp = $data ? (0, codegen_1$l._)`(new RegExp(${schemaCode}, ${u2}))` : (0, code_1$7.usePattern)(cxt, schema);
    cxt.fail$data((0, codegen_1$l._)`!${regExp}.test(${data})`);
  }
};
pattern.default = def$w;
var limitProperties = {};
Object.defineProperty(limitProperties, "__esModule", { value: true });
const codegen_1$k = codegen;
const error$g = {
  message({ keyword: keyword2, schemaCode }) {
    const comp = keyword2 === "maxProperties" ? "more" : "fewer";
    return (0, codegen_1$k.str)`must NOT have ${comp} than ${schemaCode} properties`;
  },
  params: ({ schemaCode }) => (0, codegen_1$k._)`{limit: ${schemaCode}}`
};
const def$v = {
  keyword: ["maxProperties", "minProperties"],
  type: "object",
  schemaType: "number",
  $data: true,
  error: error$g,
  code(cxt) {
    const { keyword: keyword2, data, schemaCode } = cxt;
    const op = keyword2 === "maxProperties" ? codegen_1$k.operators.GT : codegen_1$k.operators.LT;
    cxt.fail$data((0, codegen_1$k._)`Object.keys(${data}).length ${op} ${schemaCode}`);
  }
};
limitProperties.default = def$v;
var required = {};
Object.defineProperty(required, "__esModule", { value: true });
const code_1$6 = code;
const codegen_1$j = codegen;
const util_1$l = util$1;
const error$f = {
  message: ({ params: { missingProperty } }) => (0, codegen_1$j.str)`must have required property '${missingProperty}'`,
  params: ({ params: { missingProperty } }) => (0, codegen_1$j._)`{missingProperty: ${missingProperty}}`
};
const def$u = {
  keyword: "required",
  type: "object",
  schemaType: "array",
  $data: true,
  error: error$f,
  code(cxt) {
    const { gen, schema, schemaCode, data, $data, it } = cxt;
    const { opts } = it;
    if (!$data && schema.length === 0)
      return;
    const useLoop = schema.length >= opts.loopRequired;
    if (it.allErrors)
      allErrorsMode();
    else
      exitOnErrorMode();
    if (opts.strictRequired) {
      const props = cxt.parentSchema.properties;
      const { definedProperties } = cxt.it;
      for (const requiredKey of schema) {
        if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
          const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
          const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
          (0, util_1$l.checkStrictMode)(it, msg, it.opts.strictRequired);
        }
      }
    }
    function allErrorsMode() {
      if (useLoop || $data) {
        cxt.block$data(codegen_1$j.nil, loopAllRequired);
      } else {
        for (const prop of schema) {
          (0, code_1$6.checkReportMissingProp)(cxt, prop);
        }
      }
    }
    function exitOnErrorMode() {
      const missing = gen.let("missing");
      if (useLoop || $data) {
        const valid2 = gen.let("valid", true);
        cxt.block$data(valid2, () => loopUntilMissing(missing, valid2));
        cxt.ok(valid2);
      } else {
        gen.if((0, code_1$6.checkMissingProp)(cxt, schema, missing));
        (0, code_1$6.reportMissingProp)(cxt, missing);
        gen.else();
      }
    }
    function loopAllRequired() {
      gen.forOf("prop", schemaCode, (prop) => {
        cxt.setParams({ missingProperty: prop });
        gen.if((0, code_1$6.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
      });
    }
    function loopUntilMissing(missing, valid2) {
      cxt.setParams({ missingProperty: missing });
      gen.forOf(missing, schemaCode, () => {
        gen.assign(valid2, (0, code_1$6.propertyInData)(gen, data, missing, opts.ownProperties));
        gen.if((0, codegen_1$j.not)(valid2), () => {
          cxt.error();
          gen.break();
        });
      }, codegen_1$j.nil);
    }
  }
};
required.default = def$u;
var limitItems = {};
Object.defineProperty(limitItems, "__esModule", { value: true });
const codegen_1$i = codegen;
const error$e = {
  message({ keyword: keyword2, schemaCode }) {
    const comp = keyword2 === "maxItems" ? "more" : "fewer";
    return (0, codegen_1$i.str)`must NOT have ${comp} than ${schemaCode} items`;
  },
  params: ({ schemaCode }) => (0, codegen_1$i._)`{limit: ${schemaCode}}`
};
const def$t = {
  keyword: ["maxItems", "minItems"],
  type: "array",
  schemaType: "number",
  $data: true,
  error: error$e,
  code(cxt) {
    const { keyword: keyword2, data, schemaCode } = cxt;
    const op = keyword2 === "maxItems" ? codegen_1$i.operators.GT : codegen_1$i.operators.LT;
    cxt.fail$data((0, codegen_1$i._)`${data}.length ${op} ${schemaCode}`);
  }
};
limitItems.default = def$t;
var uniqueItems = {};
var equal$1 = {};
Object.defineProperty(equal$1, "__esModule", { value: true });
const equal2 = fastDeepEqual;
equal2.code = 'require("ajv/dist/runtime/equal").default';
equal$1.default = equal2;
Object.defineProperty(uniqueItems, "__esModule", { value: true });
const dataType_1 = dataType;
const codegen_1$h = codegen;
const util_1$k = util$1;
const equal_1$2 = equal$1;
const error$d = {
  message: ({ params: { i, j: j2 } }) => (0, codegen_1$h.str)`must NOT have duplicate items (items ## ${j2} and ${i} are identical)`,
  params: ({ params: { i, j: j2 } }) => (0, codegen_1$h._)`{i: ${i}, j: ${j2}}`
};
const def$s = {
  keyword: "uniqueItems",
  type: "array",
  schemaType: "boolean",
  $data: true,
  error: error$d,
  code(cxt) {
    const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
    if (!$data && !schema)
      return;
    const valid2 = gen.let("valid");
    const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
    cxt.block$data(valid2, validateUniqueItems, (0, codegen_1$h._)`${schemaCode} === false`);
    cxt.ok(valid2);
    function validateUniqueItems() {
      const i = gen.let("i", (0, codegen_1$h._)`${data}.length`);
      const j2 = gen.let("j");
      cxt.setParams({ i, j: j2 });
      gen.assign(valid2, true);
      gen.if((0, codegen_1$h._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j2));
    }
    function canOptimize() {
      return itemTypes.length > 0 && !itemTypes.some((t2) => t2 === "object" || t2 === "array");
    }
    function loopN(i, j2) {
      const item = gen.name("item");
      const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
      const indices = gen.const("indices", (0, codegen_1$h._)`{}`);
      gen.for((0, codegen_1$h._)`;${i}--;`, () => {
        gen.let(item, (0, codegen_1$h._)`${data}[${i}]`);
        gen.if(wrongType, (0, codegen_1$h._)`continue`);
        if (itemTypes.length > 1)
          gen.if((0, codegen_1$h._)`typeof ${item} == "string"`, (0, codegen_1$h._)`${item} += "_"`);
        gen.if((0, codegen_1$h._)`typeof ${indices}[${item}] == "number"`, () => {
          gen.assign(j2, (0, codegen_1$h._)`${indices}[${item}]`);
          cxt.error();
          gen.assign(valid2, false).break();
        }).code((0, codegen_1$h._)`${indices}[${item}] = ${i}`);
      });
    }
    function loopN2(i, j2) {
      const eql = (0, util_1$k.useFunc)(gen, equal_1$2.default);
      const outer = gen.name("outer");
      gen.label(outer).for((0, codegen_1$h._)`;${i}--;`, () => gen.for((0, codegen_1$h._)`${j2} = ${i}; ${j2}--;`, () => gen.if((0, codegen_1$h._)`${eql}(${data}[${i}], ${data}[${j2}])`, () => {
        cxt.error();
        gen.assign(valid2, false).break(outer);
      })));
    }
  }
};
uniqueItems.default = def$s;
var _const = {};
Object.defineProperty(_const, "__esModule", { value: true });
const codegen_1$g = codegen;
const util_1$j = util$1;
const equal_1$1 = equal$1;
const error$c = {
  message: "must be equal to constant",
  params: ({ schemaCode }) => (0, codegen_1$g._)`{allowedValue: ${schemaCode}}`
};
const def$r = {
  keyword: "const",
  $data: true,
  error: error$c,
  code(cxt) {
    const { gen, data, $data, schemaCode, schema } = cxt;
    if ($data || schema && typeof schema == "object") {
      cxt.fail$data((0, codegen_1$g._)`!${(0, util_1$j.useFunc)(gen, equal_1$1.default)}(${data}, ${schemaCode})`);
    } else {
      cxt.fail((0, codegen_1$g._)`${schema} !== ${data}`);
    }
  }
};
_const.default = def$r;
var _enum = {};
Object.defineProperty(_enum, "__esModule", { value: true });
const codegen_1$f = codegen;
const util_1$i = util$1;
const equal_1 = equal$1;
const error$b = {
  message: "must be equal to one of the allowed values",
  params: ({ schemaCode }) => (0, codegen_1$f._)`{allowedValues: ${schemaCode}}`
};
const def$q = {
  keyword: "enum",
  schemaType: "array",
  $data: true,
  error: error$b,
  code(cxt) {
    const { gen, data, $data, schema, schemaCode, it } = cxt;
    if (!$data && schema.length === 0)
      throw new Error("enum must have non-empty array");
    const useLoop = schema.length >= it.opts.loopEnum;
    let eql;
    const getEql = () => eql !== null && eql !== void 0 ? eql : eql = (0, util_1$i.useFunc)(gen, equal_1.default);
    let valid2;
    if (useLoop || $data) {
      valid2 = gen.let("valid");
      cxt.block$data(valid2, loopEnum);
    } else {
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const vSchema = gen.const("vSchema", schemaCode);
      valid2 = (0, codegen_1$f.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
    }
    cxt.pass(valid2);
    function loopEnum() {
      gen.assign(valid2, false);
      gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1$f._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid2, true).break()));
    }
    function equalCode(vSchema, i) {
      const sch = schema[i];
      return typeof sch === "object" && sch !== null ? (0, codegen_1$f._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1$f._)`${data} === ${sch}`;
    }
  }
};
_enum.default = def$q;
Object.defineProperty(validation$2, "__esModule", { value: true });
const limitNumber_1 = limitNumber;
const multipleOf_1 = multipleOf;
const limitLength_1 = limitLength;
const pattern_1 = pattern;
const limitProperties_1 = limitProperties;
const required_1 = required;
const limitItems_1 = limitItems;
const uniqueItems_1 = uniqueItems;
const const_1 = _const;
const enum_1 = _enum;
const validation$1 = [
  // number
  limitNumber_1.default,
  multipleOf_1.default,
  // string
  limitLength_1.default,
  pattern_1.default,
  // object
  limitProperties_1.default,
  required_1.default,
  // array
  limitItems_1.default,
  uniqueItems_1.default,
  // any
  { keyword: "type", schemaType: ["string", "array"] },
  { keyword: "nullable", schemaType: "boolean" },
  const_1.default,
  enum_1.default
];
validation$2.default = validation$1;
var applicator$1 = {};
var additionalItems = {};
Object.defineProperty(additionalItems, "__esModule", { value: true });
additionalItems.validateAdditionalItems = void 0;
const codegen_1$e = codegen;
const util_1$h = util$1;
const error$a = {
  message: ({ params: { len } }) => (0, codegen_1$e.str)`must NOT have more than ${len} items`,
  params: ({ params: { len } }) => (0, codegen_1$e._)`{limit: ${len}}`
};
const def$p = {
  keyword: "additionalItems",
  type: "array",
  schemaType: ["boolean", "object"],
  before: "uniqueItems",
  error: error$a,
  code(cxt) {
    const { parentSchema, it } = cxt;
    const { items: items2 } = parentSchema;
    if (!Array.isArray(items2)) {
      (0, util_1$h.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
      return;
    }
    validateAdditionalItems(cxt, items2);
  }
};
function validateAdditionalItems(cxt, items2) {
  const { gen, schema, data, keyword: keyword2, it } = cxt;
  it.items = true;
  const len = gen.const("len", (0, codegen_1$e._)`${data}.length`);
  if (schema === false) {
    cxt.setParams({ len: items2.length });
    cxt.pass((0, codegen_1$e._)`${len} <= ${items2.length}`);
  } else if (typeof schema == "object" && !(0, util_1$h.alwaysValidSchema)(it, schema)) {
    const valid2 = gen.var("valid", (0, codegen_1$e._)`${len} <= ${items2.length}`);
    gen.if((0, codegen_1$e.not)(valid2), () => validateItems(valid2));
    cxt.ok(valid2);
  }
  function validateItems(valid2) {
    gen.forRange("i", items2.length, len, (i) => {
      cxt.subschema({ keyword: keyword2, dataProp: i, dataPropType: util_1$h.Type.Num }, valid2);
      if (!it.allErrors)
        gen.if((0, codegen_1$e.not)(valid2), () => gen.break());
    });
  }
}
additionalItems.validateAdditionalItems = validateAdditionalItems;
additionalItems.default = def$p;
var prefixItems = {};
var items = {};
Object.defineProperty(items, "__esModule", { value: true });
items.validateTuple = void 0;
const codegen_1$d = codegen;
const util_1$g = util$1;
const code_1$5 = code;
const def$o = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "array", "boolean"],
  before: "uniqueItems",
  code(cxt) {
    const { schema, it } = cxt;
    if (Array.isArray(schema))
      return validateTuple(cxt, "additionalItems", schema);
    it.items = true;
    if ((0, util_1$g.alwaysValidSchema)(it, schema))
      return;
    cxt.ok((0, code_1$5.validateArray)(cxt));
  }
};
function validateTuple(cxt, extraItems, schArr = cxt.schema) {
  const { gen, parentSchema, data, keyword: keyword2, it } = cxt;
  checkStrictTuple(parentSchema);
  if (it.opts.unevaluated && schArr.length && it.items !== true) {
    it.items = util_1$g.mergeEvaluated.items(gen, schArr.length, it.items);
  }
  const valid2 = gen.name("valid");
  const len = gen.const("len", (0, codegen_1$d._)`${data}.length`);
  schArr.forEach((sch, i) => {
    if ((0, util_1$g.alwaysValidSchema)(it, sch))
      return;
    gen.if((0, codegen_1$d._)`${len} > ${i}`, () => cxt.subschema({
      keyword: keyword2,
      schemaProp: i,
      dataProp: i
    }, valid2));
    cxt.ok(valid2);
  });
  function checkStrictTuple(sch) {
    const { opts, errSchemaPath } = it;
    const l = schArr.length;
    const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
    if (opts.strictTuples && !fullTuple) {
      const msg = `"${keyword2}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
      (0, util_1$g.checkStrictMode)(it, msg, opts.strictTuples);
    }
  }
}
items.validateTuple = validateTuple;
items.default = def$o;
Object.defineProperty(prefixItems, "__esModule", { value: true });
const items_1$1 = items;
const def$n = {
  keyword: "prefixItems",
  type: "array",
  schemaType: ["array"],
  before: "uniqueItems",
  code: (cxt) => (0, items_1$1.validateTuple)(cxt, "items")
};
prefixItems.default = def$n;
var items2020 = {};
Object.defineProperty(items2020, "__esModule", { value: true });
const codegen_1$c = codegen;
const util_1$f = util$1;
const code_1$4 = code;
const additionalItems_1$1 = additionalItems;
const error$9 = {
  message: ({ params: { len } }) => (0, codegen_1$c.str)`must NOT have more than ${len} items`,
  params: ({ params: { len } }) => (0, codegen_1$c._)`{limit: ${len}}`
};
const def$m = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  error: error$9,
  code(cxt) {
    const { schema, parentSchema, it } = cxt;
    const { prefixItems: prefixItems2 } = parentSchema;
    it.items = true;
    if ((0, util_1$f.alwaysValidSchema)(it, schema))
      return;
    if (prefixItems2)
      (0, additionalItems_1$1.validateAdditionalItems)(cxt, prefixItems2);
    else
      cxt.ok((0, code_1$4.validateArray)(cxt));
  }
};
items2020.default = def$m;
var contains = {};
Object.defineProperty(contains, "__esModule", { value: true });
const codegen_1$b = codegen;
const util_1$e = util$1;
const error$8 = {
  message: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1$b.str)`must contain at least ${min} valid item(s)` : (0, codegen_1$b.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
  params: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1$b._)`{minContains: ${min}}` : (0, codegen_1$b._)`{minContains: ${min}, maxContains: ${max}}`
};
const def$l = {
  keyword: "contains",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  trackErrors: true,
  error: error$8,
  code(cxt) {
    const { gen, schema, parentSchema, data, it } = cxt;
    let min;
    let max;
    const { minContains, maxContains } = parentSchema;
    if (it.opts.next) {
      min = minContains === void 0 ? 1 : minContains;
      max = maxContains;
    } else {
      min = 1;
    }
    const len = gen.const("len", (0, codegen_1$b._)`${data}.length`);
    cxt.setParams({ min, max });
    if (max === void 0 && min === 0) {
      (0, util_1$e.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
      return;
    }
    if (max !== void 0 && min > max) {
      (0, util_1$e.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
      cxt.fail();
      return;
    }
    if ((0, util_1$e.alwaysValidSchema)(it, schema)) {
      let cond = (0, codegen_1$b._)`${len} >= ${min}`;
      if (max !== void 0)
        cond = (0, codegen_1$b._)`${cond} && ${len} <= ${max}`;
      cxt.pass(cond);
      return;
    }
    it.items = true;
    const valid2 = gen.name("valid");
    if (max === void 0 && min === 1) {
      validateItems(valid2, () => gen.if(valid2, () => gen.break()));
    } else if (min === 0) {
      gen.let(valid2, true);
      if (max !== void 0)
        gen.if((0, codegen_1$b._)`${data}.length > 0`, validateItemsWithCount);
    } else {
      gen.let(valid2, false);
      validateItemsWithCount();
    }
    cxt.result(valid2, () => cxt.reset());
    function validateItemsWithCount() {
      const schValid = gen.name("_valid");
      const count = gen.let("count", 0);
      validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
    }
    function validateItems(_valid, block) {
      gen.forRange("i", 0, len, (i) => {
        cxt.subschema({
          keyword: "contains",
          dataProp: i,
          dataPropType: util_1$e.Type.Num,
          compositeRule: true
        }, _valid);
        block();
      });
    }
    function checkLimits(count) {
      gen.code((0, codegen_1$b._)`${count}++`);
      if (max === void 0) {
        gen.if((0, codegen_1$b._)`${count} >= ${min}`, () => gen.assign(valid2, true).break());
      } else {
        gen.if((0, codegen_1$b._)`${count} > ${max}`, () => gen.assign(valid2, false).break());
        if (min === 1)
          gen.assign(valid2, true);
        else
          gen.if((0, codegen_1$b._)`${count} >= ${min}`, () => gen.assign(valid2, true));
      }
    }
  }
};
contains.default = def$l;
var dependencies = {};
(function(exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.validateSchemaDeps = exports$1.validatePropertyDeps = exports$1.error = void 0;
  const codegen_12 = codegen;
  const util_12 = util$1;
  const code_12 = code;
  exports$1.error = {
    message: ({ params: { property, depsCount, deps } }) => {
      const property_ies = depsCount === 1 ? "property" : "properties";
      return (0, codegen_12.str)`must have ${property_ies} ${deps} when property ${property} is present`;
    },
    params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_12._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
    // TODO change to reference
  };
  const def2 = {
    keyword: "dependencies",
    type: "object",
    schemaType: "object",
    error: exports$1.error,
    code(cxt) {
      const [propDeps, schDeps] = splitDependencies(cxt);
      validatePropertyDeps(cxt, propDeps);
      validateSchemaDeps(cxt, schDeps);
    }
  };
  function splitDependencies({ schema }) {
    const propertyDeps = {};
    const schemaDeps = {};
    for (const key in schema) {
      if (key === "__proto__")
        continue;
      const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
      deps[key] = schema[key];
    }
    return [propertyDeps, schemaDeps];
  }
  function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
    const { gen, data, it } = cxt;
    if (Object.keys(propertyDeps).length === 0)
      return;
    const missing = gen.let("missing");
    for (const prop in propertyDeps) {
      const deps = propertyDeps[prop];
      if (deps.length === 0)
        continue;
      const hasProperty2 = (0, code_12.propertyInData)(gen, data, prop, it.opts.ownProperties);
      cxt.setParams({
        property: prop,
        depsCount: deps.length,
        deps: deps.join(", ")
      });
      if (it.allErrors) {
        gen.if(hasProperty2, () => {
          for (const depProp of deps) {
            (0, code_12.checkReportMissingProp)(cxt, depProp);
          }
        });
      } else {
        gen.if((0, codegen_12._)`${hasProperty2} && (${(0, code_12.checkMissingProp)(cxt, deps, missing)})`);
        (0, code_12.reportMissingProp)(cxt, missing);
        gen.else();
      }
    }
  }
  exports$1.validatePropertyDeps = validatePropertyDeps;
  function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
    const { gen, data, keyword: keyword2, it } = cxt;
    const valid2 = gen.name("valid");
    for (const prop in schemaDeps) {
      if ((0, util_12.alwaysValidSchema)(it, schemaDeps[prop]))
        continue;
      gen.if(
        (0, code_12.propertyInData)(gen, data, prop, it.opts.ownProperties),
        () => {
          const schCxt = cxt.subschema({ keyword: keyword2, schemaProp: prop }, valid2);
          cxt.mergeValidEvaluated(schCxt, valid2);
        },
        () => gen.var(valid2, true)
        // TODO var
      );
      cxt.ok(valid2);
    }
  }
  exports$1.validateSchemaDeps = validateSchemaDeps;
  exports$1.default = def2;
})(dependencies);
var propertyNames = {};
Object.defineProperty(propertyNames, "__esModule", { value: true });
const codegen_1$a = codegen;
const util_1$d = util$1;
const error$7 = {
  message: "property name must be valid",
  params: ({ params }) => (0, codegen_1$a._)`{propertyName: ${params.propertyName}}`
};
const def$k = {
  keyword: "propertyNames",
  type: "object",
  schemaType: ["object", "boolean"],
  error: error$7,
  code(cxt) {
    const { gen, schema, data, it } = cxt;
    if ((0, util_1$d.alwaysValidSchema)(it, schema))
      return;
    const valid2 = gen.name("valid");
    gen.forIn("key", data, (key) => {
      cxt.setParams({ propertyName: key });
      cxt.subschema({
        keyword: "propertyNames",
        data: key,
        dataTypes: ["string"],
        propertyName: key,
        compositeRule: true
      }, valid2);
      gen.if((0, codegen_1$a.not)(valid2), () => {
        cxt.error(true);
        if (!it.allErrors)
          gen.break();
      });
    });
    cxt.ok(valid2);
  }
};
propertyNames.default = def$k;
var additionalProperties = {};
Object.defineProperty(additionalProperties, "__esModule", { value: true });
const code_1$3 = code;
const codegen_1$9 = codegen;
const names_1$3 = names$1;
const util_1$c = util$1;
const error$6 = {
  message: "must NOT have additional properties",
  params: ({ params }) => (0, codegen_1$9._)`{additionalProperty: ${params.additionalProperty}}`
};
const def$j = {
  keyword: "additionalProperties",
  type: ["object"],
  schemaType: ["boolean", "object"],
  allowUndefined: true,
  trackErrors: true,
  error: error$6,
  code(cxt) {
    const { gen, schema, parentSchema, data, errsCount, it } = cxt;
    if (!errsCount)
      throw new Error("ajv implementation error");
    const { allErrors, opts } = it;
    it.props = true;
    if (opts.removeAdditional !== "all" && (0, util_1$c.alwaysValidSchema)(it, schema))
      return;
    const props = (0, code_1$3.allSchemaProperties)(parentSchema.properties);
    const patProps = (0, code_1$3.allSchemaProperties)(parentSchema.patternProperties);
    checkAdditionalProperties();
    cxt.ok((0, codegen_1$9._)`${errsCount} === ${names_1$3.default.errors}`);
    function checkAdditionalProperties() {
      gen.forIn("key", data, (key) => {
        if (!props.length && !patProps.length)
          additionalPropertyCode(key);
        else
          gen.if(isAdditional(key), () => additionalPropertyCode(key));
      });
    }
    function isAdditional(key) {
      let definedProp;
      if (props.length > 8) {
        const propsSchema = (0, util_1$c.schemaRefOrVal)(it, parentSchema.properties, "properties");
        definedProp = (0, code_1$3.isOwnProperty)(gen, propsSchema, key);
      } else if (props.length) {
        definedProp = (0, codegen_1$9.or)(...props.map((p) => (0, codegen_1$9._)`${key} === ${p}`));
      } else {
        definedProp = codegen_1$9.nil;
      }
      if (patProps.length) {
        definedProp = (0, codegen_1$9.or)(definedProp, ...patProps.map((p) => (0, codegen_1$9._)`${(0, code_1$3.usePattern)(cxt, p)}.test(${key})`));
      }
      return (0, codegen_1$9.not)(definedProp);
    }
    function deleteAdditional(key) {
      gen.code((0, codegen_1$9._)`delete ${data}[${key}]`);
    }
    function additionalPropertyCode(key) {
      if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
        deleteAdditional(key);
        return;
      }
      if (schema === false) {
        cxt.setParams({ additionalProperty: key });
        cxt.error();
        if (!allErrors)
          gen.break();
        return;
      }
      if (typeof schema == "object" && !(0, util_1$c.alwaysValidSchema)(it, schema)) {
        const valid2 = gen.name("valid");
        if (opts.removeAdditional === "failing") {
          applyAdditionalSchema(key, valid2, false);
          gen.if((0, codegen_1$9.not)(valid2), () => {
            cxt.reset();
            deleteAdditional(key);
          });
        } else {
          applyAdditionalSchema(key, valid2);
          if (!allErrors)
            gen.if((0, codegen_1$9.not)(valid2), () => gen.break());
        }
      }
    }
    function applyAdditionalSchema(key, valid2, errors2) {
      const subschema2 = {
        keyword: "additionalProperties",
        dataProp: key,
        dataPropType: util_1$c.Type.Str
      };
      if (errors2 === false) {
        Object.assign(subschema2, {
          compositeRule: true,
          createErrors: false,
          allErrors: false
        });
      }
      cxt.subschema(subschema2, valid2);
    }
  }
};
additionalProperties.default = def$j;
var properties$9 = {};
Object.defineProperty(properties$9, "__esModule", { value: true });
const validate_1 = validate;
const code_1$2 = code;
const util_1$b = util$1;
const additionalProperties_1$1 = additionalProperties;
const def$i = {
  keyword: "properties",
  type: "object",
  schemaType: "object",
  code(cxt) {
    const { gen, schema, parentSchema, data, it } = cxt;
    if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0) {
      additionalProperties_1$1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1$1.default, "additionalProperties"));
    }
    const allProps = (0, code_1$2.allSchemaProperties)(schema);
    for (const prop of allProps) {
      it.definedProperties.add(prop);
    }
    if (it.opts.unevaluated && allProps.length && it.props !== true) {
      it.props = util_1$b.mergeEvaluated.props(gen, (0, util_1$b.toHash)(allProps), it.props);
    }
    const properties2 = allProps.filter((p) => !(0, util_1$b.alwaysValidSchema)(it, schema[p]));
    if (properties2.length === 0)
      return;
    const valid2 = gen.name("valid");
    for (const prop of properties2) {
      if (hasDefault(prop)) {
        applyPropertySchema(prop);
      } else {
        gen.if((0, code_1$2.propertyInData)(gen, data, prop, it.opts.ownProperties));
        applyPropertySchema(prop);
        if (!it.allErrors)
          gen.else().var(valid2, true);
        gen.endIf();
      }
      cxt.it.definedProperties.add(prop);
      cxt.ok(valid2);
    }
    function hasDefault(prop) {
      return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
    }
    function applyPropertySchema(prop) {
      cxt.subschema({
        keyword: "properties",
        schemaProp: prop,
        dataProp: prop
      }, valid2);
    }
  }
};
properties$9.default = def$i;
var patternProperties = {};
Object.defineProperty(patternProperties, "__esModule", { value: true });
const code_1$1 = code;
const codegen_1$8 = codegen;
const util_1$a = util$1;
const util_2 = util$1;
const def$h = {
  keyword: "patternProperties",
  type: "object",
  schemaType: "object",
  code(cxt) {
    const { gen, schema, data, parentSchema, it } = cxt;
    const { opts } = it;
    const patterns = (0, code_1$1.allSchemaProperties)(schema);
    const alwaysValidPatterns = patterns.filter((p) => (0, util_1$a.alwaysValidSchema)(it, schema[p]));
    if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
      return;
    }
    const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
    const valid2 = gen.name("valid");
    if (it.props !== true && !(it.props instanceof codegen_1$8.Name)) {
      it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
    }
    const { props } = it;
    validatePatternProperties();
    function validatePatternProperties() {
      for (const pat of patterns) {
        if (checkProperties)
          checkMatchingProperties(pat);
        if (it.allErrors) {
          validateProperties(pat);
        } else {
          gen.var(valid2, true);
          validateProperties(pat);
          gen.if(valid2);
        }
      }
    }
    function checkMatchingProperties(pat) {
      for (const prop in checkProperties) {
        if (new RegExp(pat).test(prop)) {
          (0, util_1$a.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
        }
      }
    }
    function validateProperties(pat) {
      gen.forIn("key", data, (key) => {
        gen.if((0, codegen_1$8._)`${(0, code_1$1.usePattern)(cxt, pat)}.test(${key})`, () => {
          const alwaysValid = alwaysValidPatterns.includes(pat);
          if (!alwaysValid) {
            cxt.subschema({
              keyword: "patternProperties",
              schemaProp: pat,
              dataProp: key,
              dataPropType: util_2.Type.Str
            }, valid2);
          }
          if (it.opts.unevaluated && props !== true) {
            gen.assign((0, codegen_1$8._)`${props}[${key}]`, true);
          } else if (!alwaysValid && !it.allErrors) {
            gen.if((0, codegen_1$8.not)(valid2), () => gen.break());
          }
        });
      });
    }
  }
};
patternProperties.default = def$h;
var not = {};
Object.defineProperty(not, "__esModule", { value: true });
const util_1$9 = util$1;
const def$g = {
  keyword: "not",
  schemaType: ["object", "boolean"],
  trackErrors: true,
  code(cxt) {
    const { gen, schema, it } = cxt;
    if ((0, util_1$9.alwaysValidSchema)(it, schema)) {
      cxt.fail();
      return;
    }
    const valid2 = gen.name("valid");
    cxt.subschema({
      keyword: "not",
      compositeRule: true,
      createErrors: false,
      allErrors: false
    }, valid2);
    cxt.failResult(valid2, () => cxt.reset(), () => cxt.error());
  },
  error: { message: "must NOT be valid" }
};
not.default = def$g;
var anyOf = {};
Object.defineProperty(anyOf, "__esModule", { value: true });
const code_1 = code;
const def$f = {
  keyword: "anyOf",
  schemaType: "array",
  trackErrors: true,
  code: code_1.validateUnion,
  error: { message: "must match a schema in anyOf" }
};
anyOf.default = def$f;
var oneOf = {};
Object.defineProperty(oneOf, "__esModule", { value: true });
const codegen_1$7 = codegen;
const util_1$8 = util$1;
const error$5 = {
  message: "must match exactly one schema in oneOf",
  params: ({ params }) => (0, codegen_1$7._)`{passingSchemas: ${params.passing}}`
};
const def$e = {
  keyword: "oneOf",
  schemaType: "array",
  trackErrors: true,
  error: error$5,
  code(cxt) {
    const { gen, schema, parentSchema, it } = cxt;
    if (!Array.isArray(schema))
      throw new Error("ajv implementation error");
    if (it.opts.discriminator && parentSchema.discriminator)
      return;
    const schArr = schema;
    const valid2 = gen.let("valid", false);
    const passing = gen.let("passing", null);
    const schValid = gen.name("_valid");
    cxt.setParams({ passing });
    gen.block(validateOneOf);
    cxt.result(valid2, () => cxt.reset(), () => cxt.error(true));
    function validateOneOf() {
      schArr.forEach((sch, i) => {
        let schCxt;
        if ((0, util_1$8.alwaysValidSchema)(it, sch)) {
          gen.var(schValid, true);
        } else {
          schCxt = cxt.subschema({
            keyword: "oneOf",
            schemaProp: i,
            compositeRule: true
          }, schValid);
        }
        if (i > 0) {
          gen.if((0, codegen_1$7._)`${schValid} && ${valid2}`).assign(valid2, false).assign(passing, (0, codegen_1$7._)`[${passing}, ${i}]`).else();
        }
        gen.if(schValid, () => {
          gen.assign(valid2, true);
          gen.assign(passing, i);
          if (schCxt)
            cxt.mergeEvaluated(schCxt, codegen_1$7.Name);
        });
      });
    }
  }
};
oneOf.default = def$e;
var allOf$1 = {};
Object.defineProperty(allOf$1, "__esModule", { value: true });
const util_1$7 = util$1;
const def$d = {
  keyword: "allOf",
  schemaType: "array",
  code(cxt) {
    const { gen, schema, it } = cxt;
    if (!Array.isArray(schema))
      throw new Error("ajv implementation error");
    const valid2 = gen.name("valid");
    schema.forEach((sch, i) => {
      if ((0, util_1$7.alwaysValidSchema)(it, sch))
        return;
      const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid2);
      cxt.ok(valid2);
      cxt.mergeEvaluated(schCxt);
    });
  }
};
allOf$1.default = def$d;
var _if = {};
Object.defineProperty(_if, "__esModule", { value: true });
const codegen_1$6 = codegen;
const util_1$6 = util$1;
const error$4 = {
  message: ({ params }) => (0, codegen_1$6.str)`must match "${params.ifClause}" schema`,
  params: ({ params }) => (0, codegen_1$6._)`{failingKeyword: ${params.ifClause}}`
};
const def$c = {
  keyword: "if",
  schemaType: ["object", "boolean"],
  trackErrors: true,
  error: error$4,
  code(cxt) {
    const { gen, parentSchema, it } = cxt;
    if (parentSchema.then === void 0 && parentSchema.else === void 0) {
      (0, util_1$6.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
    }
    const hasThen = hasSchema(it, "then");
    const hasElse = hasSchema(it, "else");
    if (!hasThen && !hasElse)
      return;
    const valid2 = gen.let("valid", true);
    const schValid = gen.name("_valid");
    validateIf();
    cxt.reset();
    if (hasThen && hasElse) {
      const ifClause = gen.let("ifClause");
      cxt.setParams({ ifClause });
      gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
    } else if (hasThen) {
      gen.if(schValid, validateClause("then"));
    } else {
      gen.if((0, codegen_1$6.not)(schValid), validateClause("else"));
    }
    cxt.pass(valid2, () => cxt.error(true));
    function validateIf() {
      const schCxt = cxt.subschema({
        keyword: "if",
        compositeRule: true,
        createErrors: false,
        allErrors: false
      }, schValid);
      cxt.mergeEvaluated(schCxt);
    }
    function validateClause(keyword2, ifClause) {
      return () => {
        const schCxt = cxt.subschema({ keyword: keyword2 }, schValid);
        gen.assign(valid2, schValid);
        cxt.mergeValidEvaluated(schCxt, valid2);
        if (ifClause)
          gen.assign(ifClause, (0, codegen_1$6._)`${keyword2}`);
        else
          cxt.setParams({ ifClause: keyword2 });
      };
    }
  }
};
function hasSchema(it, keyword2) {
  const schema = it.schema[keyword2];
  return schema !== void 0 && !(0, util_1$6.alwaysValidSchema)(it, schema);
}
_if.default = def$c;
var thenElse = {};
Object.defineProperty(thenElse, "__esModule", { value: true });
const util_1$5 = util$1;
const def$b = {
  keyword: ["then", "else"],
  schemaType: ["object", "boolean"],
  code({ keyword: keyword2, parentSchema, it }) {
    if (parentSchema.if === void 0)
      (0, util_1$5.checkStrictMode)(it, `"${keyword2}" without "if" is ignored`);
  }
};
thenElse.default = def$b;
Object.defineProperty(applicator$1, "__esModule", { value: true });
const additionalItems_1 = additionalItems;
const prefixItems_1 = prefixItems;
const items_1 = items;
const items2020_1 = items2020;
const contains_1 = contains;
const dependencies_1$2 = dependencies;
const propertyNames_1 = propertyNames;
const additionalProperties_1 = additionalProperties;
const properties_1 = properties$9;
const patternProperties_1 = patternProperties;
const not_1 = not;
const anyOf_1 = anyOf;
const oneOf_1 = oneOf;
const allOf_1 = allOf$1;
const if_1 = _if;
const thenElse_1 = thenElse;
function getApplicator(draft20202 = false) {
  const applicator2 = [
    // any
    not_1.default,
    anyOf_1.default,
    oneOf_1.default,
    allOf_1.default,
    if_1.default,
    thenElse_1.default,
    // object
    propertyNames_1.default,
    additionalProperties_1.default,
    dependencies_1$2.default,
    properties_1.default,
    patternProperties_1.default
  ];
  if (draft20202)
    applicator2.push(prefixItems_1.default, items2020_1.default);
  else
    applicator2.push(additionalItems_1.default, items_1.default);
  applicator2.push(contains_1.default);
  return applicator2;
}
applicator$1.default = getApplicator;
var dynamic$1 = {};
var dynamicAnchor$1 = {};
Object.defineProperty(dynamicAnchor$1, "__esModule", { value: true });
dynamicAnchor$1.dynamicAnchor = void 0;
const codegen_1$5 = codegen;
const names_1$2 = names$1;
const compile_1$1 = compile;
const ref_1$1 = ref;
const def$a = {
  keyword: "$dynamicAnchor",
  schemaType: "string",
  code: (cxt) => dynamicAnchor(cxt, cxt.schema)
};
function dynamicAnchor(cxt, anchor) {
  const { gen, it } = cxt;
  it.schemaEnv.root.dynamicAnchors[anchor] = true;
  const v = (0, codegen_1$5._)`${names_1$2.default.dynamicAnchors}${(0, codegen_1$5.getProperty)(anchor)}`;
  const validate2 = it.errSchemaPath === "#" ? it.validateName : _getValidate(cxt);
  gen.if((0, codegen_1$5._)`!${v}`, () => gen.assign(v, validate2));
}
dynamicAnchor$1.dynamicAnchor = dynamicAnchor;
function _getValidate(cxt) {
  const { schemaEnv, schema, self: self2 } = cxt.it;
  const { root, baseId, localRefs, meta } = schemaEnv.root;
  const { schemaId } = self2.opts;
  const sch = new compile_1$1.SchemaEnv({ schema, schemaId, root, baseId, localRefs, meta });
  compile_1$1.compileSchema.call(self2, sch);
  return (0, ref_1$1.getValidate)(cxt, sch);
}
dynamicAnchor$1.default = def$a;
var dynamicRef$1 = {};
Object.defineProperty(dynamicRef$1, "__esModule", { value: true });
dynamicRef$1.dynamicRef = void 0;
const codegen_1$4 = codegen;
const names_1$1 = names$1;
const ref_1 = ref;
const def$9 = {
  keyword: "$dynamicRef",
  schemaType: "string",
  code: (cxt) => dynamicRef(cxt, cxt.schema)
};
function dynamicRef(cxt, ref2) {
  const { gen, keyword: keyword2, it } = cxt;
  if (ref2[0] !== "#")
    throw new Error(`"${keyword2}" only supports hash fragment reference`);
  const anchor = ref2.slice(1);
  if (it.allErrors) {
    _dynamicRef();
  } else {
    const valid2 = gen.let("valid", false);
    _dynamicRef(valid2);
    cxt.ok(valid2);
  }
  function _dynamicRef(valid2) {
    if (it.schemaEnv.root.dynamicAnchors[anchor]) {
      const v = gen.let("_v", (0, codegen_1$4._)`${names_1$1.default.dynamicAnchors}${(0, codegen_1$4.getProperty)(anchor)}`);
      gen.if(v, _callRef(v, valid2), _callRef(it.validateName, valid2));
    } else {
      _callRef(it.validateName, valid2)();
    }
  }
  function _callRef(validate2, valid2) {
    return valid2 ? () => gen.block(() => {
      (0, ref_1.callRef)(cxt, validate2);
      gen.let(valid2, true);
    }) : () => (0, ref_1.callRef)(cxt, validate2);
  }
}
dynamicRef$1.dynamicRef = dynamicRef;
dynamicRef$1.default = def$9;
var recursiveAnchor = {};
Object.defineProperty(recursiveAnchor, "__esModule", { value: true });
const dynamicAnchor_1$1 = dynamicAnchor$1;
const util_1$4 = util$1;
const def$8 = {
  keyword: "$recursiveAnchor",
  schemaType: "boolean",
  code(cxt) {
    if (cxt.schema)
      (0, dynamicAnchor_1$1.dynamicAnchor)(cxt, "");
    else
      (0, util_1$4.checkStrictMode)(cxt.it, "$recursiveAnchor: false is ignored");
  }
};
recursiveAnchor.default = def$8;
var recursiveRef = {};
Object.defineProperty(recursiveRef, "__esModule", { value: true });
const dynamicRef_1$1 = dynamicRef$1;
const def$7 = {
  keyword: "$recursiveRef",
  schemaType: "string",
  code: (cxt) => (0, dynamicRef_1$1.dynamicRef)(cxt, cxt.schema)
};
recursiveRef.default = def$7;
Object.defineProperty(dynamic$1, "__esModule", { value: true });
const dynamicAnchor_1 = dynamicAnchor$1;
const dynamicRef_1 = dynamicRef$1;
const recursiveAnchor_1 = recursiveAnchor;
const recursiveRef_1 = recursiveRef;
const dynamic = [dynamicAnchor_1.default, dynamicRef_1.default, recursiveAnchor_1.default, recursiveRef_1.default];
dynamic$1.default = dynamic;
var next$1 = {};
var dependentRequired = {};
Object.defineProperty(dependentRequired, "__esModule", { value: true });
const dependencies_1$1 = dependencies;
const def$6 = {
  keyword: "dependentRequired",
  type: "object",
  schemaType: "object",
  error: dependencies_1$1.error,
  code: (cxt) => (0, dependencies_1$1.validatePropertyDeps)(cxt)
};
dependentRequired.default = def$6;
var dependentSchemas = {};
Object.defineProperty(dependentSchemas, "__esModule", { value: true });
const dependencies_1 = dependencies;
const def$5 = {
  keyword: "dependentSchemas",
  type: "object",
  schemaType: "object",
  code: (cxt) => (0, dependencies_1.validateSchemaDeps)(cxt)
};
dependentSchemas.default = def$5;
var limitContains = {};
Object.defineProperty(limitContains, "__esModule", { value: true });
const util_1$3 = util$1;
const def$4 = {
  keyword: ["maxContains", "minContains"],
  type: "array",
  schemaType: "number",
  code({ keyword: keyword2, parentSchema, it }) {
    if (parentSchema.contains === void 0) {
      (0, util_1$3.checkStrictMode)(it, `"${keyword2}" without "contains" is ignored`);
    }
  }
};
limitContains.default = def$4;
Object.defineProperty(next$1, "__esModule", { value: true });
const dependentRequired_1 = dependentRequired;
const dependentSchemas_1 = dependentSchemas;
const limitContains_1 = limitContains;
const next = [dependentRequired_1.default, dependentSchemas_1.default, limitContains_1.default];
next$1.default = next;
var unevaluated$2 = {};
var unevaluatedProperties = {};
Object.defineProperty(unevaluatedProperties, "__esModule", { value: true });
const codegen_1$3 = codegen;
const util_1$2 = util$1;
const names_1 = names$1;
const error$3 = {
  message: "must NOT have unevaluated properties",
  params: ({ params }) => (0, codegen_1$3._)`{unevaluatedProperty: ${params.unevaluatedProperty}}`
};
const def$3 = {
  keyword: "unevaluatedProperties",
  type: "object",
  schemaType: ["boolean", "object"],
  trackErrors: true,
  error: error$3,
  code(cxt) {
    const { gen, schema, data, errsCount, it } = cxt;
    if (!errsCount)
      throw new Error("ajv implementation error");
    const { allErrors, props } = it;
    if (props instanceof codegen_1$3.Name) {
      gen.if((0, codegen_1$3._)`${props} !== true`, () => gen.forIn("key", data, (key) => gen.if(unevaluatedDynamic(props, key), () => unevaluatedPropCode(key))));
    } else if (props !== true) {
      gen.forIn("key", data, (key) => props === void 0 ? unevaluatedPropCode(key) : gen.if(unevaluatedStatic(props, key), () => unevaluatedPropCode(key)));
    }
    it.props = true;
    cxt.ok((0, codegen_1$3._)`${errsCount} === ${names_1.default.errors}`);
    function unevaluatedPropCode(key) {
      if (schema === false) {
        cxt.setParams({ unevaluatedProperty: key });
        cxt.error();
        if (!allErrors)
          gen.break();
        return;
      }
      if (!(0, util_1$2.alwaysValidSchema)(it, schema)) {
        const valid2 = gen.name("valid");
        cxt.subschema({
          keyword: "unevaluatedProperties",
          dataProp: key,
          dataPropType: util_1$2.Type.Str
        }, valid2);
        if (!allErrors)
          gen.if((0, codegen_1$3.not)(valid2), () => gen.break());
      }
    }
    function unevaluatedDynamic(evaluatedProps, key) {
      return (0, codegen_1$3._)`!${evaluatedProps} || !${evaluatedProps}[${key}]`;
    }
    function unevaluatedStatic(evaluatedProps, key) {
      const ps = [];
      for (const p in evaluatedProps) {
        if (evaluatedProps[p] === true)
          ps.push((0, codegen_1$3._)`${key} !== ${p}`);
      }
      return (0, codegen_1$3.and)(...ps);
    }
  }
};
unevaluatedProperties.default = def$3;
var unevaluatedItems = {};
Object.defineProperty(unevaluatedItems, "__esModule", { value: true });
const codegen_1$2 = codegen;
const util_1$1 = util$1;
const error$2 = {
  message: ({ params: { len } }) => (0, codegen_1$2.str)`must NOT have more than ${len} items`,
  params: ({ params: { len } }) => (0, codegen_1$2._)`{limit: ${len}}`
};
const def$2 = {
  keyword: "unevaluatedItems",
  type: "array",
  schemaType: ["boolean", "object"],
  error: error$2,
  code(cxt) {
    const { gen, schema, data, it } = cxt;
    const items2 = it.items || 0;
    if (items2 === true)
      return;
    const len = gen.const("len", (0, codegen_1$2._)`${data}.length`);
    if (schema === false) {
      cxt.setParams({ len: items2 });
      cxt.fail((0, codegen_1$2._)`${len} > ${items2}`);
    } else if (typeof schema == "object" && !(0, util_1$1.alwaysValidSchema)(it, schema)) {
      const valid2 = gen.var("valid", (0, codegen_1$2._)`${len} <= ${items2}`);
      gen.if((0, codegen_1$2.not)(valid2), () => validateItems(valid2, items2));
      cxt.ok(valid2);
    }
    it.items = true;
    function validateItems(valid2, from) {
      gen.forRange("i", from, len, (i) => {
        cxt.subschema({ keyword: "unevaluatedItems", dataProp: i, dataPropType: util_1$1.Type.Num }, valid2);
        if (!it.allErrors)
          gen.if((0, codegen_1$2.not)(valid2), () => gen.break());
      });
    }
  }
};
unevaluatedItems.default = def$2;
Object.defineProperty(unevaluated$2, "__esModule", { value: true });
const unevaluatedProperties_1 = unevaluatedProperties;
const unevaluatedItems_1 = unevaluatedItems;
const unevaluated$1 = [unevaluatedProperties_1.default, unevaluatedItems_1.default];
unevaluated$2.default = unevaluated$1;
var format$3 = {};
var format$2 = {};
Object.defineProperty(format$2, "__esModule", { value: true });
const codegen_1$1 = codegen;
const error$1 = {
  message: ({ schemaCode }) => (0, codegen_1$1.str)`must match format "${schemaCode}"`,
  params: ({ schemaCode }) => (0, codegen_1$1._)`{format: ${schemaCode}}`
};
const def$1 = {
  keyword: "format",
  type: ["number", "string"],
  schemaType: "string",
  $data: true,
  error: error$1,
  code(cxt, ruleType) {
    const { gen, data, $data, schema, schemaCode, it } = cxt;
    const { opts, errSchemaPath, schemaEnv, self: self2 } = it;
    if (!opts.validateFormats)
      return;
    if ($data)
      validate$DataFormat();
    else
      validateFormat();
    function validate$DataFormat() {
      const fmts = gen.scopeValue("formats", {
        ref: self2.formats,
        code: opts.code.formats
      });
      const fDef = gen.const("fDef", (0, codegen_1$1._)`${fmts}[${schemaCode}]`);
      const fType = gen.let("fType");
      const format2 = gen.let("format");
      gen.if((0, codegen_1$1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1$1._)`${fDef}.type || "string"`).assign(format2, (0, codegen_1$1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1$1._)`"string"`).assign(format2, fDef));
      cxt.fail$data((0, codegen_1$1.or)(unknownFmt(), invalidFmt()));
      function unknownFmt() {
        if (opts.strictSchema === false)
          return codegen_1$1.nil;
        return (0, codegen_1$1._)`${schemaCode} && !${format2}`;
      }
      function invalidFmt() {
        const callFormat = schemaEnv.$async ? (0, codegen_1$1._)`(${fDef}.async ? await ${format2}(${data}) : ${format2}(${data}))` : (0, codegen_1$1._)`${format2}(${data})`;
        const validData = (0, codegen_1$1._)`(typeof ${format2} == "function" ? ${callFormat} : ${format2}.test(${data}))`;
        return (0, codegen_1$1._)`${format2} && ${format2} !== true && ${fType} === ${ruleType} && !${validData}`;
      }
    }
    function validateFormat() {
      const formatDef = self2.formats[schema];
      if (!formatDef) {
        unknownFormat();
        return;
      }
      if (formatDef === true)
        return;
      const [fmtType, format2, fmtRef] = getFormat(formatDef);
      if (fmtType === ruleType)
        cxt.pass(validCondition());
      function unknownFormat() {
        if (opts.strictSchema === false) {
          self2.logger.warn(unknownMsg());
          return;
        }
        throw new Error(unknownMsg());
        function unknownMsg() {
          return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
        }
      }
      function getFormat(fmtDef) {
        const code2 = fmtDef instanceof RegExp ? (0, codegen_1$1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1$1._)`${opts.code.formats}${(0, codegen_1$1.getProperty)(schema)}` : void 0;
        const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code: code2 });
        if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
          return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1$1._)`${fmt}.validate`];
        }
        return ["string", fmtDef, fmt];
      }
      function validCondition() {
        if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
          if (!schemaEnv.$async)
            throw new Error("async format in sync schema");
          return (0, codegen_1$1._)`await ${fmtRef}(${data})`;
        }
        return typeof format2 == "function" ? (0, codegen_1$1._)`${fmtRef}(${data})` : (0, codegen_1$1._)`${fmtRef}.test(${data})`;
      }
    }
  }
};
format$2.default = def$1;
Object.defineProperty(format$3, "__esModule", { value: true });
const format_1$2 = format$2;
const format$1 = [format_1$2.default];
format$3.default = format$1;
var metadata$1 = {};
Object.defineProperty(metadata$1, "__esModule", { value: true });
metadata$1.contentVocabulary = metadata$1.metadataVocabulary = void 0;
metadata$1.metadataVocabulary = [
  "title",
  "description",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "examples"
];
metadata$1.contentVocabulary = [
  "contentMediaType",
  "contentEncoding",
  "contentSchema"
];
Object.defineProperty(draft2020, "__esModule", { value: true });
const core_1$1 = core$2;
const validation_1$1 = validation$2;
const applicator_1$1 = applicator$1;
const dynamic_1 = dynamic$1;
const next_1 = next$1;
const unevaluated_1 = unevaluated$2;
const format_1$1 = format$3;
const metadata_1$1 = metadata$1;
const draft2020Vocabularies = [
  dynamic_1.default,
  core_1$1.default,
  validation_1$1.default,
  (0, applicator_1$1.default)(true),
  format_1$1.default,
  metadata_1$1.metadataVocabulary,
  metadata_1$1.contentVocabulary,
  next_1.default,
  unevaluated_1.default
];
draft2020.default = draft2020Vocabularies;
var discriminator = {};
var types = {};
Object.defineProperty(types, "__esModule", { value: true });
types.DiscrError = void 0;
var DiscrError;
(function(DiscrError2) {
  DiscrError2["Tag"] = "tag";
  DiscrError2["Mapping"] = "mapping";
})(DiscrError || (types.DiscrError = DiscrError = {}));
Object.defineProperty(discriminator, "__esModule", { value: true });
const codegen_1 = codegen;
const types_1 = types;
const compile_1 = compile;
const ref_error_1 = ref_error;
const util_1 = util$1;
const error = {
  message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
  params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
};
const def = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error,
  code(cxt) {
    const { gen, data, schema, parentSchema, it } = cxt;
    const { oneOf: oneOf2 } = parentSchema;
    if (!it.opts.discriminator) {
      throw new Error("discriminator: requires discriminator option");
    }
    const tagName = schema.propertyName;
    if (typeof tagName != "string")
      throw new Error("discriminator: requires propertyName");
    if (schema.mapping)
      throw new Error("discriminator: mapping is not supported");
    if (!oneOf2)
      throw new Error("discriminator: requires oneOf keyword");
    const valid2 = gen.let("valid", false);
    const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
    gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
    cxt.ok(valid2);
    function validateMapping() {
      const mapping = getMapping();
      gen.if(false);
      for (const tagValue in mapping) {
        gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
        gen.assign(valid2, applyTagSchema(mapping[tagValue]));
      }
      gen.else();
      cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
      gen.endIf();
    }
    function applyTagSchema(schemaProp) {
      const _valid = gen.name("valid");
      const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
      cxt.mergeEvaluated(schCxt, codegen_1.Name);
      return _valid;
    }
    function getMapping() {
      var _a;
      const oneOfMapping = {};
      const topRequired = hasRequired(parentSchema);
      let tagRequired = true;
      for (let i = 0; i < oneOf2.length; i++) {
        let sch = oneOf2[i];
        if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
          const ref2 = sch.$ref;
          sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref2);
          if (sch instanceof compile_1.SchemaEnv)
            sch = sch.schema;
          if (sch === void 0)
            throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref2);
        }
        const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
        if (typeof propSch != "object") {
          throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
        }
        tagRequired = tagRequired && (topRequired || hasRequired(sch));
        addMappings(propSch, i);
      }
      if (!tagRequired)
        throw new Error(`discriminator: "${tagName}" must be required`);
      return oneOfMapping;
      function hasRequired({ required: required2 }) {
        return Array.isArray(required2) && required2.includes(tagName);
      }
      function addMappings(sch, i) {
        if (sch.const) {
          addMapping(sch.const, i);
        } else if (sch.enum) {
          for (const tagValue of sch.enum) {
            addMapping(tagValue, i);
          }
        } else {
          throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
        }
      }
      function addMapping(tagValue, i) {
        if (typeof tagValue != "string" || tagValue in oneOfMapping) {
          throw new Error(`discriminator: "${tagName}" values must be unique strings`);
        }
        oneOfMapping[tagValue] = i;
      }
    }
  }
};
discriminator.default = def;
var jsonSchema202012 = {};
const $schema$8 = "https://json-schema.org/draft/2020-12/schema";
const $id$8 = "https://json-schema.org/draft/2020-12/schema";
const $vocabulary$7 = {
  "https://json-schema.org/draft/2020-12/vocab/core": true,
  "https://json-schema.org/draft/2020-12/vocab/applicator": true,
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
  "https://json-schema.org/draft/2020-12/vocab/validation": true,
  "https://json-schema.org/draft/2020-12/vocab/meta-data": true,
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": true,
  "https://json-schema.org/draft/2020-12/vocab/content": true
};
const $dynamicAnchor$7 = "meta";
const title$8 = "Core and Validation specifications meta-schema";
const allOf = [
  {
    $ref: "meta/core"
  },
  {
    $ref: "meta/applicator"
  },
  {
    $ref: "meta/unevaluated"
  },
  {
    $ref: "meta/validation"
  },
  {
    $ref: "meta/meta-data"
  },
  {
    $ref: "meta/format-annotation"
  },
  {
    $ref: "meta/content"
  }
];
const type$8 = [
  "object",
  "boolean"
];
const $comment = "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.";
const properties$8 = {
  definitions: {
    $comment: '"definitions" has been replaced by "$defs".',
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    deprecated: true,
    "default": {}
  },
  dependencies: {
    $comment: '"dependencies" has been split and replaced by "dependentSchemas" and "dependentRequired" in order to serve their differing semantics.',
    type: "object",
    additionalProperties: {
      anyOf: [
        {
          $dynamicRef: "#meta"
        },
        {
          $ref: "meta/validation#/$defs/stringArray"
        }
      ]
    },
    deprecated: true,
    "default": {}
  },
  $recursiveAnchor: {
    $comment: '"$recursiveAnchor" has been replaced by "$dynamicAnchor".',
    $ref: "meta/core#/$defs/anchorString",
    deprecated: true
  },
  $recursiveRef: {
    $comment: '"$recursiveRef" has been replaced by "$dynamicRef".',
    $ref: "meta/core#/$defs/uriReferenceString",
    deprecated: true
  }
};
const require$$0 = {
  $schema: $schema$8,
  $id: $id$8,
  $vocabulary: $vocabulary$7,
  $dynamicAnchor: $dynamicAnchor$7,
  title: title$8,
  allOf,
  type: type$8,
  $comment,
  properties: properties$8
};
const $schema$7 = "https://json-schema.org/draft/2020-12/schema";
const $id$7 = "https://json-schema.org/draft/2020-12/meta/applicator";
const $vocabulary$6 = {
  "https://json-schema.org/draft/2020-12/vocab/applicator": true
};
const $dynamicAnchor$6 = "meta";
const title$7 = "Applicator vocabulary meta-schema";
const type$7 = [
  "object",
  "boolean"
];
const properties$7 = {
  prefixItems: {
    $ref: "#/$defs/schemaArray"
  },
  items: {
    $dynamicRef: "#meta"
  },
  contains: {
    $dynamicRef: "#meta"
  },
  additionalProperties: {
    $dynamicRef: "#meta"
  },
  properties: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    "default": {}
  },
  patternProperties: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    propertyNames: {
      format: "regex"
    },
    "default": {}
  },
  dependentSchemas: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    "default": {}
  },
  propertyNames: {
    $dynamicRef: "#meta"
  },
  "if": {
    $dynamicRef: "#meta"
  },
  then: {
    $dynamicRef: "#meta"
  },
  "else": {
    $dynamicRef: "#meta"
  },
  allOf: {
    $ref: "#/$defs/schemaArray"
  },
  anyOf: {
    $ref: "#/$defs/schemaArray"
  },
  oneOf: {
    $ref: "#/$defs/schemaArray"
  },
  not: {
    $dynamicRef: "#meta"
  }
};
const $defs$2 = {
  schemaArray: {
    type: "array",
    minItems: 1,
    items: {
      $dynamicRef: "#meta"
    }
  }
};
const require$$1 = {
  $schema: $schema$7,
  $id: $id$7,
  $vocabulary: $vocabulary$6,
  $dynamicAnchor: $dynamicAnchor$6,
  title: title$7,
  type: type$7,
  properties: properties$7,
  $defs: $defs$2
};
const $schema$6 = "https://json-schema.org/draft/2020-12/schema";
const $id$6 = "https://json-schema.org/draft/2020-12/meta/unevaluated";
const $vocabulary$5 = {
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": true
};
const $dynamicAnchor$5 = "meta";
const title$6 = "Unevaluated applicator vocabulary meta-schema";
const type$6 = [
  "object",
  "boolean"
];
const properties$6 = {
  unevaluatedItems: {
    $dynamicRef: "#meta"
  },
  unevaluatedProperties: {
    $dynamicRef: "#meta"
  }
};
const require$$2 = {
  $schema: $schema$6,
  $id: $id$6,
  $vocabulary: $vocabulary$5,
  $dynamicAnchor: $dynamicAnchor$5,
  title: title$6,
  type: type$6,
  properties: properties$6
};
const $schema$5 = "https://json-schema.org/draft/2020-12/schema";
const $id$5 = "https://json-schema.org/draft/2020-12/meta/content";
const $vocabulary$4 = {
  "https://json-schema.org/draft/2020-12/vocab/content": true
};
const $dynamicAnchor$4 = "meta";
const title$5 = "Content vocabulary meta-schema";
const type$5 = [
  "object",
  "boolean"
];
const properties$5 = {
  contentEncoding: {
    type: "string"
  },
  contentMediaType: {
    type: "string"
  },
  contentSchema: {
    $dynamicRef: "#meta"
  }
};
const require$$3$1 = {
  $schema: $schema$5,
  $id: $id$5,
  $vocabulary: $vocabulary$4,
  $dynamicAnchor: $dynamicAnchor$4,
  title: title$5,
  type: type$5,
  properties: properties$5
};
const $schema$4 = "https://json-schema.org/draft/2020-12/schema";
const $id$4 = "https://json-schema.org/draft/2020-12/meta/core";
const $vocabulary$3 = {
  "https://json-schema.org/draft/2020-12/vocab/core": true
};
const $dynamicAnchor$3 = "meta";
const title$4 = "Core vocabulary meta-schema";
const type$4 = [
  "object",
  "boolean"
];
const properties$4 = {
  $id: {
    $ref: "#/$defs/uriReferenceString",
    $comment: "Non-empty fragments not allowed.",
    pattern: "^[^#]*#?$"
  },
  $schema: {
    $ref: "#/$defs/uriString"
  },
  $ref: {
    $ref: "#/$defs/uriReferenceString"
  },
  $anchor: {
    $ref: "#/$defs/anchorString"
  },
  $dynamicRef: {
    $ref: "#/$defs/uriReferenceString"
  },
  $dynamicAnchor: {
    $ref: "#/$defs/anchorString"
  },
  $vocabulary: {
    type: "object",
    propertyNames: {
      $ref: "#/$defs/uriString"
    },
    additionalProperties: {
      type: "boolean"
    }
  },
  $comment: {
    type: "string"
  },
  $defs: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    }
  }
};
const $defs$1 = {
  anchorString: {
    type: "string",
    pattern: "^[A-Za-z_][-A-Za-z0-9._]*$"
  },
  uriString: {
    type: "string",
    format: "uri"
  },
  uriReferenceString: {
    type: "string",
    format: "uri-reference"
  }
};
const require$$4 = {
  $schema: $schema$4,
  $id: $id$4,
  $vocabulary: $vocabulary$3,
  $dynamicAnchor: $dynamicAnchor$3,
  title: title$4,
  type: type$4,
  properties: properties$4,
  $defs: $defs$1
};
const $schema$3 = "https://json-schema.org/draft/2020-12/schema";
const $id$3 = "https://json-schema.org/draft/2020-12/meta/format-annotation";
const $vocabulary$2 = {
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": true
};
const $dynamicAnchor$2 = "meta";
const title$3 = "Format vocabulary meta-schema for annotation results";
const type$3 = [
  "object",
  "boolean"
];
const properties$3 = {
  format: {
    type: "string"
  }
};
const require$$5 = {
  $schema: $schema$3,
  $id: $id$3,
  $vocabulary: $vocabulary$2,
  $dynamicAnchor: $dynamicAnchor$2,
  title: title$3,
  type: type$3,
  properties: properties$3
};
const $schema$2 = "https://json-schema.org/draft/2020-12/schema";
const $id$2 = "https://json-schema.org/draft/2020-12/meta/meta-data";
const $vocabulary$1 = {
  "https://json-schema.org/draft/2020-12/vocab/meta-data": true
};
const $dynamicAnchor$1 = "meta";
const title$2 = "Meta-data vocabulary meta-schema";
const type$2 = [
  "object",
  "boolean"
];
const properties$2 = {
  title: {
    type: "string"
  },
  description: {
    type: "string"
  },
  "default": true,
  deprecated: {
    type: "boolean",
    "default": false
  },
  readOnly: {
    type: "boolean",
    "default": false
  },
  writeOnly: {
    type: "boolean",
    "default": false
  },
  examples: {
    type: "array",
    items: true
  }
};
const require$$6 = {
  $schema: $schema$2,
  $id: $id$2,
  $vocabulary: $vocabulary$1,
  $dynamicAnchor: $dynamicAnchor$1,
  title: title$2,
  type: type$2,
  properties: properties$2
};
const $schema$1 = "https://json-schema.org/draft/2020-12/schema";
const $id$1 = "https://json-schema.org/draft/2020-12/meta/validation";
const $vocabulary = {
  "https://json-schema.org/draft/2020-12/vocab/validation": true
};
const $dynamicAnchor = "meta";
const title$1 = "Validation vocabulary meta-schema";
const type$1 = [
  "object",
  "boolean"
];
const properties$1 = {
  type: {
    anyOf: [
      {
        $ref: "#/$defs/simpleTypes"
      },
      {
        type: "array",
        items: {
          $ref: "#/$defs/simpleTypes"
        },
        minItems: 1,
        uniqueItems: true
      }
    ]
  },
  "const": true,
  "enum": {
    type: "array",
    items: true
  },
  multipleOf: {
    type: "number",
    exclusiveMinimum: 0
  },
  maximum: {
    type: "number"
  },
  exclusiveMaximum: {
    type: "number"
  },
  minimum: {
    type: "number"
  },
  exclusiveMinimum: {
    type: "number"
  },
  maxLength: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minLength: {
    $ref: "#/$defs/nonNegativeIntegerDefault0"
  },
  pattern: {
    type: "string",
    format: "regex"
  },
  maxItems: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minItems: {
    $ref: "#/$defs/nonNegativeIntegerDefault0"
  },
  uniqueItems: {
    type: "boolean",
    "default": false
  },
  maxContains: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minContains: {
    $ref: "#/$defs/nonNegativeInteger",
    "default": 1
  },
  maxProperties: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minProperties: {
    $ref: "#/$defs/nonNegativeIntegerDefault0"
  },
  required: {
    $ref: "#/$defs/stringArray"
  },
  dependentRequired: {
    type: "object",
    additionalProperties: {
      $ref: "#/$defs/stringArray"
    }
  }
};
const $defs = {
  nonNegativeInteger: {
    type: "integer",
    minimum: 0
  },
  nonNegativeIntegerDefault0: {
    $ref: "#/$defs/nonNegativeInteger",
    "default": 0
  },
  simpleTypes: {
    "enum": [
      "array",
      "boolean",
      "integer",
      "null",
      "number",
      "object",
      "string"
    ]
  },
  stringArray: {
    type: "array",
    items: {
      type: "string"
    },
    uniqueItems: true,
    "default": []
  }
};
const require$$7 = {
  $schema: $schema$1,
  $id: $id$1,
  $vocabulary,
  $dynamicAnchor,
  title: title$1,
  type: type$1,
  properties: properties$1,
  $defs
};
Object.defineProperty(jsonSchema202012, "__esModule", { value: true });
const metaSchema = require$$0;
const applicator = require$$1;
const unevaluated = require$$2;
const content = require$$3$1;
const core = require$$4;
const format = require$$5;
const metadata = require$$6;
const validation = require$$7;
const META_SUPPORT_DATA = ["/properties"];
function addMetaSchema2020($data) {
  [
    metaSchema,
    applicator,
    unevaluated,
    content,
    core,
    with$data(this, format),
    metadata,
    with$data(this, validation)
  ].forEach((sch) => this.addMetaSchema(sch, void 0, false));
  return this;
  function with$data(ajv2, sch) {
    return $data ? ajv2.$dataMetaSchema(sch, META_SUPPORT_DATA) : sch;
  }
}
jsonSchema202012.default = addMetaSchema2020;
(function(module, exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.MissingRefError = exports$1.ValidationError = exports$1.CodeGen = exports$1.Name = exports$1.nil = exports$1.stringify = exports$1.str = exports$1._ = exports$1.KeywordCxt = exports$1.Ajv2020 = void 0;
  const core_12 = core$3;
  const draft2020_1 = draft2020;
  const discriminator_1 = discriminator;
  const json_schema_2020_12_1 = jsonSchema202012;
  const META_SCHEMA_ID = "https://json-schema.org/draft/2020-12/schema";
  class Ajv2020 extends core_12.default {
    constructor(opts = {}) {
      super({
        ...opts,
        dynamicRef: true,
        next: true,
        unevaluated: true
      });
    }
    _addVocabularies() {
      super._addVocabularies();
      draft2020_1.default.forEach((v) => this.addVocabulary(v));
      if (this.opts.discriminator)
        this.addKeyword(discriminator_1.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      const { $data, meta } = this.opts;
      if (!meta)
        return;
      json_schema_2020_12_1.default.call(this, $data);
      this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
    }
  }
  exports$1.Ajv2020 = Ajv2020;
  module.exports = exports$1 = Ajv2020;
  module.exports.Ajv2020 = Ajv2020;
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.default = Ajv2020;
  var validate_12 = validate;
  Object.defineProperty(exports$1, "KeywordCxt", { enumerable: true, get: function() {
    return validate_12.KeywordCxt;
  } });
  var codegen_12 = codegen;
  Object.defineProperty(exports$1, "_", { enumerable: true, get: function() {
    return codegen_12._;
  } });
  Object.defineProperty(exports$1, "str", { enumerable: true, get: function() {
    return codegen_12.str;
  } });
  Object.defineProperty(exports$1, "stringify", { enumerable: true, get: function() {
    return codegen_12.stringify;
  } });
  Object.defineProperty(exports$1, "nil", { enumerable: true, get: function() {
    return codegen_12.nil;
  } });
  Object.defineProperty(exports$1, "Name", { enumerable: true, get: function() {
    return codegen_12.Name;
  } });
  Object.defineProperty(exports$1, "CodeGen", { enumerable: true, get: function() {
    return codegen_12.CodeGen;
  } });
  var validation_error_12 = validation_error;
  Object.defineProperty(exports$1, "ValidationError", { enumerable: true, get: function() {
    return validation_error_12.default;
  } });
  var ref_error_12 = ref_error;
  Object.defineProperty(exports$1, "MissingRefError", { enumerable: true, get: function() {
    return ref_error_12.default;
  } });
})(_2020, _2020.exports);
var _2020Exports = _2020.exports;
var dist = { exports: {} };
var formats = {};
(function(exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.formatNames = exports$1.fastFormats = exports$1.fullFormats = void 0;
  function fmtDef(validate2, compare2) {
    return { validate: validate2, compare: compare2 };
  }
  exports$1.fullFormats = {
    // date: http://tools.ietf.org/html/rfc3339#section-5.6
    date: fmtDef(date, compareDate),
    // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
    time: fmtDef(getTime(true), compareTime),
    "date-time": fmtDef(getDateTime(true), compareDateTime),
    "iso-time": fmtDef(getTime(), compareIsoTime),
    "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
    // duration: https://tools.ietf.org/html/rfc3339#appendix-A
    duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
    uri: uri2,
    "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
    // uri-template: https://tools.ietf.org/html/rfc6570
    "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
    // For the source: https://gist.github.com/dperini/729294
    // For test cases: https://mathiasbynens.be/demo/url-regex
    url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
    email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
    hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
    // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
    ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
    regex,
    // uuid: http://tools.ietf.org/html/rfc4122
    uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    // JSON-pointer: https://tools.ietf.org/html/rfc6901
    // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
    "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
    "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
    // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
    "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
    // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
    // byte: https://github.com/miguelmota/is-base64
    byte,
    // signed 32 bit integer
    int32: { type: "number", validate: validateInt32 },
    // signed 64 bit integer
    int64: { type: "number", validate: validateInt64 },
    // C-type float
    float: { type: "number", validate: validateNumber },
    // C-type double
    double: { type: "number", validate: validateNumber },
    // hint to the UI to hide input strings
    password: true,
    // unchecked string payload
    binary: true
  };
  exports$1.fastFormats = {
    ...exports$1.fullFormats,
    date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
    time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
    "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
    "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
    "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
    // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
    "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
    // email (sources from jsen validator):
    // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
    // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  };
  exports$1.formatNames = Object.keys(exports$1.fullFormats);
  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  const DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
  const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function date(str) {
    const matches = DATE.exec(str);
    if (!matches)
      return false;
    const year = +matches[1];
    const month = +matches[2];
    const day = +matches[3];
    return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
  }
  function compareDate(d1, d2) {
    if (!(d1 && d2))
      return void 0;
    if (d1 > d2)
      return 1;
    if (d1 < d2)
      return -1;
    return 0;
  }
  const TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function getTime(strictTimeZone) {
    return function time(str) {
      const matches = TIME.exec(str);
      if (!matches)
        return false;
      const hr = +matches[1];
      const min = +matches[2];
      const sec = +matches[3];
      const tz = matches[4];
      const tzSign = matches[5] === "-" ? -1 : 1;
      const tzH = +(matches[6] || 0);
      const tzM = +(matches[7] || 0);
      if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
        return false;
      if (hr <= 23 && min <= 59 && sec < 60)
        return true;
      const utcMin = min - tzM * tzSign;
      const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
      return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
    };
  }
  function compareTime(s1, s2) {
    if (!(s1 && s2))
      return void 0;
    const t1 = (/* @__PURE__ */ new Date("2020-01-01T" + s1)).valueOf();
    const t2 = (/* @__PURE__ */ new Date("2020-01-01T" + s2)).valueOf();
    if (!(t1 && t2))
      return void 0;
    return t1 - t2;
  }
  function compareIsoTime(t1, t2) {
    if (!(t1 && t2))
      return void 0;
    const a1 = TIME.exec(t1);
    const a2 = TIME.exec(t2);
    if (!(a1 && a2))
      return void 0;
    t1 = a1[1] + a1[2] + a1[3];
    t2 = a2[1] + a2[2] + a2[3];
    if (t1 > t2)
      return 1;
    if (t1 < t2)
      return -1;
    return 0;
  }
  const DATE_TIME_SEPARATOR = /t|\s/i;
  function getDateTime(strictTimeZone) {
    const time = getTime(strictTimeZone);
    return function date_time(str) {
      const dateTime = str.split(DATE_TIME_SEPARATOR);
      return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
    };
  }
  function compareDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return void 0;
    const d1 = new Date(dt1).valueOf();
    const d2 = new Date(dt2).valueOf();
    if (!(d1 && d2))
      return void 0;
    return d1 - d2;
  }
  function compareIsoDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return void 0;
    const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
    const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
    const res = compareDate(d1, d2);
    if (res === void 0)
      return void 0;
    return res || compareTime(t1, t2);
  }
  const NOT_URI_FRAGMENT = /\/|:/;
  const URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function uri2(str) {
    return NOT_URI_FRAGMENT.test(str) && URI.test(str);
  }
  const BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
  function byte(str) {
    BYTE.lastIndex = 0;
    return BYTE.test(str);
  }
  const MIN_INT32 = -2147483648;
  const MAX_INT32 = 2 ** 31 - 1;
  function validateInt32(value) {
    return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
  }
  function validateInt64(value) {
    return Number.isInteger(value);
  }
  function validateNumber() {
    return true;
  }
  const Z_ANCHOR = /[^\\]\\Z/;
  function regex(str) {
    if (Z_ANCHOR.test(str))
      return false;
    try {
      new RegExp(str);
      return true;
    } catch (e) {
      return false;
    }
  }
})(formats);
var limit = {};
var ajv = { exports: {} };
var draft7 = {};
Object.defineProperty(draft7, "__esModule", { value: true });
const core_1 = core$2;
const validation_1 = validation$2;
const applicator_1 = applicator$1;
const format_1 = format$3;
const metadata_1 = metadata$1;
const draft7Vocabularies = [
  core_1.default,
  validation_1.default,
  (0, applicator_1.default)(),
  format_1.default,
  metadata_1.metadataVocabulary,
  metadata_1.contentVocabulary
];
draft7.default = draft7Vocabularies;
const $schema = "http://json-schema.org/draft-07/schema#";
const $id = "http://json-schema.org/draft-07/schema#";
const title = "Core schema meta-schema";
const definitions = {
  schemaArray: {
    type: "array",
    minItems: 1,
    items: {
      $ref: "#"
    }
  },
  nonNegativeInteger: {
    type: "integer",
    minimum: 0
  },
  nonNegativeIntegerDefault0: {
    allOf: [
      {
        $ref: "#/definitions/nonNegativeInteger"
      },
      {
        "default": 0
      }
    ]
  },
  simpleTypes: {
    "enum": [
      "array",
      "boolean",
      "integer",
      "null",
      "number",
      "object",
      "string"
    ]
  },
  stringArray: {
    type: "array",
    items: {
      type: "string"
    },
    uniqueItems: true,
    "default": []
  }
};
const type = [
  "object",
  "boolean"
];
const properties = {
  $id: {
    type: "string",
    format: "uri-reference"
  },
  $schema: {
    type: "string",
    format: "uri"
  },
  $ref: {
    type: "string",
    format: "uri-reference"
  },
  $comment: {
    type: "string"
  },
  title: {
    type: "string"
  },
  description: {
    type: "string"
  },
  "default": true,
  readOnly: {
    type: "boolean",
    "default": false
  },
  examples: {
    type: "array",
    items: true
  },
  multipleOf: {
    type: "number",
    exclusiveMinimum: 0
  },
  maximum: {
    type: "number"
  },
  exclusiveMaximum: {
    type: "number"
  },
  minimum: {
    type: "number"
  },
  exclusiveMinimum: {
    type: "number"
  },
  maxLength: {
    $ref: "#/definitions/nonNegativeInteger"
  },
  minLength: {
    $ref: "#/definitions/nonNegativeIntegerDefault0"
  },
  pattern: {
    type: "string",
    format: "regex"
  },
  additionalItems: {
    $ref: "#"
  },
  items: {
    anyOf: [
      {
        $ref: "#"
      },
      {
        $ref: "#/definitions/schemaArray"
      }
    ],
    "default": true
  },
  maxItems: {
    $ref: "#/definitions/nonNegativeInteger"
  },
  minItems: {
    $ref: "#/definitions/nonNegativeIntegerDefault0"
  },
  uniqueItems: {
    type: "boolean",
    "default": false
  },
  contains: {
    $ref: "#"
  },
  maxProperties: {
    $ref: "#/definitions/nonNegativeInteger"
  },
  minProperties: {
    $ref: "#/definitions/nonNegativeIntegerDefault0"
  },
  required: {
    $ref: "#/definitions/stringArray"
  },
  additionalProperties: {
    $ref: "#"
  },
  definitions: {
    type: "object",
    additionalProperties: {
      $ref: "#"
    },
    "default": {}
  },
  properties: {
    type: "object",
    additionalProperties: {
      $ref: "#"
    },
    "default": {}
  },
  patternProperties: {
    type: "object",
    additionalProperties: {
      $ref: "#"
    },
    propertyNames: {
      format: "regex"
    },
    "default": {}
  },
  dependencies: {
    type: "object",
    additionalProperties: {
      anyOf: [
        {
          $ref: "#"
        },
        {
          $ref: "#/definitions/stringArray"
        }
      ]
    }
  },
  propertyNames: {
    $ref: "#"
  },
  "const": true,
  "enum": {
    type: "array",
    items: true,
    minItems: 1,
    uniqueItems: true
  },
  type: {
    anyOf: [
      {
        $ref: "#/definitions/simpleTypes"
      },
      {
        type: "array",
        items: {
          $ref: "#/definitions/simpleTypes"
        },
        minItems: 1,
        uniqueItems: true
      }
    ]
  },
  format: {
    type: "string"
  },
  contentMediaType: {
    type: "string"
  },
  contentEncoding: {
    type: "string"
  },
  "if": {
    $ref: "#"
  },
  then: {
    $ref: "#"
  },
  "else": {
    $ref: "#"
  },
  allOf: {
    $ref: "#/definitions/schemaArray"
  },
  anyOf: {
    $ref: "#/definitions/schemaArray"
  },
  oneOf: {
    $ref: "#/definitions/schemaArray"
  },
  not: {
    $ref: "#"
  }
};
const require$$3 = {
  $schema,
  $id,
  title,
  definitions,
  type,
  properties,
  "default": true
};
(function(module, exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.MissingRefError = exports$1.ValidationError = exports$1.CodeGen = exports$1.Name = exports$1.nil = exports$1.stringify = exports$1.str = exports$1._ = exports$1.KeywordCxt = exports$1.Ajv = void 0;
  const core_12 = core$3;
  const draft7_1 = draft7;
  const discriminator_1 = discriminator;
  const draft7MetaSchema = require$$3;
  const META_SUPPORT_DATA2 = ["/properties"];
  const META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
  class Ajv extends core_12.default {
    _addVocabularies() {
      super._addVocabularies();
      draft7_1.default.forEach((v) => this.addVocabulary(v));
      if (this.opts.discriminator)
        this.addKeyword(discriminator_1.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      if (!this.opts.meta)
        return;
      const metaSchema2 = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA2) : draft7MetaSchema;
      this.addMetaSchema(metaSchema2, META_SCHEMA_ID, false);
      this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
    }
  }
  exports$1.Ajv = Ajv;
  module.exports = exports$1 = Ajv;
  module.exports.Ajv = Ajv;
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.default = Ajv;
  var validate_12 = validate;
  Object.defineProperty(exports$1, "KeywordCxt", { enumerable: true, get: function() {
    return validate_12.KeywordCxt;
  } });
  var codegen_12 = codegen;
  Object.defineProperty(exports$1, "_", { enumerable: true, get: function() {
    return codegen_12._;
  } });
  Object.defineProperty(exports$1, "str", { enumerable: true, get: function() {
    return codegen_12.str;
  } });
  Object.defineProperty(exports$1, "stringify", { enumerable: true, get: function() {
    return codegen_12.stringify;
  } });
  Object.defineProperty(exports$1, "nil", { enumerable: true, get: function() {
    return codegen_12.nil;
  } });
  Object.defineProperty(exports$1, "Name", { enumerable: true, get: function() {
    return codegen_12.Name;
  } });
  Object.defineProperty(exports$1, "CodeGen", { enumerable: true, get: function() {
    return codegen_12.CodeGen;
  } });
  var validation_error_12 = validation_error;
  Object.defineProperty(exports$1, "ValidationError", { enumerable: true, get: function() {
    return validation_error_12.default;
  } });
  var ref_error_12 = ref_error;
  Object.defineProperty(exports$1, "MissingRefError", { enumerable: true, get: function() {
    return ref_error_12.default;
  } });
})(ajv, ajv.exports);
var ajvExports = ajv.exports;
(function(exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.formatLimitDefinition = void 0;
  const ajv_1 = ajvExports;
  const codegen_12 = codegen;
  const ops2 = codegen_12.operators;
  const KWDs2 = {
    formatMaximum: { okStr: "<=", ok: ops2.LTE, fail: ops2.GT },
    formatMinimum: { okStr: ">=", ok: ops2.GTE, fail: ops2.LT },
    formatExclusiveMaximum: { okStr: "<", ok: ops2.LT, fail: ops2.GTE },
    formatExclusiveMinimum: { okStr: ">", ok: ops2.GT, fail: ops2.LTE }
  };
  const error2 = {
    message: ({ keyword: keyword2, schemaCode }) => (0, codegen_12.str)`should be ${KWDs2[keyword2].okStr} ${schemaCode}`,
    params: ({ keyword: keyword2, schemaCode }) => (0, codegen_12._)`{comparison: ${KWDs2[keyword2].okStr}, limit: ${schemaCode}}`
  };
  exports$1.formatLimitDefinition = {
    keyword: Object.keys(KWDs2),
    type: "string",
    schemaType: "string",
    $data: true,
    error: error2,
    code(cxt) {
      const { gen, data, schemaCode, keyword: keyword2, it } = cxt;
      const { opts, self: self2 } = it;
      if (!opts.validateFormats)
        return;
      const fCxt = new ajv_1.KeywordCxt(it, self2.RULES.all.format.definition, "format");
      if (fCxt.$data)
        validate$DataFormat();
      else
        validateFormat();
      function validate$DataFormat() {
        const fmts = gen.scopeValue("formats", {
          ref: self2.formats,
          code: opts.code.formats
        });
        const fmt = gen.const("fmt", (0, codegen_12._)`${fmts}[${fCxt.schemaCode}]`);
        cxt.fail$data((0, codegen_12.or)((0, codegen_12._)`typeof ${fmt} != "object"`, (0, codegen_12._)`${fmt} instanceof RegExp`, (0, codegen_12._)`typeof ${fmt}.compare != "function"`, compareCode(fmt)));
      }
      function validateFormat() {
        const format2 = fCxt.schema;
        const fmtDef = self2.formats[format2];
        if (!fmtDef || fmtDef === true)
          return;
        if (typeof fmtDef != "object" || fmtDef instanceof RegExp || typeof fmtDef.compare != "function") {
          throw new Error(`"${keyword2}": format "${format2}" does not define "compare" function`);
        }
        const fmt = gen.scopeValue("formats", {
          key: format2,
          ref: fmtDef,
          code: opts.code.formats ? (0, codegen_12._)`${opts.code.formats}${(0, codegen_12.getProperty)(format2)}` : void 0
        });
        cxt.fail$data(compareCode(fmt));
      }
      function compareCode(fmt) {
        return (0, codegen_12._)`${fmt}.compare(${data}, ${schemaCode}) ${KWDs2[keyword2].fail} 0`;
      }
    },
    dependencies: ["format"]
  };
  const formatLimitPlugin = (ajv2) => {
    ajv2.addKeyword(exports$1.formatLimitDefinition);
    return ajv2;
  };
  exports$1.default = formatLimitPlugin;
})(limit);
(function(module, exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  const formats_1 = formats;
  const limit_1 = limit;
  const codegen_12 = codegen;
  const fullName = new codegen_12.Name("fullFormats");
  const fastName = new codegen_12.Name("fastFormats");
  const formatsPlugin = (ajv2, opts = { keywords: true }) => {
    if (Array.isArray(opts)) {
      addFormats(ajv2, opts, formats_1.fullFormats, fullName);
      return ajv2;
    }
    const [formats2, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
    const list = opts.formats || formats_1.formatNames;
    addFormats(ajv2, list, formats2, exportName);
    if (opts.keywords)
      (0, limit_1.default)(ajv2);
    return ajv2;
  };
  formatsPlugin.get = (name, mode = "full") => {
    const formats2 = mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats;
    const f = formats2[name];
    if (!f)
      throw new Error(`Unknown format "${name}"`);
    return f;
  };
  function addFormats(ajv2, list, fs2, exportName) {
    var _a;
    var _b;
    (_a = (_b = ajv2.opts.code).formats) !== null && _a !== void 0 ? _a : _b.formats = (0, codegen_12._)`require("ajv-formats/dist/formats").${exportName}`;
    for (const f of list)
      ajv2.addFormat(f, fs2[f]);
  }
  module.exports = exports$1 = formatsPlugin;
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.default = formatsPlugin;
})(dist, dist.exports);
var distExports = dist.exports;
const ajvFormatsModule = /* @__PURE__ */ getDefaultExportFromCjs(distExports);
const copyProperty = (to, from, property, ignoreNonConfigurable) => {
  if (property === "length" || property === "prototype") {
    return;
  }
  if (property === "arguments" || property === "caller") {
    return;
  }
  const toDescriptor = Object.getOwnPropertyDescriptor(to, property);
  const fromDescriptor = Object.getOwnPropertyDescriptor(from, property);
  if (!canCopyProperty(toDescriptor, fromDescriptor) && ignoreNonConfigurable) {
    return;
  }
  Object.defineProperty(to, property, fromDescriptor);
};
const canCopyProperty = function(toDescriptor, fromDescriptor) {
  return toDescriptor === void 0 || toDescriptor.configurable || toDescriptor.writable === fromDescriptor.writable && toDescriptor.enumerable === fromDescriptor.enumerable && toDescriptor.configurable === fromDescriptor.configurable && (toDescriptor.writable || toDescriptor.value === fromDescriptor.value);
};
const changePrototype = (to, from) => {
  const fromPrototype = Object.getPrototypeOf(from);
  if (fromPrototype === Object.getPrototypeOf(to)) {
    return;
  }
  Object.setPrototypeOf(to, fromPrototype);
};
const wrappedToString = (withName, fromBody) => `/* Wrapped ${withName}*/
${fromBody}`;
const toStringDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, "toString");
const toStringName = Object.getOwnPropertyDescriptor(Function.prototype.toString, "name");
const changeToString = (to, from, name) => {
  const withName = name === "" ? "" : `with ${name.trim()}() `;
  const newToString = wrappedToString.bind(null, withName, from.toString());
  Object.defineProperty(newToString, "name", toStringName);
  const { writable, enumerable, configurable } = toStringDescriptor;
  Object.defineProperty(to, "toString", { value: newToString, writable, enumerable, configurable });
};
function mimicFunction(to, from, { ignoreNonConfigurable = false } = {}) {
  const { name } = to;
  for (const property of Reflect.ownKeys(from)) {
    copyProperty(to, from, property, ignoreNonConfigurable);
  }
  changePrototype(to, from);
  changeToString(to, from, name);
  return to;
}
const debounceFunction = (inputFunction, options = {}) => {
  if (typeof inputFunction !== "function") {
    throw new TypeError(`Expected the first argument to be a function, got \`${typeof inputFunction}\``);
  }
  const {
    wait = 0,
    maxWait = Number.POSITIVE_INFINITY,
    before = false,
    after = true
  } = options;
  if (wait < 0 || maxWait < 0) {
    throw new RangeError("`wait` and `maxWait` must not be negative.");
  }
  if (!before && !after) {
    throw new Error("Both `before` and `after` are false, function wouldn't be called.");
  }
  let timeout;
  let maxTimeout;
  let result;
  const debouncedFunction = function(...arguments_) {
    const context = this;
    const later = () => {
      timeout = void 0;
      if (maxTimeout) {
        clearTimeout(maxTimeout);
        maxTimeout = void 0;
      }
      if (after) {
        result = inputFunction.apply(context, arguments_);
      }
    };
    const maxLater = () => {
      maxTimeout = void 0;
      if (timeout) {
        clearTimeout(timeout);
        timeout = void 0;
      }
      if (after) {
        result = inputFunction.apply(context, arguments_);
      }
    };
    const shouldCallNow = before && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (maxWait > 0 && maxWait !== Number.POSITIVE_INFINITY && !maxTimeout) {
      maxTimeout = setTimeout(maxLater, maxWait);
    }
    if (shouldCallNow) {
      result = inputFunction.apply(context, arguments_);
    }
    return result;
  };
  mimicFunction(debouncedFunction, inputFunction);
  debouncedFunction.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = void 0;
    }
    if (maxTimeout) {
      clearTimeout(maxTimeout);
      maxTimeout = void 0;
    }
  };
  return debouncedFunction;
};
var re$2 = { exports: {} };
const SEMVER_SPEC_VERSION = "2.0.0";
const MAX_LENGTH$1 = 256;
const MAX_SAFE_INTEGER$1 = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
9007199254740991;
const MAX_SAFE_COMPONENT_LENGTH = 16;
const MAX_SAFE_BUILD_LENGTH = MAX_LENGTH$1 - 6;
const RELEASE_TYPES = [
  "major",
  "premajor",
  "minor",
  "preminor",
  "patch",
  "prepatch",
  "prerelease"
];
var constants$2 = {
  MAX_LENGTH: MAX_LENGTH$1,
  MAX_SAFE_COMPONENT_LENGTH,
  MAX_SAFE_BUILD_LENGTH,
  MAX_SAFE_INTEGER: MAX_SAFE_INTEGER$1,
  RELEASE_TYPES,
  SEMVER_SPEC_VERSION,
  FLAG_INCLUDE_PRERELEASE: 1,
  FLAG_LOOSE: 2
};
const debug$2 = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
};
var debug_1 = debug$2;
(function(module, exports$1) {
  const {
    MAX_SAFE_COMPONENT_LENGTH: MAX_SAFE_COMPONENT_LENGTH2,
    MAX_SAFE_BUILD_LENGTH: MAX_SAFE_BUILD_LENGTH2,
    MAX_LENGTH: MAX_LENGTH2
  } = constants$2;
  const debug2 = debug_1;
  exports$1 = module.exports = {};
  const re2 = exports$1.re = [];
  const safeRe = exports$1.safeRe = [];
  const src = exports$1.src = [];
  const safeSrc = exports$1.safeSrc = [];
  const t2 = exports$1.t = {};
  let R2 = 0;
  const LETTERDASHNUMBER = "[a-zA-Z0-9-]";
  const safeRegexReplacements = [
    ["\\s", 1],
    ["\\d", MAX_LENGTH2],
    [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH2]
  ];
  const makeSafeRegex = (value) => {
    for (const [token, max] of safeRegexReplacements) {
      value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
    }
    return value;
  };
  const createToken = (name, value, isGlobal) => {
    const safe = makeSafeRegex(value);
    const index = R2++;
    debug2(name, index, value);
    t2[name] = index;
    src[index] = value;
    safeSrc[index] = safe;
    re2[index] = new RegExp(value, isGlobal ? "g" : void 0);
    safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
  };
  createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
  createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
  createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
  createToken("MAINVERSION", `(${src[t2.NUMERICIDENTIFIER]})\\.(${src[t2.NUMERICIDENTIFIER]})\\.(${src[t2.NUMERICIDENTIFIER]})`);
  createToken("MAINVERSIONLOOSE", `(${src[t2.NUMERICIDENTIFIERLOOSE]})\\.(${src[t2.NUMERICIDENTIFIERLOOSE]})\\.(${src[t2.NUMERICIDENTIFIERLOOSE]})`);
  createToken("PRERELEASEIDENTIFIER", `(?:${src[t2.NONNUMERICIDENTIFIER]}|${src[t2.NUMERICIDENTIFIER]})`);
  createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t2.NONNUMERICIDENTIFIER]}|${src[t2.NUMERICIDENTIFIERLOOSE]})`);
  createToken("PRERELEASE", `(?:-(${src[t2.PRERELEASEIDENTIFIER]}(?:\\.${src[t2.PRERELEASEIDENTIFIER]})*))`);
  createToken("PRERELEASELOOSE", `(?:-?(${src[t2.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t2.PRERELEASEIDENTIFIERLOOSE]})*))`);
  createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
  createToken("BUILD", `(?:\\+(${src[t2.BUILDIDENTIFIER]}(?:\\.${src[t2.BUILDIDENTIFIER]})*))`);
  createToken("FULLPLAIN", `v?${src[t2.MAINVERSION]}${src[t2.PRERELEASE]}?${src[t2.BUILD]}?`);
  createToken("FULL", `^${src[t2.FULLPLAIN]}$`);
  createToken("LOOSEPLAIN", `[v=\\s]*${src[t2.MAINVERSIONLOOSE]}${src[t2.PRERELEASELOOSE]}?${src[t2.BUILD]}?`);
  createToken("LOOSE", `^${src[t2.LOOSEPLAIN]}$`);
  createToken("GTLT", "((?:<|>)?=?)");
  createToken("XRANGEIDENTIFIERLOOSE", `${src[t2.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
  createToken("XRANGEIDENTIFIER", `${src[t2.NUMERICIDENTIFIER]}|x|X|\\*`);
  createToken("XRANGEPLAIN", `[v=\\s]*(${src[t2.XRANGEIDENTIFIER]})(?:\\.(${src[t2.XRANGEIDENTIFIER]})(?:\\.(${src[t2.XRANGEIDENTIFIER]})(?:${src[t2.PRERELEASE]})?${src[t2.BUILD]}?)?)?`);
  createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t2.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t2.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t2.XRANGEIDENTIFIERLOOSE]})(?:${src[t2.PRERELEASELOOSE]})?${src[t2.BUILD]}?)?)?`);
  createToken("XRANGE", `^${src[t2.GTLT]}\\s*${src[t2.XRANGEPLAIN]}$`);
  createToken("XRANGELOOSE", `^${src[t2.GTLT]}\\s*${src[t2.XRANGEPLAINLOOSE]}$`);
  createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH2}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH2}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH2}}))?`);
  createToken("COERCE", `${src[t2.COERCEPLAIN]}(?:$|[^\\d])`);
  createToken("COERCEFULL", src[t2.COERCEPLAIN] + `(?:${src[t2.PRERELEASE]})?(?:${src[t2.BUILD]})?(?:$|[^\\d])`);
  createToken("COERCERTL", src[t2.COERCE], true);
  createToken("COERCERTLFULL", src[t2.COERCEFULL], true);
  createToken("LONETILDE", "(?:~>?)");
  createToken("TILDETRIM", `(\\s*)${src[t2.LONETILDE]}\\s+`, true);
  exports$1.tildeTrimReplace = "$1~";
  createToken("TILDE", `^${src[t2.LONETILDE]}${src[t2.XRANGEPLAIN]}$`);
  createToken("TILDELOOSE", `^${src[t2.LONETILDE]}${src[t2.XRANGEPLAINLOOSE]}$`);
  createToken("LONECARET", "(?:\\^)");
  createToken("CARETTRIM", `(\\s*)${src[t2.LONECARET]}\\s+`, true);
  exports$1.caretTrimReplace = "$1^";
  createToken("CARET", `^${src[t2.LONECARET]}${src[t2.XRANGEPLAIN]}$`);
  createToken("CARETLOOSE", `^${src[t2.LONECARET]}${src[t2.XRANGEPLAINLOOSE]}$`);
  createToken("COMPARATORLOOSE", `^${src[t2.GTLT]}\\s*(${src[t2.LOOSEPLAIN]})$|^$`);
  createToken("COMPARATOR", `^${src[t2.GTLT]}\\s*(${src[t2.FULLPLAIN]})$|^$`);
  createToken("COMPARATORTRIM", `(\\s*)${src[t2.GTLT]}\\s*(${src[t2.LOOSEPLAIN]}|${src[t2.XRANGEPLAIN]})`, true);
  exports$1.comparatorTrimReplace = "$1$2$3";
  createToken("HYPHENRANGE", `^\\s*(${src[t2.XRANGEPLAIN]})\\s+-\\s+(${src[t2.XRANGEPLAIN]})\\s*$`);
  createToken("HYPHENRANGELOOSE", `^\\s*(${src[t2.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t2.XRANGEPLAINLOOSE]})\\s*$`);
  createToken("STAR", "(<|>)?=?\\s*\\*");
  createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
  createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
})(re$2, re$2.exports);
var reExports = re$2.exports;
const looseOption = Object.freeze({ loose: true });
const emptyOpts = Object.freeze({});
const parseOptions$1 = (options) => {
  if (!options) {
    return emptyOpts;
  }
  if (typeof options !== "object") {
    return looseOption;
  }
  return options;
};
var parseOptions_1 = parseOptions$1;
const numeric = /^[0-9]+$/;
const compareIdentifiers$1 = (a, b) => {
  if (typeof a === "number" && typeof b === "number") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  const anum = numeric.test(a);
  const bnum = numeric.test(b);
  if (anum && bnum) {
    a = +a;
    b = +b;
  }
  return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
};
const rcompareIdentifiers = (a, b) => compareIdentifiers$1(b, a);
var identifiers$1 = {
  compareIdentifiers: compareIdentifiers$1,
  rcompareIdentifiers
};
const debug$1 = debug_1;
const { MAX_LENGTH, MAX_SAFE_INTEGER } = constants$2;
const { safeRe: re$1, t: t$1 } = reExports;
const parseOptions = parseOptions_1;
const { compareIdentifiers } = identifiers$1;
let SemVer$d = class SemVer {
  constructor(version, options) {
    options = parseOptions(options);
    if (version instanceof SemVer) {
      if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) {
        return version;
      } else {
        version = version.version;
      }
    } else if (typeof version !== "string") {
      throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
    }
    if (version.length > MAX_LENGTH) {
      throw new TypeError(
        `version is longer than ${MAX_LENGTH} characters`
      );
    }
    debug$1("SemVer", version, options);
    this.options = options;
    this.loose = !!options.loose;
    this.includePrerelease = !!options.includePrerelease;
    const m = version.trim().match(options.loose ? re$1[t$1.LOOSE] : re$1[t$1.FULL]);
    if (!m) {
      throw new TypeError(`Invalid Version: ${version}`);
    }
    this.raw = version;
    this.major = +m[1];
    this.minor = +m[2];
    this.patch = +m[3];
    if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
      throw new TypeError("Invalid major version");
    }
    if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
      throw new TypeError("Invalid minor version");
    }
    if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
      throw new TypeError("Invalid patch version");
    }
    if (!m[4]) {
      this.prerelease = [];
    } else {
      this.prerelease = m[4].split(".").map((id2) => {
        if (/^[0-9]+$/.test(id2)) {
          const num = +id2;
          if (num >= 0 && num < MAX_SAFE_INTEGER) {
            return num;
          }
        }
        return id2;
      });
    }
    this.build = m[5] ? m[5].split(".") : [];
    this.format();
  }
  format() {
    this.version = `${this.major}.${this.minor}.${this.patch}`;
    if (this.prerelease.length) {
      this.version += `-${this.prerelease.join(".")}`;
    }
    return this.version;
  }
  toString() {
    return this.version;
  }
  compare(other) {
    debug$1("SemVer.compare", this.version, this.options, other);
    if (!(other instanceof SemVer)) {
      if (typeof other === "string" && other === this.version) {
        return 0;
      }
      other = new SemVer(other, this.options);
    }
    if (other.version === this.version) {
      return 0;
    }
    return this.compareMain(other) || this.comparePre(other);
  }
  compareMain(other) {
    if (!(other instanceof SemVer)) {
      other = new SemVer(other, this.options);
    }
    if (this.major < other.major) {
      return -1;
    }
    if (this.major > other.major) {
      return 1;
    }
    if (this.minor < other.minor) {
      return -1;
    }
    if (this.minor > other.minor) {
      return 1;
    }
    if (this.patch < other.patch) {
      return -1;
    }
    if (this.patch > other.patch) {
      return 1;
    }
    return 0;
  }
  comparePre(other) {
    if (!(other instanceof SemVer)) {
      other = new SemVer(other, this.options);
    }
    if (this.prerelease.length && !other.prerelease.length) {
      return -1;
    } else if (!this.prerelease.length && other.prerelease.length) {
      return 1;
    } else if (!this.prerelease.length && !other.prerelease.length) {
      return 0;
    }
    let i = 0;
    do {
      const a = this.prerelease[i];
      const b = other.prerelease[i];
      debug$1("prerelease compare", i, a, b);
      if (a === void 0 && b === void 0) {
        return 0;
      } else if (b === void 0) {
        return 1;
      } else if (a === void 0) {
        return -1;
      } else if (a === b) {
        continue;
      } else {
        return compareIdentifiers(a, b);
      }
    } while (++i);
  }
  compareBuild(other) {
    if (!(other instanceof SemVer)) {
      other = new SemVer(other, this.options);
    }
    let i = 0;
    do {
      const a = this.build[i];
      const b = other.build[i];
      debug$1("build compare", i, a, b);
      if (a === void 0 && b === void 0) {
        return 0;
      } else if (b === void 0) {
        return 1;
      } else if (a === void 0) {
        return -1;
      } else if (a === b) {
        continue;
      } else {
        return compareIdentifiers(a, b);
      }
    } while (++i);
  }
  // preminor will bump the version up to the next minor release, and immediately
  // down to pre-release. premajor and prepatch work the same way.
  inc(release, identifier, identifierBase) {
    if (release.startsWith("pre")) {
      if (!identifier && identifierBase === false) {
        throw new Error("invalid increment argument: identifier is empty");
      }
      if (identifier) {
        const match2 = `-${identifier}`.match(this.options.loose ? re$1[t$1.PRERELEASELOOSE] : re$1[t$1.PRERELEASE]);
        if (!match2 || match2[1] !== identifier) {
          throw new Error(`invalid identifier: ${identifier}`);
        }
      }
    }
    switch (release) {
      case "premajor":
        this.prerelease.length = 0;
        this.patch = 0;
        this.minor = 0;
        this.major++;
        this.inc("pre", identifier, identifierBase);
        break;
      case "preminor":
        this.prerelease.length = 0;
        this.patch = 0;
        this.minor++;
        this.inc("pre", identifier, identifierBase);
        break;
      case "prepatch":
        this.prerelease.length = 0;
        this.inc("patch", identifier, identifierBase);
        this.inc("pre", identifier, identifierBase);
        break;
      case "prerelease":
        if (this.prerelease.length === 0) {
          this.inc("patch", identifier, identifierBase);
        }
        this.inc("pre", identifier, identifierBase);
        break;
      case "release":
        if (this.prerelease.length === 0) {
          throw new Error(`version ${this.raw} is not a prerelease`);
        }
        this.prerelease.length = 0;
        break;
      case "major":
        if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
          this.major++;
        }
        this.minor = 0;
        this.patch = 0;
        this.prerelease = [];
        break;
      case "minor":
        if (this.patch !== 0 || this.prerelease.length === 0) {
          this.minor++;
        }
        this.patch = 0;
        this.prerelease = [];
        break;
      case "patch":
        if (this.prerelease.length === 0) {
          this.patch++;
        }
        this.prerelease = [];
        break;
      case "pre": {
        const base = Number(identifierBase) ? 1 : 0;
        if (this.prerelease.length === 0) {
          this.prerelease = [base];
        } else {
          let i = this.prerelease.length;
          while (--i >= 0) {
            if (typeof this.prerelease[i] === "number") {
              this.prerelease[i]++;
              i = -2;
            }
          }
          if (i === -1) {
            if (identifier === this.prerelease.join(".") && identifierBase === false) {
              throw new Error("invalid increment argument: identifier already exists");
            }
            this.prerelease.push(base);
          }
        }
        if (identifier) {
          let prerelease2 = [identifier, base];
          if (identifierBase === false) {
            prerelease2 = [identifier];
          }
          if (compareIdentifiers(this.prerelease[0], identifier) === 0) {
            if (isNaN(this.prerelease[1])) {
              this.prerelease = prerelease2;
            }
          } else {
            this.prerelease = prerelease2;
          }
        }
        break;
      }
      default:
        throw new Error(`invalid increment argument: ${release}`);
    }
    this.raw = this.format();
    if (this.build.length) {
      this.raw += `+${this.build.join(".")}`;
    }
    return this;
  }
};
var semver$2 = SemVer$d;
const SemVer$c = semver$2;
const parse$6 = (version, options, throwErrors = false) => {
  if (version instanceof SemVer$c) {
    return version;
  }
  try {
    return new SemVer$c(version, options);
  } catch (er) {
    if (!throwErrors) {
      return null;
    }
    throw er;
  }
};
var parse_1 = parse$6;
const parse$5 = parse_1;
const valid$2 = (version, options) => {
  const v = parse$5(version, options);
  return v ? v.version : null;
};
var valid_1 = valid$2;
const parse$4 = parse_1;
const clean$1 = (version, options) => {
  const s = parse$4(version.trim().replace(/^[=v]+/, ""), options);
  return s ? s.version : null;
};
var clean_1 = clean$1;
const SemVer$b = semver$2;
const inc$1 = (version, release, options, identifier, identifierBase) => {
  if (typeof options === "string") {
    identifierBase = identifier;
    identifier = options;
    options = void 0;
  }
  try {
    return new SemVer$b(
      version instanceof SemVer$b ? version.version : version,
      options
    ).inc(release, identifier, identifierBase).version;
  } catch (er) {
    return null;
  }
};
var inc_1 = inc$1;
const parse$3 = parse_1;
const diff$1 = (version1, version2) => {
  const v1 = parse$3(version1, null, true);
  const v2 = parse$3(version2, null, true);
  const comparison = v1.compare(v2);
  if (comparison === 0) {
    return null;
  }
  const v1Higher = comparison > 0;
  const highVersion = v1Higher ? v1 : v2;
  const lowVersion = v1Higher ? v2 : v1;
  const highHasPre = !!highVersion.prerelease.length;
  const lowHasPre = !!lowVersion.prerelease.length;
  if (lowHasPre && !highHasPre) {
    if (!lowVersion.patch && !lowVersion.minor) {
      return "major";
    }
    if (lowVersion.compareMain(highVersion) === 0) {
      if (lowVersion.minor && !lowVersion.patch) {
        return "minor";
      }
      return "patch";
    }
  }
  const prefix = highHasPre ? "pre" : "";
  if (v1.major !== v2.major) {
    return prefix + "major";
  }
  if (v1.minor !== v2.minor) {
    return prefix + "minor";
  }
  if (v1.patch !== v2.patch) {
    return prefix + "patch";
  }
  return "prerelease";
};
var diff_1 = diff$1;
const SemVer$a = semver$2;
const major$1 = (a, loose) => new SemVer$a(a, loose).major;
var major_1 = major$1;
const SemVer$9 = semver$2;
const minor$1 = (a, loose) => new SemVer$9(a, loose).minor;
var minor_1 = minor$1;
const SemVer$8 = semver$2;
const patch$3 = (a, loose) => new SemVer$8(a, loose).patch;
var patch_1 = patch$3;
const parse$2 = parse_1;
const prerelease$1 = (version, options) => {
  const parsed = parse$2(version, options);
  return parsed && parsed.prerelease.length ? parsed.prerelease : null;
};
var prerelease_1 = prerelease$1;
const SemVer$7 = semver$2;
const compare$b = (a, b, loose) => new SemVer$7(a, loose).compare(new SemVer$7(b, loose));
var compare_1 = compare$b;
const compare$a = compare_1;
const rcompare$1 = (a, b, loose) => compare$a(b, a, loose);
var rcompare_1 = rcompare$1;
const compare$9 = compare_1;
const compareLoose$1 = (a, b) => compare$9(a, b, true);
var compareLoose_1 = compareLoose$1;
const SemVer$6 = semver$2;
const compareBuild$3 = (a, b, loose) => {
  const versionA = new SemVer$6(a, loose);
  const versionB = new SemVer$6(b, loose);
  return versionA.compare(versionB) || versionA.compareBuild(versionB);
};
var compareBuild_1 = compareBuild$3;
const compareBuild$2 = compareBuild_1;
const sort$1 = (list, loose) => list.sort((a, b) => compareBuild$2(a, b, loose));
var sort_1 = sort$1;
const compareBuild$1 = compareBuild_1;
const rsort$1 = (list, loose) => list.sort((a, b) => compareBuild$1(b, a, loose));
var rsort_1 = rsort$1;
const compare$8 = compare_1;
const gt$5 = (a, b, loose) => compare$8(a, b, loose) > 0;
var gt_1 = gt$5;
const compare$7 = compare_1;
const lt$4 = (a, b, loose) => compare$7(a, b, loose) < 0;
var lt_1 = lt$4;
const compare$6 = compare_1;
const eq$2 = (a, b, loose) => compare$6(a, b, loose) === 0;
var eq_1 = eq$2;
const compare$5 = compare_1;
const neq$2 = (a, b, loose) => compare$5(a, b, loose) !== 0;
var neq_1 = neq$2;
const compare$4 = compare_1;
const gte$3 = (a, b, loose) => compare$4(a, b, loose) >= 0;
var gte_1 = gte$3;
const compare$3 = compare_1;
const lte$3 = (a, b, loose) => compare$3(a, b, loose) <= 0;
var lte_1 = lte$3;
const eq$1 = eq_1;
const neq$1 = neq_1;
const gt$4 = gt_1;
const gte$2 = gte_1;
const lt$3 = lt_1;
const lte$2 = lte_1;
const cmp$1 = (a, op, b, loose) => {
  switch (op) {
    case "===":
      if (typeof a === "object") {
        a = a.version;
      }
      if (typeof b === "object") {
        b = b.version;
      }
      return a === b;
    case "!==":
      if (typeof a === "object") {
        a = a.version;
      }
      if (typeof b === "object") {
        b = b.version;
      }
      return a !== b;
    case "":
    case "=":
    case "==":
      return eq$1(a, b, loose);
    case "!=":
      return neq$1(a, b, loose);
    case ">":
      return gt$4(a, b, loose);
    case ">=":
      return gte$2(a, b, loose);
    case "<":
      return lt$3(a, b, loose);
    case "<=":
      return lte$2(a, b, loose);
    default:
      throw new TypeError(`Invalid operator: ${op}`);
  }
};
var cmp_1 = cmp$1;
const SemVer$5 = semver$2;
const parse$1 = parse_1;
const { safeRe: re, t } = reExports;
const coerce$1 = (version, options) => {
  if (version instanceof SemVer$5) {
    return version;
  }
  if (typeof version === "number") {
    version = String(version);
  }
  if (typeof version !== "string") {
    return null;
  }
  options = options || {};
  let match2 = null;
  if (!options.rtl) {
    match2 = version.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
  } else {
    const coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL];
    let next2;
    while ((next2 = coerceRtlRegex.exec(version)) && (!match2 || match2.index + match2[0].length !== version.length)) {
      if (!match2 || next2.index + next2[0].length !== match2.index + match2[0].length) {
        match2 = next2;
      }
      coerceRtlRegex.lastIndex = next2.index + next2[1].length + next2[2].length;
    }
    coerceRtlRegex.lastIndex = -1;
  }
  if (match2 === null) {
    return null;
  }
  const major2 = match2[2];
  const minor2 = match2[3] || "0";
  const patch2 = match2[4] || "0";
  const prerelease2 = options.includePrerelease && match2[5] ? `-${match2[5]}` : "";
  const build = options.includePrerelease && match2[6] ? `+${match2[6]}` : "";
  return parse$1(`${major2}.${minor2}.${patch2}${prerelease2}${build}`, options);
};
var coerce_1 = coerce$1;
class LRUCache {
  constructor() {
    this.max = 1e3;
    this.map = /* @__PURE__ */ new Map();
  }
  get(key) {
    const value = this.map.get(key);
    if (value === void 0) {
      return void 0;
    } else {
      this.map.delete(key);
      this.map.set(key, value);
      return value;
    }
  }
  delete(key) {
    return this.map.delete(key);
  }
  set(key, value) {
    const deleted = this.delete(key);
    if (!deleted && value !== void 0) {
      if (this.map.size >= this.max) {
        const firstKey = this.map.keys().next().value;
        this.delete(firstKey);
      }
      this.map.set(key, value);
    }
    return this;
  }
}
var lrucache = LRUCache;
var range;
var hasRequiredRange;
function requireRange() {
  if (hasRequiredRange) return range;
  hasRequiredRange = 1;
  const SPACE_CHARACTERS = /\s+/g;
  class Range2 {
    constructor(range2, options) {
      options = parseOptions2(options);
      if (range2 instanceof Range2) {
        if (range2.loose === !!options.loose && range2.includePrerelease === !!options.includePrerelease) {
          return range2;
        } else {
          return new Range2(range2.raw, options);
        }
      }
      if (range2 instanceof Comparator2) {
        this.raw = range2.value;
        this.set = [[range2]];
        this.formatted = void 0;
        return this;
      }
      this.options = options;
      this.loose = !!options.loose;
      this.includePrerelease = !!options.includePrerelease;
      this.raw = range2.trim().replace(SPACE_CHARACTERS, " ");
      this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
      if (!this.set.length) {
        throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
      }
      if (this.set.length > 1) {
        const first = this.set[0];
        this.set = this.set.filter((c) => !isNullSet(c[0]));
        if (this.set.length === 0) {
          this.set = [first];
        } else if (this.set.length > 1) {
          for (const c of this.set) {
            if (c.length === 1 && isAny(c[0])) {
              this.set = [c];
              break;
            }
          }
        }
      }
      this.formatted = void 0;
    }
    get range() {
      if (this.formatted === void 0) {
        this.formatted = "";
        for (let i = 0; i < this.set.length; i++) {
          if (i > 0) {
            this.formatted += "||";
          }
          const comps = this.set[i];
          for (let k = 0; k < comps.length; k++) {
            if (k > 0) {
              this.formatted += " ";
            }
            this.formatted += comps[k].toString().trim();
          }
        }
      }
      return this.formatted;
    }
    format() {
      return this.range;
    }
    toString() {
      return this.range;
    }
    parseRange(range2) {
      const memoOpts = (this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE);
      const memoKey = memoOpts + ":" + range2;
      const cached = cache.get(memoKey);
      if (cached) {
        return cached;
      }
      const loose = this.options.loose;
      const hr = loose ? re2[t2.HYPHENRANGELOOSE] : re2[t2.HYPHENRANGE];
      range2 = range2.replace(hr, hyphenReplace(this.options.includePrerelease));
      debug2("hyphen replace", range2);
      range2 = range2.replace(re2[t2.COMPARATORTRIM], comparatorTrimReplace);
      debug2("comparator trim", range2);
      range2 = range2.replace(re2[t2.TILDETRIM], tildeTrimReplace);
      debug2("tilde trim", range2);
      range2 = range2.replace(re2[t2.CARETTRIM], caretTrimReplace);
      debug2("caret trim", range2);
      let rangeList = range2.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
      if (loose) {
        rangeList = rangeList.filter((comp) => {
          debug2("loose invalid filter", comp, this.options);
          return !!comp.match(re2[t2.COMPARATORLOOSE]);
        });
      }
      debug2("range list", rangeList);
      const rangeMap = /* @__PURE__ */ new Map();
      const comparators = rangeList.map((comp) => new Comparator2(comp, this.options));
      for (const comp of comparators) {
        if (isNullSet(comp)) {
          return [comp];
        }
        rangeMap.set(comp.value, comp);
      }
      if (rangeMap.size > 1 && rangeMap.has("")) {
        rangeMap.delete("");
      }
      const result = [...rangeMap.values()];
      cache.set(memoKey, result);
      return result;
    }
    intersects(range2, options) {
      if (!(range2 instanceof Range2)) {
        throw new TypeError("a Range is required");
      }
      return this.set.some((thisComparators) => {
        return isSatisfiable(thisComparators, options) && range2.set.some((rangeComparators) => {
          return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
            return rangeComparators.every((rangeComparator) => {
              return thisComparator.intersects(rangeComparator, options);
            });
          });
        });
      });
    }
    // if ANY of the sets match ALL of its comparators, then pass
    test(version) {
      if (!version) {
        return false;
      }
      if (typeof version === "string") {
        try {
          version = new SemVer3(version, this.options);
        } catch (er) {
          return false;
        }
      }
      for (let i = 0; i < this.set.length; i++) {
        if (testSet(this.set[i], version, this.options)) {
          return true;
        }
      }
      return false;
    }
  }
  range = Range2;
  const LRU = lrucache;
  const cache = new LRU();
  const parseOptions2 = parseOptions_1;
  const Comparator2 = requireComparator();
  const debug2 = debug_1;
  const SemVer3 = semver$2;
  const {
    safeRe: re2,
    t: t2,
    comparatorTrimReplace,
    tildeTrimReplace,
    caretTrimReplace
  } = reExports;
  const { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = constants$2;
  const isNullSet = (c) => c.value === "<0.0.0-0";
  const isAny = (c) => c.value === "";
  const isSatisfiable = (comparators, options) => {
    let result = true;
    const remainingComparators = comparators.slice();
    let testComparator = remainingComparators.pop();
    while (result && remainingComparators.length) {
      result = remainingComparators.every((otherComparator) => {
        return testComparator.intersects(otherComparator, options);
      });
      testComparator = remainingComparators.pop();
    }
    return result;
  };
  const parseComparator = (comp, options) => {
    comp = comp.replace(re2[t2.BUILD], "");
    debug2("comp", comp, options);
    comp = replaceCarets(comp, options);
    debug2("caret", comp);
    comp = replaceTildes(comp, options);
    debug2("tildes", comp);
    comp = replaceXRanges(comp, options);
    debug2("xrange", comp);
    comp = replaceStars(comp, options);
    debug2("stars", comp);
    return comp;
  };
  const isX = (id2) => !id2 || id2.toLowerCase() === "x" || id2 === "*";
  const replaceTildes = (comp, options) => {
    return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
  };
  const replaceTilde = (comp, options) => {
    const r = options.loose ? re2[t2.TILDELOOSE] : re2[t2.TILDE];
    return comp.replace(r, (_, M, m, p, pr) => {
      debug2("tilde", comp, _, M, m, p, pr);
      let ret;
      if (isX(M)) {
        ret = "";
      } else if (isX(m)) {
        ret = `>=${M}.0.0 <${+M + 1}.0.0-0`;
      } else if (isX(p)) {
        ret = `>=${M}.${m}.0 <${M}.${+m + 1}.0-0`;
      } else if (pr) {
        debug2("replaceTilde pr", pr);
        ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
      } else {
        ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
      }
      debug2("tilde return", ret);
      return ret;
    });
  };
  const replaceCarets = (comp, options) => {
    return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
  };
  const replaceCaret = (comp, options) => {
    debug2("caret", comp, options);
    const r = options.loose ? re2[t2.CARETLOOSE] : re2[t2.CARET];
    const z2 = options.includePrerelease ? "-0" : "";
    return comp.replace(r, (_, M, m, p, pr) => {
      debug2("caret", comp, _, M, m, p, pr);
      let ret;
      if (isX(M)) {
        ret = "";
      } else if (isX(m)) {
        ret = `>=${M}.0.0${z2} <${+M + 1}.0.0-0`;
      } else if (isX(p)) {
        if (M === "0") {
          ret = `>=${M}.${m}.0${z2} <${M}.${+m + 1}.0-0`;
        } else {
          ret = `>=${M}.${m}.0${z2} <${+M + 1}.0.0-0`;
        }
      } else if (pr) {
        debug2("replaceCaret pr", pr);
        if (M === "0") {
          if (m === "0") {
            ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
          } else {
            ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
          }
        } else {
          ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
        }
      } else {
        debug2("no pr");
        if (M === "0") {
          if (m === "0") {
            ret = `>=${M}.${m}.${p}${z2} <${M}.${m}.${+p + 1}-0`;
          } else {
            ret = `>=${M}.${m}.${p}${z2} <${M}.${+m + 1}.0-0`;
          }
        } else {
          ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
        }
      }
      debug2("caret return", ret);
      return ret;
    });
  };
  const replaceXRanges = (comp, options) => {
    debug2("replaceXRanges", comp, options);
    return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
  };
  const replaceXRange = (comp, options) => {
    comp = comp.trim();
    const r = options.loose ? re2[t2.XRANGELOOSE] : re2[t2.XRANGE];
    return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
      debug2("xRange", comp, ret, gtlt, M, m, p, pr);
      const xM = isX(M);
      const xm = xM || isX(m);
      const xp = xm || isX(p);
      const anyX = xp;
      if (gtlt === "=" && anyX) {
        gtlt = "";
      }
      pr = options.includePrerelease ? "-0" : "";
      if (xM) {
        if (gtlt === ">" || gtlt === "<") {
          ret = "<0.0.0-0";
        } else {
          ret = "*";
        }
      } else if (gtlt && anyX) {
        if (xm) {
          m = 0;
        }
        p = 0;
        if (gtlt === ">") {
          gtlt = ">=";
          if (xm) {
            M = +M + 1;
            m = 0;
            p = 0;
          } else {
            m = +m + 1;
            p = 0;
          }
        } else if (gtlt === "<=") {
          gtlt = "<";
          if (xm) {
            M = +M + 1;
          } else {
            m = +m + 1;
          }
        }
        if (gtlt === "<") {
          pr = "-0";
        }
        ret = `${gtlt + M}.${m}.${p}${pr}`;
      } else if (xm) {
        ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
      } else if (xp) {
        ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
      }
      debug2("xRange return", ret);
      return ret;
    });
  };
  const replaceStars = (comp, options) => {
    debug2("replaceStars", comp, options);
    return comp.trim().replace(re2[t2.STAR], "");
  };
  const replaceGTE0 = (comp, options) => {
    debug2("replaceGTE0", comp, options);
    return comp.trim().replace(re2[options.includePrerelease ? t2.GTE0PRE : t2.GTE0], "");
  };
  const hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
    if (isX(fM)) {
      from = "";
    } else if (isX(fm)) {
      from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
    } else if (isX(fp)) {
      from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
    } else if (fpr) {
      from = `>=${from}`;
    } else {
      from = `>=${from}${incPr ? "-0" : ""}`;
    }
    if (isX(tM)) {
      to = "";
    } else if (isX(tm)) {
      to = `<${+tM + 1}.0.0-0`;
    } else if (isX(tp)) {
      to = `<${tM}.${+tm + 1}.0-0`;
    } else if (tpr) {
      to = `<=${tM}.${tm}.${tp}-${tpr}`;
    } else if (incPr) {
      to = `<${tM}.${tm}.${+tp + 1}-0`;
    } else {
      to = `<=${to}`;
    }
    return `${from} ${to}`.trim();
  };
  const testSet = (set, version, options) => {
    for (let i = 0; i < set.length; i++) {
      if (!set[i].test(version)) {
        return false;
      }
    }
    if (version.prerelease.length && !options.includePrerelease) {
      for (let i = 0; i < set.length; i++) {
        debug2(set[i].semver);
        if (set[i].semver === Comparator2.ANY) {
          continue;
        }
        if (set[i].semver.prerelease.length > 0) {
          const allowed = set[i].semver;
          if (allowed.major === version.major && allowed.minor === version.minor && allowed.patch === version.patch) {
            return true;
          }
        }
      }
      return false;
    }
    return true;
  };
  return range;
}
var comparator;
var hasRequiredComparator;
function requireComparator() {
  if (hasRequiredComparator) return comparator;
  hasRequiredComparator = 1;
  const ANY2 = Symbol("SemVer ANY");
  class Comparator2 {
    static get ANY() {
      return ANY2;
    }
    constructor(comp, options) {
      options = parseOptions2(options);
      if (comp instanceof Comparator2) {
        if (comp.loose === !!options.loose) {
          return comp;
        } else {
          comp = comp.value;
        }
      }
      comp = comp.trim().split(/\s+/).join(" ");
      debug2("comparator", comp, options);
      this.options = options;
      this.loose = !!options.loose;
      this.parse(comp);
      if (this.semver === ANY2) {
        this.value = "";
      } else {
        this.value = this.operator + this.semver.version;
      }
      debug2("comp", this);
    }
    parse(comp) {
      const r = this.options.loose ? re2[t2.COMPARATORLOOSE] : re2[t2.COMPARATOR];
      const m = comp.match(r);
      if (!m) {
        throw new TypeError(`Invalid comparator: ${comp}`);
      }
      this.operator = m[1] !== void 0 ? m[1] : "";
      if (this.operator === "=") {
        this.operator = "";
      }
      if (!m[2]) {
        this.semver = ANY2;
      } else {
        this.semver = new SemVer3(m[2], this.options.loose);
      }
    }
    toString() {
      return this.value;
    }
    test(version) {
      debug2("Comparator.test", version, this.options.loose);
      if (this.semver === ANY2 || version === ANY2) {
        return true;
      }
      if (typeof version === "string") {
        try {
          version = new SemVer3(version, this.options);
        } catch (er) {
          return false;
        }
      }
      return cmp2(version, this.operator, this.semver, this.options);
    }
    intersects(comp, options) {
      if (!(comp instanceof Comparator2)) {
        throw new TypeError("a Comparator is required");
      }
      if (this.operator === "") {
        if (this.value === "") {
          return true;
        }
        return new Range2(comp.value, options).test(this.value);
      } else if (comp.operator === "") {
        if (comp.value === "") {
          return true;
        }
        return new Range2(this.value, options).test(comp.semver);
      }
      options = parseOptions2(options);
      if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) {
        return false;
      }
      if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) {
        return false;
      }
      if (this.operator.startsWith(">") && comp.operator.startsWith(">")) {
        return true;
      }
      if (this.operator.startsWith("<") && comp.operator.startsWith("<")) {
        return true;
      }
      if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) {
        return true;
      }
      if (cmp2(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) {
        return true;
      }
      if (cmp2(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) {
        return true;
      }
      return false;
    }
  }
  comparator = Comparator2;
  const parseOptions2 = parseOptions_1;
  const { safeRe: re2, t: t2 } = reExports;
  const cmp2 = cmp_1;
  const debug2 = debug_1;
  const SemVer3 = semver$2;
  const Range2 = requireRange();
  return comparator;
}
const Range$9 = requireRange();
const satisfies$4 = (version, range2, options) => {
  try {
    range2 = new Range$9(range2, options);
  } catch (er) {
    return false;
  }
  return range2.test(version);
};
var satisfies_1 = satisfies$4;
const Range$8 = requireRange();
const toComparators$1 = (range2, options) => new Range$8(range2, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
var toComparators_1 = toComparators$1;
const SemVer$4 = semver$2;
const Range$7 = requireRange();
const maxSatisfying$1 = (versions, range2, options) => {
  let max = null;
  let maxSV = null;
  let rangeObj = null;
  try {
    rangeObj = new Range$7(range2, options);
  } catch (er) {
    return null;
  }
  versions.forEach((v) => {
    if (rangeObj.test(v)) {
      if (!max || maxSV.compare(v) === -1) {
        max = v;
        maxSV = new SemVer$4(max, options);
      }
    }
  });
  return max;
};
var maxSatisfying_1 = maxSatisfying$1;
const SemVer$3 = semver$2;
const Range$6 = requireRange();
const minSatisfying$1 = (versions, range2, options) => {
  let min = null;
  let minSV = null;
  let rangeObj = null;
  try {
    rangeObj = new Range$6(range2, options);
  } catch (er) {
    return null;
  }
  versions.forEach((v) => {
    if (rangeObj.test(v)) {
      if (!min || minSV.compare(v) === 1) {
        min = v;
        minSV = new SemVer$3(min, options);
      }
    }
  });
  return min;
};
var minSatisfying_1 = minSatisfying$1;
const SemVer$2 = semver$2;
const Range$5 = requireRange();
const gt$3 = gt_1;
const minVersion$1 = (range2, loose) => {
  range2 = new Range$5(range2, loose);
  let minver = new SemVer$2("0.0.0");
  if (range2.test(minver)) {
    return minver;
  }
  minver = new SemVer$2("0.0.0-0");
  if (range2.test(minver)) {
    return minver;
  }
  minver = null;
  for (let i = 0; i < range2.set.length; ++i) {
    const comparators = range2.set[i];
    let setMin = null;
    comparators.forEach((comparator2) => {
      const compver = new SemVer$2(comparator2.semver.version);
      switch (comparator2.operator) {
        case ">":
          if (compver.prerelease.length === 0) {
            compver.patch++;
          } else {
            compver.prerelease.push(0);
          }
          compver.raw = compver.format();
        case "":
        case ">=":
          if (!setMin || gt$3(compver, setMin)) {
            setMin = compver;
          }
          break;
        case "<":
        case "<=":
          break;
        default:
          throw new Error(`Unexpected operation: ${comparator2.operator}`);
      }
    });
    if (setMin && (!minver || gt$3(minver, setMin))) {
      minver = setMin;
    }
  }
  if (minver && range2.test(minver)) {
    return minver;
  }
  return null;
};
var minVersion_1 = minVersion$1;
const Range$4 = requireRange();
const validRange$1 = (range2, options) => {
  try {
    return new Range$4(range2, options).range || "*";
  } catch (er) {
    return null;
  }
};
var valid$1 = validRange$1;
const SemVer$1 = semver$2;
const Comparator$2 = requireComparator();
const { ANY: ANY$1 } = Comparator$2;
const Range$3 = requireRange();
const satisfies$3 = satisfies_1;
const gt$2 = gt_1;
const lt$2 = lt_1;
const lte$1 = lte_1;
const gte$1 = gte_1;
const outside$3 = (version, range2, hilo, options) => {
  version = new SemVer$1(version, options);
  range2 = new Range$3(range2, options);
  let gtfn, ltefn, ltfn, comp, ecomp;
  switch (hilo) {
    case ">":
      gtfn = gt$2;
      ltefn = lte$1;
      ltfn = lt$2;
      comp = ">";
      ecomp = ">=";
      break;
    case "<":
      gtfn = lt$2;
      ltefn = gte$1;
      ltfn = gt$2;
      comp = "<";
      ecomp = "<=";
      break;
    default:
      throw new TypeError('Must provide a hilo val of "<" or ">"');
  }
  if (satisfies$3(version, range2, options)) {
    return false;
  }
  for (let i = 0; i < range2.set.length; ++i) {
    const comparators = range2.set[i];
    let high = null;
    let low = null;
    comparators.forEach((comparator2) => {
      if (comparator2.semver === ANY$1) {
        comparator2 = new Comparator$2(">=0.0.0");
      }
      high = high || comparator2;
      low = low || comparator2;
      if (gtfn(comparator2.semver, high.semver, options)) {
        high = comparator2;
      } else if (ltfn(comparator2.semver, low.semver, options)) {
        low = comparator2;
      }
    });
    if (high.operator === comp || high.operator === ecomp) {
      return false;
    }
    if ((!low.operator || low.operator === comp) && ltefn(version, low.semver)) {
      return false;
    } else if (low.operator === ecomp && ltfn(version, low.semver)) {
      return false;
    }
  }
  return true;
};
var outside_1 = outside$3;
const outside$2 = outside_1;
const gtr$1 = (version, range2, options) => outside$2(version, range2, ">", options);
var gtr_1 = gtr$1;
const outside$1 = outside_1;
const ltr$1 = (version, range2, options) => outside$1(version, range2, "<", options);
var ltr_1 = ltr$1;
const Range$2 = requireRange();
const intersects$1 = (r1, r2, options) => {
  r1 = new Range$2(r1, options);
  r2 = new Range$2(r2, options);
  return r1.intersects(r2, options);
};
var intersects_1 = intersects$1;
const satisfies$2 = satisfies_1;
const compare$2 = compare_1;
var simplify = (versions, range2, options) => {
  const set = [];
  let first = null;
  let prev = null;
  const v = versions.sort((a, b) => compare$2(a, b, options));
  for (const version of v) {
    const included = satisfies$2(version, range2, options);
    if (included) {
      prev = version;
      if (!first) {
        first = version;
      }
    } else {
      if (prev) {
        set.push([first, prev]);
      }
      prev = null;
      first = null;
    }
  }
  if (first) {
    set.push([first, null]);
  }
  const ranges = [];
  for (const [min, max] of set) {
    if (min === max) {
      ranges.push(min);
    } else if (!max && min === v[0]) {
      ranges.push("*");
    } else if (!max) {
      ranges.push(`>=${min}`);
    } else if (min === v[0]) {
      ranges.push(`<=${max}`);
    } else {
      ranges.push(`${min} - ${max}`);
    }
  }
  const simplified = ranges.join(" || ");
  const original = typeof range2.raw === "string" ? range2.raw : String(range2);
  return simplified.length < original.length ? simplified : range2;
};
const Range$1 = requireRange();
const Comparator$1 = requireComparator();
const { ANY } = Comparator$1;
const satisfies$1 = satisfies_1;
const compare$1 = compare_1;
const subset$1 = (sub, dom, options = {}) => {
  if (sub === dom) {
    return true;
  }
  sub = new Range$1(sub, options);
  dom = new Range$1(dom, options);
  let sawNonNull = false;
  OUTER: for (const simpleSub of sub.set) {
    for (const simpleDom of dom.set) {
      const isSub = simpleSubset(simpleSub, simpleDom, options);
      sawNonNull = sawNonNull || isSub !== null;
      if (isSub) {
        continue OUTER;
      }
    }
    if (sawNonNull) {
      return false;
    }
  }
  return true;
};
const minimumVersionWithPreRelease = [new Comparator$1(">=0.0.0-0")];
const minimumVersion = [new Comparator$1(">=0.0.0")];
const simpleSubset = (sub, dom, options) => {
  if (sub === dom) {
    return true;
  }
  if (sub.length === 1 && sub[0].semver === ANY) {
    if (dom.length === 1 && dom[0].semver === ANY) {
      return true;
    } else if (options.includePrerelease) {
      sub = minimumVersionWithPreRelease;
    } else {
      sub = minimumVersion;
    }
  }
  if (dom.length === 1 && dom[0].semver === ANY) {
    if (options.includePrerelease) {
      return true;
    } else {
      dom = minimumVersion;
    }
  }
  const eqSet = /* @__PURE__ */ new Set();
  let gt2, lt2;
  for (const c of sub) {
    if (c.operator === ">" || c.operator === ">=") {
      gt2 = higherGT(gt2, c, options);
    } else if (c.operator === "<" || c.operator === "<=") {
      lt2 = lowerLT(lt2, c, options);
    } else {
      eqSet.add(c.semver);
    }
  }
  if (eqSet.size > 1) {
    return null;
  }
  let gtltComp;
  if (gt2 && lt2) {
    gtltComp = compare$1(gt2.semver, lt2.semver, options);
    if (gtltComp > 0) {
      return null;
    } else if (gtltComp === 0 && (gt2.operator !== ">=" || lt2.operator !== "<=")) {
      return null;
    }
  }
  for (const eq2 of eqSet) {
    if (gt2 && !satisfies$1(eq2, String(gt2), options)) {
      return null;
    }
    if (lt2 && !satisfies$1(eq2, String(lt2), options)) {
      return null;
    }
    for (const c of dom) {
      if (!satisfies$1(eq2, String(c), options)) {
        return false;
      }
    }
    return true;
  }
  let higher, lower;
  let hasDomLT, hasDomGT;
  let needDomLTPre = lt2 && !options.includePrerelease && lt2.semver.prerelease.length ? lt2.semver : false;
  let needDomGTPre = gt2 && !options.includePrerelease && gt2.semver.prerelease.length ? gt2.semver : false;
  if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt2.operator === "<" && needDomLTPre.prerelease[0] === 0) {
    needDomLTPre = false;
  }
  for (const c of dom) {
    hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
    hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
    if (gt2) {
      if (needDomGTPre) {
        if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) {
          needDomGTPre = false;
        }
      }
      if (c.operator === ">" || c.operator === ">=") {
        higher = higherGT(gt2, c, options);
        if (higher === c && higher !== gt2) {
          return false;
        }
      } else if (gt2.operator === ">=" && !satisfies$1(gt2.semver, String(c), options)) {
        return false;
      }
    }
    if (lt2) {
      if (needDomLTPre) {
        if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) {
          needDomLTPre = false;
        }
      }
      if (c.operator === "<" || c.operator === "<=") {
        lower = lowerLT(lt2, c, options);
        if (lower === c && lower !== lt2) {
          return false;
        }
      } else if (lt2.operator === "<=" && !satisfies$1(lt2.semver, String(c), options)) {
        return false;
      }
    }
    if (!c.operator && (lt2 || gt2) && gtltComp !== 0) {
      return false;
    }
  }
  if (gt2 && hasDomLT && !lt2 && gtltComp !== 0) {
    return false;
  }
  if (lt2 && hasDomGT && !gt2 && gtltComp !== 0) {
    return false;
  }
  if (needDomGTPre || needDomLTPre) {
    return false;
  }
  return true;
};
const higherGT = (a, b, options) => {
  if (!a) {
    return b;
  }
  const comp = compare$1(a.semver, b.semver, options);
  return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
};
const lowerLT = (a, b, options) => {
  if (!a) {
    return b;
  }
  const comp = compare$1(a.semver, b.semver, options);
  return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
};
var subset_1 = subset$1;
const internalRe = reExports;
const constants$1 = constants$2;
const SemVer2 = semver$2;
const identifiers = identifiers$1;
const parse = parse_1;
const valid = valid_1;
const clean = clean_1;
const inc = inc_1;
const diff = diff_1;
const major = major_1;
const minor = minor_1;
const patch$2 = patch_1;
const prerelease = prerelease_1;
const compare = compare_1;
const rcompare = rcompare_1;
const compareLoose = compareLoose_1;
const compareBuild = compareBuild_1;
const sort = sort_1;
const rsort = rsort_1;
const gt$1 = gt_1;
const lt$1 = lt_1;
const eq = eq_1;
const neq = neq_1;
const gte = gte_1;
const lte = lte_1;
const cmp = cmp_1;
const coerce = coerce_1;
const Comparator = requireComparator();
const Range = requireRange();
const satisfies = satisfies_1;
const toComparators = toComparators_1;
const maxSatisfying = maxSatisfying_1;
const minSatisfying = minSatisfying_1;
const minVersion = minVersion_1;
const validRange = valid$1;
const outside = outside_1;
const gtr = gtr_1;
const ltr = ltr_1;
const intersects = intersects_1;
const simplifyRange = simplify;
const subset = subset_1;
var semver = {
  parse,
  valid,
  clean,
  inc,
  diff,
  major,
  minor,
  patch: patch$2,
  prerelease,
  compare,
  rcompare,
  compareLoose,
  compareBuild,
  sort,
  rsort,
  gt: gt$1,
  lt: lt$1,
  eq,
  neq,
  gte,
  lte,
  cmp,
  coerce,
  Comparator,
  Range,
  satisfies,
  toComparators,
  maxSatisfying,
  minSatisfying,
  minVersion,
  validRange,
  outside,
  gtr,
  ltr,
  intersects,
  simplifyRange,
  subset,
  SemVer: SemVer2,
  re: internalRe.re,
  src: internalRe.src,
  tokens: internalRe.t,
  SEMVER_SPEC_VERSION: constants$1.SEMVER_SPEC_VERSION,
  RELEASE_TYPES: constants$1.RELEASE_TYPES,
  compareIdentifiers: identifiers.compareIdentifiers,
  rcompareIdentifiers: identifiers.rcompareIdentifiers
};
const semver$1 = /* @__PURE__ */ getDefaultExportFromCjs(semver);
const objectToString = Object.prototype.toString;
const uint8ArrayStringified = "[object Uint8Array]";
const arrayBufferStringified = "[object ArrayBuffer]";
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
function isArrayBuffer(value) {
  return isType(value, ArrayBuffer, arrayBufferStringified);
}
function isUint8ArrayOrArrayBuffer(value) {
  return isUint8Array(value) || isArrayBuffer(value);
}
function assertUint8Array(value) {
  if (!isUint8Array(value)) {
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof value}\``);
  }
}
function assertUint8ArrayOrArrayBuffer(value) {
  if (!isUint8ArrayOrArrayBuffer(value)) {
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof value}\``);
  }
}
function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) {
    return new Uint8Array(0);
  }
  totalLength ?? (totalLength = arrays.reduce((accumulator, currentValue) => accumulator + currentValue.length, 0));
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    assertUint8Array(array);
    returnValue.set(array, offset);
    offset += array.length;
  }
  return returnValue;
}
const cachedDecoders = {
  utf8: new globalThis.TextDecoder("utf8")
};
function uint8ArrayToString(array, encoding = "utf8") {
  assertUint8ArrayOrArrayBuffer(array);
  cachedDecoders[encoding] ?? (cachedDecoders[encoding] = new globalThis.TextDecoder(encoding));
  return cachedDecoders[encoding].decode(array);
}
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
const cachedEncoder = new globalThis.TextEncoder();
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));
const defaultEncryptionAlgorithm = "aes-256-cbc";
const supportedEncryptionAlgorithms = /* @__PURE__ */ new Set([
  "aes-256-cbc",
  "aes-256-gcm",
  "aes-256-ctr"
]);
const isSupportedEncryptionAlgorithm = (value) => typeof value === "string" && supportedEncryptionAlgorithms.has(value);
const createPlainObject = () => /* @__PURE__ */ Object.create(null);
const isExist = (data) => data !== void 0;
const checkValueType = (key, value) => {
  const nonJsonTypes = /* @__PURE__ */ new Set([
    "undefined",
    "symbol",
    "function"
  ]);
  const type2 = typeof value;
  if (nonJsonTypes.has(type2)) {
    throw new TypeError(`Setting a value of type \`${type2}\` for key \`${key}\` is not allowed as it's not supported by JSON`);
  }
};
const INTERNAL_KEY = "__internal__";
const MIGRATION_KEY = `${INTERNAL_KEY}.migrations.version`;
class Conf {
  constructor(partialOptions = {}) {
    __privateAdd(this, _Conf_instances);
    __publicField(this, "path");
    __publicField(this, "events");
    __privateAdd(this, _validator);
    __privateAdd(this, _encryptionKey);
    __privateAdd(this, _encryptionAlgorithm);
    __privateAdd(this, _options);
    __privateAdd(this, _defaultValues, {});
    __privateAdd(this, _isInMigration, false);
    __privateAdd(this, _watcher);
    __privateAdd(this, _watchFile);
    __privateAdd(this, _debouncedChangeHandler);
    __publicField(this, "_deserialize", (value) => JSON.parse(value));
    __publicField(this, "_serialize", (value) => JSON.stringify(value, void 0, "	"));
    const options = __privateMethod(this, _Conf_instances, prepareOptions_fn).call(this, partialOptions);
    __privateSet(this, _options, options);
    __privateMethod(this, _Conf_instances, setupValidator_fn).call(this, options);
    __privateMethod(this, _Conf_instances, applyDefaultValues_fn).call(this, options);
    __privateMethod(this, _Conf_instances, configureSerialization_fn).call(this, options);
    this.events = new EventTarget();
    __privateSet(this, _encryptionKey, options.encryptionKey);
    __privateSet(this, _encryptionAlgorithm, options.encryptionAlgorithm ?? defaultEncryptionAlgorithm);
    this.path = __privateMethod(this, _Conf_instances, resolvePath_fn).call(this, options);
    __privateMethod(this, _Conf_instances, initializeStore_fn).call(this, options);
    if (options.watch) {
      this._watch();
    }
  }
  get(key, defaultValue) {
    if (__privateGet(this, _options).accessPropertiesByDotNotation) {
      return this._get(key, defaultValue);
    }
    const { store } = this;
    return key in store ? store[key] : defaultValue;
  }
  set(key, value) {
    if (typeof key !== "string" && typeof key !== "object") {
      throw new TypeError(`Expected \`key\` to be of type \`string\` or \`object\`, got ${typeof key}`);
    }
    if (typeof key !== "object" && value === void 0) {
      throw new TypeError("Use `delete()` to clear values");
    }
    if (this._containsReservedKey(key)) {
      throw new TypeError(`Please don't use the ${INTERNAL_KEY} key, as it's used to manage this module internal operations.`);
    }
    const { store } = this;
    const set = (key2, value2) => {
      checkValueType(key2, value2);
      if (__privateGet(this, _options).accessPropertiesByDotNotation) {
        setProperty(store, key2, value2);
      } else {
        if (key2 === "__proto__" || key2 === "constructor" || key2 === "prototype") {
          return;
        }
        store[key2] = value2;
      }
    };
    if (typeof key === "object") {
      const object = key;
      for (const [key2, value2] of Object.entries(object)) {
        set(key2, value2);
      }
    } else {
      set(key, value);
    }
    this.store = store;
  }
  has(key) {
    if (__privateGet(this, _options).accessPropertiesByDotNotation) {
      return hasProperty(this.store, key);
    }
    return key in this.store;
  }
  appendToArray(key, value) {
    checkValueType(key, value);
    const array = __privateGet(this, _options).accessPropertiesByDotNotation ? this._get(key, []) : key in this.store ? this.store[key] : [];
    if (!Array.isArray(array)) {
      throw new TypeError(`The key \`${key}\` is already set to a non-array value`);
    }
    this.set(key, [...array, value]);
  }
  /**
      Reset items to their default values, as defined by the `defaults` or `schema` option.
  
      @see `clear()` to reset all items.
  
      @param keys - The keys of the items to reset.
      */
  reset(...keys2) {
    for (const key of keys2) {
      if (isExist(__privateGet(this, _defaultValues)[key])) {
        this.set(key, __privateGet(this, _defaultValues)[key]);
      }
    }
  }
  delete(key) {
    const { store } = this;
    if (__privateGet(this, _options).accessPropertiesByDotNotation) {
      deleteProperty(store, key);
    } else {
      delete store[key];
    }
    this.store = store;
  }
  /**
      Delete all items.
  
      This resets known items to their default values, if defined by the `defaults` or `schema` option.
      */
  clear() {
    const newStore = createPlainObject();
    for (const key of Object.keys(__privateGet(this, _defaultValues))) {
      if (isExist(__privateGet(this, _defaultValues)[key])) {
        checkValueType(key, __privateGet(this, _defaultValues)[key]);
        if (__privateGet(this, _options).accessPropertiesByDotNotation) {
          setProperty(newStore, key, __privateGet(this, _defaultValues)[key]);
        } else {
          newStore[key] = __privateGet(this, _defaultValues)[key];
        }
      }
    }
    this.store = newStore;
  }
  onDidChange(key, callback) {
    if (typeof key !== "string") {
      throw new TypeError(`Expected \`key\` to be of type \`string\`, got ${typeof key}`);
    }
    if (typeof callback !== "function") {
      throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof callback}`);
    }
    return this._handleValueChange(() => this.get(key), callback);
  }
  /**
      Watches the whole config object, calling `callback` on any changes.
  
      @param callback - A callback function that is called on any changes. When a `key` is first set `oldValue` will be `undefined`, and when a key is deleted `newValue` will be `undefined`.
      @returns A function, that when called, will unsubscribe.
      */
  onDidAnyChange(callback) {
    if (typeof callback !== "function") {
      throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof callback}`);
    }
    return this._handleStoreChange(callback);
  }
  get size() {
    const entries = Object.keys(this.store);
    return entries.filter((key) => !this._isReservedKeyPath(key)).length;
  }
  /**
      Get all the config as an object or replace the current config with an object.
  
      @example
      ```
      console.log(config.store);
      //=> {name: 'John', age: 30}
      ```
  
      @example
      ```
      config.store = {
          hello: 'world'
      };
      ```
      */
  get store() {
    var _a;
    try {
      const data = fs$k.readFileSync(this.path, __privateGet(this, _encryptionKey) ? null : "utf8");
      const dataString = this._decryptData(data);
      const parseStore = (value) => {
        const deserializedData = this._deserialize(value);
        if (!__privateGet(this, _isInMigration)) {
          this._validate(deserializedData);
        }
        return Object.assign(createPlainObject(), deserializedData);
      };
      return parseStore(dataString);
    } catch (error2) {
      if ((error2 == null ? void 0 : error2.code) === "ENOENT") {
        this._ensureDirectory();
        return createPlainObject();
      }
      if (__privateGet(this, _options).clearInvalidConfig) {
        const errorInstance = error2;
        if (errorInstance.name === "SyntaxError") {
          return createPlainObject();
        }
        if ((_a = errorInstance.message) == null ? void 0 : _a.startsWith("Config schema violation:")) {
          return createPlainObject();
        }
        if (errorInstance.message === "Failed to decrypt config data.") {
          return createPlainObject();
        }
      }
      throw error2;
    }
  }
  set store(value) {
    this._ensureDirectory();
    if (!hasProperty(value, INTERNAL_KEY)) {
      try {
        const data = fs$k.readFileSync(this.path, __privateGet(this, _encryptionKey) ? null : "utf8");
        const dataString = this._decryptData(data);
        const currentStore = this._deserialize(dataString);
        if (hasProperty(currentStore, INTERNAL_KEY)) {
          setProperty(value, INTERNAL_KEY, getProperty(currentStore, INTERNAL_KEY));
        }
      } catch {
      }
    }
    if (!__privateGet(this, _isInMigration)) {
      this._validate(value);
    }
    this._write(value);
    this.events.dispatchEvent(new Event("change"));
  }
  *[Symbol.iterator]() {
    for (const [key, value] of Object.entries(this.store)) {
      if (!this._isReservedKeyPath(key)) {
        yield [key, value];
      }
    }
  }
  /**
  Close the file watcher if one exists. This is useful in tests to prevent the process from hanging.
  */
  _closeWatcher() {
    if (__privateGet(this, _watcher)) {
      __privateGet(this, _watcher).close();
      __privateSet(this, _watcher, void 0);
    }
    if (__privateGet(this, _watchFile)) {
      fs$k.unwatchFile(this.path);
      __privateSet(this, _watchFile, false);
    }
    __privateSet(this, _debouncedChangeHandler, void 0);
  }
  _decryptData(data) {
    const encryptionKey = __privateGet(this, _encryptionKey);
    if (!encryptionKey) {
      return typeof data === "string" ? data : uint8ArrayToString(data);
    }
    const encryptionAlgorithm = __privateGet(this, _encryptionAlgorithm);
    const authenticationTagLength = encryptionAlgorithm === "aes-256-gcm" ? 16 : 0;
    const separatorCodePoint = ":".codePointAt(0);
    const separatorByte = typeof data === "string" ? data.codePointAt(16) : data[16];
    const hasSeparator = separatorCodePoint !== void 0 && separatorByte === separatorCodePoint;
    if (!hasSeparator) {
      if (encryptionAlgorithm === "aes-256-cbc") {
        return typeof data === "string" ? data : uint8ArrayToString(data);
      }
      throw new Error("Failed to decrypt config data.");
    }
    const getEncryptedPayload = (dataUpdate2) => {
      if (authenticationTagLength === 0) {
        return { ciphertext: dataUpdate2 };
      }
      const authenticationTagStart = dataUpdate2.length - authenticationTagLength;
      if (authenticationTagStart < 0) {
        throw new Error("Invalid authentication tag length.");
      }
      return {
        ciphertext: dataUpdate2.slice(0, authenticationTagStart),
        authenticationTag: dataUpdate2.slice(authenticationTagStart)
      };
    };
    const initializationVector = data.slice(0, 16);
    const slice = data.slice(17);
    const dataUpdate = typeof slice === "string" ? stringToUint8Array(slice) : slice;
    const decrypt = (salt) => {
      const { ciphertext, authenticationTag } = getEncryptedPayload(dataUpdate);
      const password = crypto$1.pbkdf2Sync(encryptionKey, salt, 1e4, 32, "sha512");
      const decipher = crypto$1.createDecipheriv(encryptionAlgorithm, password, initializationVector);
      if (authenticationTag) {
        decipher.setAuthTag(authenticationTag);
      }
      return uint8ArrayToString(concatUint8Arrays([decipher.update(ciphertext), decipher.final()]));
    };
    try {
      return decrypt(initializationVector);
    } catch {
      try {
        return decrypt(initializationVector.toString());
      } catch {
      }
    }
    if (encryptionAlgorithm === "aes-256-cbc") {
      return typeof data === "string" ? data : uint8ArrayToString(data);
    }
    throw new Error("Failed to decrypt config data.");
  }
  _handleStoreChange(callback) {
    let currentValue = this.store;
    const onChange = () => {
      const oldValue = currentValue;
      const newValue = this.store;
      if (isDeepStrictEqual(newValue, oldValue)) {
        return;
      }
      currentValue = newValue;
      callback.call(this, newValue, oldValue);
    };
    this.events.addEventListener("change", onChange);
    return () => {
      this.events.removeEventListener("change", onChange);
    };
  }
  _handleValueChange(getter, callback) {
    let currentValue = getter();
    const onChange = () => {
      const oldValue = currentValue;
      const newValue = getter();
      if (isDeepStrictEqual(newValue, oldValue)) {
        return;
      }
      currentValue = newValue;
      callback.call(this, newValue, oldValue);
    };
    this.events.addEventListener("change", onChange);
    return () => {
      this.events.removeEventListener("change", onChange);
    };
  }
  _validate(data) {
    if (!__privateGet(this, _validator)) {
      return;
    }
    const valid2 = __privateGet(this, _validator).call(this, data);
    if (valid2 || !__privateGet(this, _validator).errors) {
      return;
    }
    const errors2 = __privateGet(this, _validator).errors.map(({ instancePath, message = "" }) => `\`${instancePath.slice(1)}\` ${message}`);
    throw new Error("Config schema violation: " + errors2.join("; "));
  }
  _ensureDirectory() {
    fs$k.mkdirSync(path$d.dirname(this.path), { recursive: true });
  }
  _write(value) {
    let data = this._serialize(value);
    const encryptionKey = __privateGet(this, _encryptionKey);
    if (encryptionKey) {
      const initializationVector = crypto$1.randomBytes(16);
      const password = crypto$1.pbkdf2Sync(encryptionKey, initializationVector, 1e4, 32, "sha512");
      const cipher = crypto$1.createCipheriv(__privateGet(this, _encryptionAlgorithm), password, initializationVector);
      const encryptedData = concatUint8Arrays([cipher.update(stringToUint8Array(data)), cipher.final()]);
      const encryptedParts = [initializationVector, stringToUint8Array(":"), encryptedData];
      if (__privateGet(this, _encryptionAlgorithm) === "aes-256-gcm") {
        encryptedParts.push(cipher.getAuthTag());
      }
      data = concatUint8Arrays(encryptedParts);
    }
    if (process$1.env.SNAP) {
      fs$k.writeFileSync(this.path, data, { mode: __privateGet(this, _options).configFileMode });
    } else {
      try {
        writeFileSync$1(this.path, data, { mode: __privateGet(this, _options).configFileMode });
      } catch (error2) {
        if ((error2 == null ? void 0 : error2.code) === "EXDEV") {
          fs$k.writeFileSync(this.path, data, { mode: __privateGet(this, _options).configFileMode });
          return;
        }
        throw error2;
      }
    }
  }
  _watch() {
    this._ensureDirectory();
    if (!fs$k.existsSync(this.path)) {
      this._write(createPlainObject());
    }
    if (process$1.platform === "win32" || process$1.platform === "darwin") {
      __privateGet(this, _debouncedChangeHandler) ?? __privateSet(this, _debouncedChangeHandler, debounceFunction(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 100 }));
      const directory = path$d.dirname(this.path);
      const basename = path$d.basename(this.path);
      __privateSet(this, _watcher, fs$k.watch(directory, { persistent: false, encoding: "utf8" }, (_eventType, filename) => {
        if (filename && filename !== basename) {
          return;
        }
        if (typeof __privateGet(this, _debouncedChangeHandler) === "function") {
          __privateGet(this, _debouncedChangeHandler).call(this);
        }
      }));
    } else {
      __privateGet(this, _debouncedChangeHandler) ?? __privateSet(this, _debouncedChangeHandler, debounceFunction(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 1e3 }));
      fs$k.watchFile(this.path, { persistent: false }, (_current, _previous) => {
        if (typeof __privateGet(this, _debouncedChangeHandler) === "function") {
          __privateGet(this, _debouncedChangeHandler).call(this);
        }
      });
      __privateSet(this, _watchFile, true);
    }
  }
  _migrate(migrations, versionToMigrate, beforeEachMigration) {
    let previousMigratedVersion = this._get(MIGRATION_KEY, "0.0.0");
    const newerVersions = Object.keys(migrations).filter((candidateVersion) => this._shouldPerformMigration(candidateVersion, previousMigratedVersion, versionToMigrate));
    let storeBackup = structuredClone(this.store);
    for (const version of newerVersions) {
      try {
        if (beforeEachMigration) {
          beforeEachMigration(this, {
            fromVersion: previousMigratedVersion,
            toVersion: version,
            finalVersion: versionToMigrate,
            versions: newerVersions
          });
        }
        const migration = migrations[version];
        migration == null ? void 0 : migration(this);
        this._set(MIGRATION_KEY, version);
        previousMigratedVersion = version;
        storeBackup = structuredClone(this.store);
      } catch (error2) {
        this.store = storeBackup;
        const errorMessage = error2 instanceof Error ? error2.message : String(error2);
        throw new Error(`Something went wrong during the migration! Changes applied to the store until this failed migration will be restored. ${errorMessage}`);
      }
    }
    if (this._isVersionInRangeFormat(previousMigratedVersion) || !semver$1.eq(previousMigratedVersion, versionToMigrate)) {
      this._set(MIGRATION_KEY, versionToMigrate);
    }
  }
  _containsReservedKey(key) {
    if (typeof key === "string") {
      return this._isReservedKeyPath(key);
    }
    if (!key || typeof key !== "object") {
      return false;
    }
    return this._objectContainsReservedKey(key);
  }
  _objectContainsReservedKey(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    for (const [candidateKey, candidateValue] of Object.entries(value)) {
      if (this._isReservedKeyPath(candidateKey)) {
        return true;
      }
      if (this._objectContainsReservedKey(candidateValue)) {
        return true;
      }
    }
    return false;
  }
  _isReservedKeyPath(candidate) {
    return candidate === INTERNAL_KEY || candidate.startsWith(`${INTERNAL_KEY}.`);
  }
  _isVersionInRangeFormat(version) {
    return semver$1.clean(version) === null;
  }
  _shouldPerformMigration(candidateVersion, previousMigratedVersion, versionToMigrate) {
    if (this._isVersionInRangeFormat(candidateVersion)) {
      if (previousMigratedVersion !== "0.0.0" && semver$1.satisfies(previousMigratedVersion, candidateVersion)) {
        return false;
      }
      return semver$1.satisfies(versionToMigrate, candidateVersion);
    }
    if (semver$1.lte(candidateVersion, previousMigratedVersion)) {
      return false;
    }
    if (semver$1.gt(candidateVersion, versionToMigrate)) {
      return false;
    }
    return true;
  }
  _get(key, defaultValue) {
    return getProperty(this.store, key, defaultValue);
  }
  _set(key, value) {
    const { store } = this;
    setProperty(store, key, value);
    this.store = store;
  }
}
_validator = new WeakMap();
_encryptionKey = new WeakMap();
_encryptionAlgorithm = new WeakMap();
_options = new WeakMap();
_defaultValues = new WeakMap();
_isInMigration = new WeakMap();
_watcher = new WeakMap();
_watchFile = new WeakMap();
_debouncedChangeHandler = new WeakMap();
_Conf_instances = new WeakSet();
prepareOptions_fn = function(partialOptions) {
  const options = {
    configName: "config",
    fileExtension: "json",
    projectSuffix: "nodejs",
    clearInvalidConfig: false,
    accessPropertiesByDotNotation: true,
    configFileMode: 438,
    ...partialOptions
  };
  options.encryptionAlgorithm ?? (options.encryptionAlgorithm = defaultEncryptionAlgorithm);
  if (!isSupportedEncryptionAlgorithm(options.encryptionAlgorithm)) {
    throw new TypeError(`The \`encryptionAlgorithm\` option must be one of: ${[...supportedEncryptionAlgorithms].join(", ")}`);
  }
  if (!options.cwd) {
    if (!options.projectName) {
      throw new Error("Please specify the `projectName` option.");
    }
    options.cwd = envPaths(options.projectName, { suffix: options.projectSuffix }).config;
  }
  if (typeof options.fileExtension === "string") {
    options.fileExtension = options.fileExtension.replace(/^\.+/, "");
  }
  return options;
};
setupValidator_fn = function(options) {
  if (!(options.schema ?? options.ajvOptions ?? options.rootSchema)) {
    return;
  }
  if (options.schema && typeof options.schema !== "object") {
    throw new TypeError("The `schema` option must be an object.");
  }
  const ajvFormats = ajvFormatsModule.default;
  const ajv2 = new _2020Exports.Ajv2020({
    allErrors: true,
    useDefaults: true,
    ...options.ajvOptions
  });
  ajvFormats(ajv2);
  const schema = {
    ...options.rootSchema,
    type: "object",
    properties: options.schema
  };
  __privateSet(this, _validator, ajv2.compile(schema));
  __privateMethod(this, _Conf_instances, captureSchemaDefaults_fn).call(this, options.schema);
};
captureSchemaDefaults_fn = function(schemaConfig) {
  const schemaEntries = Object.entries(schemaConfig ?? {});
  for (const [key, schemaDefinition] of schemaEntries) {
    if (!schemaDefinition || typeof schemaDefinition !== "object") {
      continue;
    }
    if (!Object.hasOwn(schemaDefinition, "default")) {
      continue;
    }
    const { default: defaultValue } = schemaDefinition;
    if (defaultValue === void 0) {
      continue;
    }
    __privateGet(this, _defaultValues)[key] = defaultValue;
  }
};
applyDefaultValues_fn = function(options) {
  if (options.defaults) {
    Object.assign(__privateGet(this, _defaultValues), options.defaults);
  }
};
configureSerialization_fn = function(options) {
  if (options.serialize) {
    this._serialize = options.serialize;
  }
  if (options.deserialize) {
    this._deserialize = options.deserialize;
  }
};
resolvePath_fn = function(options) {
  const normalizedFileExtension = typeof options.fileExtension === "string" ? options.fileExtension : void 0;
  const fileExtension = normalizedFileExtension ? `.${normalizedFileExtension}` : "";
  return path$d.resolve(options.cwd, `${options.configName ?? "config"}${fileExtension}`);
};
initializeStore_fn = function(options) {
  if (options.migrations) {
    __privateMethod(this, _Conf_instances, runMigrations_fn).call(this, options);
    this._validate(this.store);
    return;
  }
  const fileStore = this.store;
  const storeWithDefaults = Object.assign(createPlainObject(), options.defaults ?? {}, fileStore);
  this._validate(storeWithDefaults);
  try {
    assert.deepEqual(fileStore, storeWithDefaults);
  } catch {
    this.store = storeWithDefaults;
  }
};
runMigrations_fn = function(options) {
  const { migrations, projectVersion } = options;
  if (!migrations) {
    return;
  }
  if (!projectVersion) {
    throw new Error("Please specify the `projectVersion` option.");
  }
  __privateSet(this, _isInMigration, true);
  try {
    const fileStore = this.store;
    const storeWithDefaults = Object.assign(createPlainObject(), options.defaults ?? {}, fileStore);
    try {
      assert.deepEqual(fileStore, storeWithDefaults);
    } catch {
      this._write(storeWithDefaults);
    }
    this._migrate(migrations, projectVersion, options.beforeEachMigration);
  } finally {
    __privateSet(this, _isInMigration, false);
  }
};
const { app, ipcMain, shell } = electron;
let isInitialized = false;
const initDataListener = () => {
  if (!ipcMain || !app) {
    throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
  }
  const appData = {
    defaultCwd: app.getPath("userData"),
    appVersion: app.getVersion()
  };
  if (isInitialized) {
    return appData;
  }
  ipcMain.on("electron-store-get-data", (event) => {
    event.returnValue = appData;
  });
  isInitialized = true;
  return appData;
};
class ElectronStore extends Conf {
  constructor(options) {
    let defaultCwd;
    let appVersion;
    if (process$1.type === "renderer") {
      const appData = electron.ipcRenderer.sendSync("electron-store-get-data");
      if (!appData) {
        throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
      }
      ({ defaultCwd, appVersion } = appData);
    } else if (ipcMain && app) {
      ({ defaultCwd, appVersion } = initDataListener());
    }
    options = {
      name: "config",
      ...options
    };
    options.projectVersion || (options.projectVersion = appVersion);
    if (options.cwd) {
      options.cwd = path$d.isAbsolute(options.cwd) ? options.cwd : path$d.join(defaultCwd, options.cwd);
    } else {
      options.cwd = defaultCwd;
    }
    options.configName = options.name;
    delete options.name;
    super(options);
  }
  static initRenderer() {
    initDataListener();
  }
  async openInEditor() {
    const error2 = await shell.openPath(this.path);
    if (error2) {
      throw new Error(error2);
    }
  }
}
var fs$j = {};
var universalify$1 = {};
universalify$1.fromCallback = function(fn) {
  return Object.defineProperty(function(...args) {
    if (typeof args[args.length - 1] === "function") fn.apply(this, args);
    else {
      return new Promise((resolve2, reject) => {
        args.push((err, res) => err != null ? reject(err) : resolve2(res));
        fn.apply(this, args);
      });
    }
  }, "name", { value: fn.name });
};
universalify$1.fromPromise = function(fn) {
  return Object.defineProperty(function(...args) {
    const cb = args[args.length - 1];
    if (typeof cb !== "function") return fn.apply(this, args);
    else {
      args.pop();
      fn.apply(this, args).then((r) => cb(null, r), cb);
    }
  }, "name", { value: fn.name });
};
var constants = require$$0$1;
var origCwd = process.cwd;
var cwd = null;
var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
process.cwd = function() {
  if (!cwd)
    cwd = origCwd.call(process);
  return cwd;
};
try {
  process.cwd();
} catch (er) {
}
if (typeof process.chdir === "function") {
  var chdir = process.chdir;
  process.chdir = function(d) {
    cwd = null;
    chdir.call(process, d);
  };
  if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
}
var polyfills$1 = patch$1;
function patch$1(fs2) {
  if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
    patchLchmod(fs2);
  }
  if (!fs2.lutimes) {
    patchLutimes(fs2);
  }
  fs2.chown = chownFix(fs2.chown);
  fs2.fchown = chownFix(fs2.fchown);
  fs2.lchown = chownFix(fs2.lchown);
  fs2.chmod = chmodFix(fs2.chmod);
  fs2.fchmod = chmodFix(fs2.fchmod);
  fs2.lchmod = chmodFix(fs2.lchmod);
  fs2.chownSync = chownFixSync(fs2.chownSync);
  fs2.fchownSync = chownFixSync(fs2.fchownSync);
  fs2.lchownSync = chownFixSync(fs2.lchownSync);
  fs2.chmodSync = chmodFixSync(fs2.chmodSync);
  fs2.fchmodSync = chmodFixSync(fs2.fchmodSync);
  fs2.lchmodSync = chmodFixSync(fs2.lchmodSync);
  fs2.stat = statFix(fs2.stat);
  fs2.fstat = statFix(fs2.fstat);
  fs2.lstat = statFix(fs2.lstat);
  fs2.statSync = statFixSync(fs2.statSync);
  fs2.fstatSync = statFixSync(fs2.fstatSync);
  fs2.lstatSync = statFixSync(fs2.lstatSync);
  if (fs2.chmod && !fs2.lchmod) {
    fs2.lchmod = function(path2, mode, cb) {
      if (cb) process.nextTick(cb);
    };
    fs2.lchmodSync = function() {
    };
  }
  if (fs2.chown && !fs2.lchown) {
    fs2.lchown = function(path2, uid2, gid, cb) {
      if (cb) process.nextTick(cb);
    };
    fs2.lchownSync = function() {
    };
  }
  if (platform === "win32") {
    fs2.rename = typeof fs2.rename !== "function" ? fs2.rename : function(fs$rename) {
      function rename2(from, to, cb) {
        var start = Date.now();
        var backoff = 0;
        fs$rename(from, to, function CB(er) {
          if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
            setTimeout(function() {
              fs2.stat(to, function(stater, st) {
                if (stater && stater.code === "ENOENT")
                  fs$rename(from, to, CB);
                else
                  cb(er);
              });
            }, backoff);
            if (backoff < 100)
              backoff += 10;
            return;
          }
          if (cb) cb(er);
        });
      }
      if (Object.setPrototypeOf) Object.setPrototypeOf(rename2, fs$rename);
      return rename2;
    }(fs2.rename);
  }
  fs2.read = typeof fs2.read !== "function" ? fs2.read : function(fs$read) {
    function read(fd, buffer, offset, length, position, callback_) {
      var callback;
      if (callback_ && typeof callback_ === "function") {
        var eagCounter = 0;
        callback = function(er, _, __) {
          if (er && er.code === "EAGAIN" && eagCounter < 10) {
            eagCounter++;
            return fs$read.call(fs2, fd, buffer, offset, length, position, callback);
          }
          callback_.apply(this, arguments);
        };
      }
      return fs$read.call(fs2, fd, buffer, offset, length, position, callback);
    }
    if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
    return read;
  }(fs2.read);
  fs2.readSync = typeof fs2.readSync !== "function" ? fs2.readSync : /* @__PURE__ */ function(fs$readSync) {
    return function(fd, buffer, offset, length, position) {
      var eagCounter = 0;
      while (true) {
        try {
          return fs$readSync.call(fs2, fd, buffer, offset, length, position);
        } catch (er) {
          if (er.code === "EAGAIN" && eagCounter < 10) {
            eagCounter++;
            continue;
          }
          throw er;
        }
      }
    };
  }(fs2.readSync);
  function patchLchmod(fs22) {
    fs22.lchmod = function(path2, mode, callback) {
      fs22.open(
        path2,
        constants.O_WRONLY | constants.O_SYMLINK,
        mode,
        function(err, fd) {
          if (err) {
            if (callback) callback(err);
            return;
          }
          fs22.fchmod(fd, mode, function(err2) {
            fs22.close(fd, function(err22) {
              if (callback) callback(err2 || err22);
            });
          });
        }
      );
    };
    fs22.lchmodSync = function(path2, mode) {
      var fd = fs22.openSync(path2, constants.O_WRONLY | constants.O_SYMLINK, mode);
      var threw = true;
      var ret;
      try {
        ret = fs22.fchmodSync(fd, mode);
        threw = false;
      } finally {
        if (threw) {
          try {
            fs22.closeSync(fd);
          } catch (er) {
          }
        } else {
          fs22.closeSync(fd);
        }
      }
      return ret;
    };
  }
  function patchLutimes(fs22) {
    if (constants.hasOwnProperty("O_SYMLINK") && fs22.futimes) {
      fs22.lutimes = function(path2, at2, mt2, cb) {
        fs22.open(path2, constants.O_SYMLINK, function(er, fd) {
          if (er) {
            if (cb) cb(er);
            return;
          }
          fs22.futimes(fd, at2, mt2, function(er2) {
            fs22.close(fd, function(er22) {
              if (cb) cb(er2 || er22);
            });
          });
        });
      };
      fs22.lutimesSync = function(path2, at2, mt2) {
        var fd = fs22.openSync(path2, constants.O_SYMLINK);
        var ret;
        var threw = true;
        try {
          ret = fs22.futimesSync(fd, at2, mt2);
          threw = false;
        } finally {
          if (threw) {
            try {
              fs22.closeSync(fd);
            } catch (er) {
            }
          } else {
            fs22.closeSync(fd);
          }
        }
        return ret;
      };
    } else if (fs22.futimes) {
      fs22.lutimes = function(_a, _b, _c, cb) {
        if (cb) process.nextTick(cb);
      };
      fs22.lutimesSync = function() {
      };
    }
  }
  function chmodFix(orig) {
    if (!orig) return orig;
    return function(target, mode, cb) {
      return orig.call(fs2, target, mode, function(er) {
        if (chownErOk(er)) er = null;
        if (cb) cb.apply(this, arguments);
      });
    };
  }
  function chmodFixSync(orig) {
    if (!orig) return orig;
    return function(target, mode) {
      try {
        return orig.call(fs2, target, mode);
      } catch (er) {
        if (!chownErOk(er)) throw er;
      }
    };
  }
  function chownFix(orig) {
    if (!orig) return orig;
    return function(target, uid2, gid, cb) {
      return orig.call(fs2, target, uid2, gid, function(er) {
        if (chownErOk(er)) er = null;
        if (cb) cb.apply(this, arguments);
      });
    };
  }
  function chownFixSync(orig) {
    if (!orig) return orig;
    return function(target, uid2, gid) {
      try {
        return orig.call(fs2, target, uid2, gid);
      } catch (er) {
        if (!chownErOk(er)) throw er;
      }
    };
  }
  function statFix(orig) {
    if (!orig) return orig;
    return function(target, options, cb) {
      if (typeof options === "function") {
        cb = options;
        options = null;
      }
      function callback(er, stats) {
        if (stats) {
          if (stats.uid < 0) stats.uid += 4294967296;
          if (stats.gid < 0) stats.gid += 4294967296;
        }
        if (cb) cb.apply(this, arguments);
      }
      return options ? orig.call(fs2, target, options, callback) : orig.call(fs2, target, callback);
    };
  }
  function statFixSync(orig) {
    if (!orig) return orig;
    return function(target, options) {
      var stats = options ? orig.call(fs2, target, options) : orig.call(fs2, target);
      if (stats) {
        if (stats.uid < 0) stats.uid += 4294967296;
        if (stats.gid < 0) stats.gid += 4294967296;
      }
      return stats;
    };
  }
  function chownErOk(er) {
    if (!er)
      return true;
    if (er.code === "ENOSYS")
      return true;
    var nonroot = !process.getuid || process.getuid() !== 0;
    if (nonroot) {
      if (er.code === "EINVAL" || er.code === "EPERM")
        return true;
    }
    return false;
  }
}
var Stream = require$$0$2.Stream;
var legacyStreams = legacy$1;
function legacy$1(fs2) {
  return {
    ReadStream,
    WriteStream
  };
  function ReadStream(path2, options) {
    if (!(this instanceof ReadStream)) return new ReadStream(path2, options);
    Stream.call(this);
    var self2 = this;
    this.path = path2;
    this.fd = null;
    this.readable = true;
    this.paused = false;
    this.flags = "r";
    this.mode = 438;
    this.bufferSize = 64 * 1024;
    options = options || {};
    var keys2 = Object.keys(options);
    for (var index = 0, length = keys2.length; index < length; index++) {
      var key = keys2[index];
      this[key] = options[key];
    }
    if (this.encoding) this.setEncoding(this.encoding);
    if (this.start !== void 0) {
      if ("number" !== typeof this.start) {
        throw TypeError("start must be a Number");
      }
      if (this.end === void 0) {
        this.end = Infinity;
      } else if ("number" !== typeof this.end) {
        throw TypeError("end must be a Number");
      }
      if (this.start > this.end) {
        throw new Error("start must be <= end");
      }
      this.pos = this.start;
    }
    if (this.fd !== null) {
      process.nextTick(function() {
        self2._read();
      });
      return;
    }
    fs2.open(this.path, this.flags, this.mode, function(err, fd) {
      if (err) {
        self2.emit("error", err);
        self2.readable = false;
        return;
      }
      self2.fd = fd;
      self2.emit("open", fd);
      self2._read();
    });
  }
  function WriteStream(path2, options) {
    if (!(this instanceof WriteStream)) return new WriteStream(path2, options);
    Stream.call(this);
    this.path = path2;
    this.fd = null;
    this.writable = true;
    this.flags = "w";
    this.encoding = "binary";
    this.mode = 438;
    this.bytesWritten = 0;
    options = options || {};
    var keys2 = Object.keys(options);
    for (var index = 0, length = keys2.length; index < length; index++) {
      var key = keys2[index];
      this[key] = options[key];
    }
    if (this.start !== void 0) {
      if ("number" !== typeof this.start) {
        throw TypeError("start must be a Number");
      }
      if (this.start < 0) {
        throw new Error("start must be >= zero");
      }
      this.pos = this.start;
    }
    this.busy = false;
    this._queue = [];
    if (this.fd === null) {
      this._open = fs2.open;
      this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
      this.flush();
    }
  }
}
var clone_1 = clone$1;
var getPrototypeOf = Object.getPrototypeOf || function(obj) {
  return obj.__proto__;
};
function clone$1(obj) {
  if (obj === null || typeof obj !== "object")
    return obj;
  if (obj instanceof Object)
    var copy2 = { __proto__: getPrototypeOf(obj) };
  else
    var copy2 = /* @__PURE__ */ Object.create(null);
  Object.getOwnPropertyNames(obj).forEach(function(key) {
    Object.defineProperty(copy2, key, Object.getOwnPropertyDescriptor(obj, key));
  });
  return copy2;
}
var fs$i = require$$0$3;
var polyfills = polyfills$1;
var legacy = legacyStreams;
var clone = clone_1;
var util = require$$1$1;
var gracefulQueue;
var previousSymbol;
if (typeof Symbol === "function" && typeof Symbol.for === "function") {
  gracefulQueue = Symbol.for("graceful-fs.queue");
  previousSymbol = Symbol.for("graceful-fs.previous");
} else {
  gracefulQueue = "___graceful-fs.queue";
  previousSymbol = "___graceful-fs.previous";
}
function noop() {
}
function publishQueue(context, queue2) {
  Object.defineProperty(context, gracefulQueue, {
    get: function() {
      return queue2;
    }
  });
}
var debug = noop;
if (util.debuglog)
  debug = util.debuglog("gfs4");
else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
  debug = function() {
    var m = util.format.apply(util, arguments);
    m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
    console.error(m);
  };
if (!fs$i[gracefulQueue]) {
  var queue = commonjsGlobal[gracefulQueue] || [];
  publishQueue(fs$i, queue);
  fs$i.close = function(fs$close) {
    function close(fd, cb) {
      return fs$close.call(fs$i, fd, function(err) {
        if (!err) {
          resetQueue();
        }
        if (typeof cb === "function")
          cb.apply(this, arguments);
      });
    }
    Object.defineProperty(close, previousSymbol, {
      value: fs$close
    });
    return close;
  }(fs$i.close);
  fs$i.closeSync = function(fs$closeSync) {
    function closeSync(fd) {
      fs$closeSync.apply(fs$i, arguments);
      resetQueue();
    }
    Object.defineProperty(closeSync, previousSymbol, {
      value: fs$closeSync
    });
    return closeSync;
  }(fs$i.closeSync);
  if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
    process.on("exit", function() {
      debug(fs$i[gracefulQueue]);
      require$$5$1.equal(fs$i[gracefulQueue].length, 0);
    });
  }
}
if (!commonjsGlobal[gracefulQueue]) {
  publishQueue(commonjsGlobal, fs$i[gracefulQueue]);
}
var gracefulFs = patch(clone(fs$i));
if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs$i.__patched) {
  gracefulFs = patch(fs$i);
  fs$i.__patched = true;
}
function patch(fs2) {
  polyfills(fs2);
  fs2.gracefulify = patch;
  fs2.createReadStream = createReadStream;
  fs2.createWriteStream = createWriteStream;
  var fs$readFile = fs2.readFile;
  fs2.readFile = readFile2;
  function readFile2(path2, options, cb) {
    if (typeof options === "function")
      cb = options, options = null;
    return go$readFile(path2, options, cb);
    function go$readFile(path22, options2, cb2, startTime) {
      return fs$readFile(path22, options2, function(err) {
        if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
          enqueue([go$readFile, [path22, options2, cb2], err, startTime || Date.now(), Date.now()]);
        else {
          if (typeof cb2 === "function")
            cb2.apply(this, arguments);
        }
      });
    }
  }
  var fs$writeFile = fs2.writeFile;
  fs2.writeFile = writeFile2;
  function writeFile2(path2, data, options, cb) {
    if (typeof options === "function")
      cb = options, options = null;
    return go$writeFile(path2, data, options, cb);
    function go$writeFile(path22, data2, options2, cb2, startTime) {
      return fs$writeFile(path22, data2, options2, function(err) {
        if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
          enqueue([go$writeFile, [path22, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
        else {
          if (typeof cb2 === "function")
            cb2.apply(this, arguments);
        }
      });
    }
  }
  var fs$appendFile = fs2.appendFile;
  if (fs$appendFile)
    fs2.appendFile = appendFile;
  function appendFile(path2, data, options, cb) {
    if (typeof options === "function")
      cb = options, options = null;
    return go$appendFile(path2, data, options, cb);
    function go$appendFile(path22, data2, options2, cb2, startTime) {
      return fs$appendFile(path22, data2, options2, function(err) {
        if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
          enqueue([go$appendFile, [path22, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
        else {
          if (typeof cb2 === "function")
            cb2.apply(this, arguments);
        }
      });
    }
  }
  var fs$copyFile = fs2.copyFile;
  if (fs$copyFile)
    fs2.copyFile = copyFile2;
  function copyFile2(src, dest, flags, cb) {
    if (typeof flags === "function") {
      cb = flags;
      flags = 0;
    }
    return go$copyFile(src, dest, flags, cb);
    function go$copyFile(src2, dest2, flags2, cb2, startTime) {
      return fs$copyFile(src2, dest2, flags2, function(err) {
        if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
          enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
        else {
          if (typeof cb2 === "function")
            cb2.apply(this, arguments);
        }
      });
    }
  }
  var fs$readdir = fs2.readdir;
  fs2.readdir = readdir;
  var noReaddirOptionVersions = /^v[0-5]\./;
  function readdir(path2, options, cb) {
    if (typeof options === "function")
      cb = options, options = null;
    var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path22, options2, cb2, startTime) {
      return fs$readdir(path22, fs$readdirCallback(
        path22,
        options2,
        cb2,
        startTime
      ));
    } : function go$readdir2(path22, options2, cb2, startTime) {
      return fs$readdir(path22, options2, fs$readdirCallback(
        path22,
        options2,
        cb2,
        startTime
      ));
    };
    return go$readdir(path2, options, cb);
    function fs$readdirCallback(path22, options2, cb2, startTime) {
      return function(err, files) {
        if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
          enqueue([
            go$readdir,
            [path22, options2, cb2],
            err,
            startTime || Date.now(),
            Date.now()
          ]);
        else {
          if (files && files.sort)
            files.sort();
          if (typeof cb2 === "function")
            cb2.call(this, err, files);
        }
      };
    }
  }
  if (process.version.substr(0, 4) === "v0.8") {
    var legStreams = legacy(fs2);
    ReadStream = legStreams.ReadStream;
    WriteStream = legStreams.WriteStream;
  }
  var fs$ReadStream = fs2.ReadStream;
  if (fs$ReadStream) {
    ReadStream.prototype = Object.create(fs$ReadStream.prototype);
    ReadStream.prototype.open = ReadStream$open;
  }
  var fs$WriteStream = fs2.WriteStream;
  if (fs$WriteStream) {
    WriteStream.prototype = Object.create(fs$WriteStream.prototype);
    WriteStream.prototype.open = WriteStream$open;
  }
  Object.defineProperty(fs2, "ReadStream", {
    get: function() {
      return ReadStream;
    },
    set: function(val) {
      ReadStream = val;
    },
    enumerable: true,
    configurable: true
  });
  Object.defineProperty(fs2, "WriteStream", {
    get: function() {
      return WriteStream;
    },
    set: function(val) {
      WriteStream = val;
    },
    enumerable: true,
    configurable: true
  });
  var FileReadStream = ReadStream;
  Object.defineProperty(fs2, "FileReadStream", {
    get: function() {
      return FileReadStream;
    },
    set: function(val) {
      FileReadStream = val;
    },
    enumerable: true,
    configurable: true
  });
  var FileWriteStream = WriteStream;
  Object.defineProperty(fs2, "FileWriteStream", {
    get: function() {
      return FileWriteStream;
    },
    set: function(val) {
      FileWriteStream = val;
    },
    enumerable: true,
    configurable: true
  });
  function ReadStream(path2, options) {
    if (this instanceof ReadStream)
      return fs$ReadStream.apply(this, arguments), this;
    else
      return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
  }
  function ReadStream$open() {
    var that = this;
    open(that.path, that.flags, that.mode, function(err, fd) {
      if (err) {
        if (that.autoClose)
          that.destroy();
        that.emit("error", err);
      } else {
        that.fd = fd;
        that.emit("open", fd);
        that.read();
      }
    });
  }
  function WriteStream(path2, options) {
    if (this instanceof WriteStream)
      return fs$WriteStream.apply(this, arguments), this;
    else
      return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
  }
  function WriteStream$open() {
    var that = this;
    open(that.path, that.flags, that.mode, function(err, fd) {
      if (err) {
        that.destroy();
        that.emit("error", err);
      } else {
        that.fd = fd;
        that.emit("open", fd);
      }
    });
  }
  function createReadStream(path2, options) {
    return new fs2.ReadStream(path2, options);
  }
  function createWriteStream(path2, options) {
    return new fs2.WriteStream(path2, options);
  }
  var fs$open = fs2.open;
  fs2.open = open;
  function open(path2, flags, mode, cb) {
    if (typeof mode === "function")
      cb = mode, mode = null;
    return go$open(path2, flags, mode, cb);
    function go$open(path22, flags2, mode2, cb2, startTime) {
      return fs$open(path22, flags2, mode2, function(err, fd) {
        if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
          enqueue([go$open, [path22, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
        else {
          if (typeof cb2 === "function")
            cb2.apply(this, arguments);
        }
      });
    }
  }
  return fs2;
}
function enqueue(elem) {
  debug("ENQUEUE", elem[0].name, elem[1]);
  fs$i[gracefulQueue].push(elem);
  retry();
}
var retryTimer;
function resetQueue() {
  var now = Date.now();
  for (var i = 0; i < fs$i[gracefulQueue].length; ++i) {
    if (fs$i[gracefulQueue][i].length > 2) {
      fs$i[gracefulQueue][i][3] = now;
      fs$i[gracefulQueue][i][4] = now;
    }
  }
  retry();
}
function retry() {
  clearTimeout(retryTimer);
  retryTimer = void 0;
  if (fs$i[gracefulQueue].length === 0)
    return;
  var elem = fs$i[gracefulQueue].shift();
  var fn = elem[0];
  var args = elem[1];
  var err = elem[2];
  var startTime = elem[3];
  var lastTime = elem[4];
  if (startTime === void 0) {
    debug("RETRY", fn.name, args);
    fn.apply(null, args);
  } else if (Date.now() - startTime >= 6e4) {
    debug("TIMEOUT", fn.name, args);
    var cb = args.pop();
    if (typeof cb === "function")
      cb.call(null, err);
  } else {
    var sinceAttempt = Date.now() - lastTime;
    var sinceStart = Math.max(lastTime - startTime, 1);
    var desiredDelay = Math.min(sinceStart * 1.2, 100);
    if (sinceAttempt >= desiredDelay) {
      debug("RETRY", fn.name, args);
      fn.apply(null, args.concat([startTime]));
    } else {
      fs$i[gracefulQueue].push(elem);
    }
  }
  if (retryTimer === void 0) {
    retryTimer = setTimeout(retry, 0);
  }
}
(function(exports$1) {
  const u2 = universalify$1.fromCallback;
  const fs2 = gracefulFs;
  const api = [
    "access",
    "appendFile",
    "chmod",
    "chown",
    "close",
    "copyFile",
    "cp",
    "fchmod",
    "fchown",
    "fdatasync",
    "fstat",
    "fsync",
    "ftruncate",
    "futimes",
    "glob",
    "lchmod",
    "lchown",
    "lutimes",
    "link",
    "lstat",
    "mkdir",
    "mkdtemp",
    "open",
    "opendir",
    "readdir",
    "readFile",
    "readlink",
    "realpath",
    "rename",
    "rm",
    "rmdir",
    "stat",
    "statfs",
    "symlink",
    "truncate",
    "unlink",
    "utimes",
    "writeFile"
  ].filter((key) => {
    return typeof fs2[key] === "function";
  });
  Object.assign(exports$1, fs2);
  api.forEach((method) => {
    exports$1[method] = u2(fs2[method]);
  });
  exports$1.exists = function(filename, callback) {
    if (typeof callback === "function") {
      return fs2.exists(filename, callback);
    }
    return new Promise((resolve2) => {
      return fs2.exists(filename, resolve2);
    });
  };
  exports$1.read = function(fd, buffer, offset, length, position, callback) {
    if (typeof callback === "function") {
      return fs2.read(fd, buffer, offset, length, position, callback);
    }
    return new Promise((resolve2, reject) => {
      fs2.read(fd, buffer, offset, length, position, (err, bytesRead, buffer2) => {
        if (err) return reject(err);
        resolve2({ bytesRead, buffer: buffer2 });
      });
    });
  };
  exports$1.write = function(fd, buffer, ...args) {
    if (typeof args[args.length - 1] === "function") {
      return fs2.write(fd, buffer, ...args);
    }
    return new Promise((resolve2, reject) => {
      fs2.write(fd, buffer, ...args, (err, bytesWritten, buffer2) => {
        if (err) return reject(err);
        resolve2({ bytesWritten, buffer: buffer2 });
      });
    });
  };
  exports$1.readv = function(fd, buffers, ...args) {
    if (typeof args[args.length - 1] === "function") {
      return fs2.readv(fd, buffers, ...args);
    }
    return new Promise((resolve2, reject) => {
      fs2.readv(fd, buffers, ...args, (err, bytesRead, buffers2) => {
        if (err) return reject(err);
        resolve2({ bytesRead, buffers: buffers2 });
      });
    });
  };
  exports$1.writev = function(fd, buffers, ...args) {
    if (typeof args[args.length - 1] === "function") {
      return fs2.writev(fd, buffers, ...args);
    }
    return new Promise((resolve2, reject) => {
      fs2.writev(fd, buffers, ...args, (err, bytesWritten, buffers2) => {
        if (err) return reject(err);
        resolve2({ bytesWritten, buffers: buffers2 });
      });
    });
  };
  if (typeof fs2.realpath.native === "function") {
    exports$1.realpath.native = u2(fs2.realpath.native);
  } else {
    process.emitWarning(
      "fs.realpath.native is not a function. Is fs being monkey-patched?",
      "Warning",
      "fs-extra-WARN0003"
    );
  }
})(fs$j);
var makeDir$1 = {};
var utils$2 = {};
const path$c = path$e;
utils$2.checkPath = function checkPath(pth) {
  if (process.platform === "win32") {
    const pathHasInvalidWinCharacters = /[<>:"|?*]/.test(pth.replace(path$c.parse(pth).root, ""));
    if (pathHasInvalidWinCharacters) {
      const error2 = new Error(`Path contains invalid characters: ${pth}`);
      error2.code = "EINVAL";
      throw error2;
    }
  }
};
const fs$h = fs$j;
const { checkPath: checkPath2 } = utils$2;
const getMode = (options) => {
  const defaults2 = { mode: 511 };
  if (typeof options === "number") return options;
  return { ...defaults2, ...options }.mode;
};
makeDir$1.makeDir = async (dir, options) => {
  checkPath2(dir);
  return fs$h.mkdir(dir, {
    mode: getMode(options),
    recursive: true
  });
};
makeDir$1.makeDirSync = (dir, options) => {
  checkPath2(dir);
  return fs$h.mkdirSync(dir, {
    mode: getMode(options),
    recursive: true
  });
};
const u$e = universalify$1.fromPromise;
const { makeDir: _makeDir, makeDirSync } = makeDir$1;
const makeDir = u$e(_makeDir);
var mkdirs$2 = {
  mkdirs: makeDir,
  mkdirsSync: makeDirSync,
  // alias
  mkdirp: makeDir,
  mkdirpSync: makeDirSync,
  ensureDir: makeDir,
  ensureDirSync: makeDirSync
};
const u$d = universalify$1.fromPromise;
const fs$g = fs$j;
function pathExists$6(path2) {
  return fs$g.access(path2).then(() => true).catch(() => false);
}
var pathExists_1 = {
  pathExists: u$d(pathExists$6),
  pathExistsSync: fs$g.existsSync
};
const fs$f = fs$j;
const u$c = universalify$1.fromPromise;
async function utimesMillis$1(path2, atime, mtime) {
  const fd = await fs$f.open(path2, "r+");
  let closeErr = null;
  try {
    await fs$f.futimes(fd, atime, mtime);
  } finally {
    try {
      await fs$f.close(fd);
    } catch (e) {
      closeErr = e;
    }
  }
  if (closeErr) {
    throw closeErr;
  }
}
function utimesMillisSync$1(path2, atime, mtime) {
  const fd = fs$f.openSync(path2, "r+");
  fs$f.futimesSync(fd, atime, mtime);
  return fs$f.closeSync(fd);
}
var utimes = {
  utimesMillis: u$c(utimesMillis$1),
  utimesMillisSync: utimesMillisSync$1
};
const fs$e = fs$j;
const path$b = path$e;
const u$b = universalify$1.fromPromise;
function getStats$1(src, dest, opts) {
  const statFunc = opts.dereference ? (file2) => fs$e.stat(file2, { bigint: true }) : (file2) => fs$e.lstat(file2, { bigint: true });
  return Promise.all([
    statFunc(src),
    statFunc(dest).catch((err) => {
      if (err.code === "ENOENT") return null;
      throw err;
    })
  ]).then(([srcStat, destStat]) => ({ srcStat, destStat }));
}
function getStatsSync(src, dest, opts) {
  let destStat;
  const statFunc = opts.dereference ? (file2) => fs$e.statSync(file2, { bigint: true }) : (file2) => fs$e.lstatSync(file2, { bigint: true });
  const srcStat = statFunc(src);
  try {
    destStat = statFunc(dest);
  } catch (err) {
    if (err.code === "ENOENT") return { srcStat, destStat: null };
    throw err;
  }
  return { srcStat, destStat };
}
async function checkPaths(src, dest, funcName, opts) {
  const { srcStat, destStat } = await getStats$1(src, dest, opts);
  if (destStat) {
    if (areIdentical$2(srcStat, destStat)) {
      const srcBaseName = path$b.basename(src);
      const destBaseName = path$b.basename(dest);
      if (funcName === "move" && srcBaseName !== destBaseName && srcBaseName.toLowerCase() === destBaseName.toLowerCase()) {
        return { srcStat, destStat, isChangingCase: true };
      }
      throw new Error("Source and destination must not be the same.");
    }
    if (srcStat.isDirectory() && !destStat.isDirectory()) {
      throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src}'.`);
    }
    if (!srcStat.isDirectory() && destStat.isDirectory()) {
      throw new Error(`Cannot overwrite directory '${dest}' with non-directory '${src}'.`);
    }
  }
  if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
    throw new Error(errMsg(src, dest, funcName));
  }
  return { srcStat, destStat };
}
function checkPathsSync(src, dest, funcName, opts) {
  const { srcStat, destStat } = getStatsSync(src, dest, opts);
  if (destStat) {
    if (areIdentical$2(srcStat, destStat)) {
      const srcBaseName = path$b.basename(src);
      const destBaseName = path$b.basename(dest);
      if (funcName === "move" && srcBaseName !== destBaseName && srcBaseName.toLowerCase() === destBaseName.toLowerCase()) {
        return { srcStat, destStat, isChangingCase: true };
      }
      throw new Error("Source and destination must not be the same.");
    }
    if (srcStat.isDirectory() && !destStat.isDirectory()) {
      throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src}'.`);
    }
    if (!srcStat.isDirectory() && destStat.isDirectory()) {
      throw new Error(`Cannot overwrite directory '${dest}' with non-directory '${src}'.`);
    }
  }
  if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
    throw new Error(errMsg(src, dest, funcName));
  }
  return { srcStat, destStat };
}
async function checkParentPaths(src, srcStat, dest, funcName) {
  const srcParent = path$b.resolve(path$b.dirname(src));
  const destParent = path$b.resolve(path$b.dirname(dest));
  if (destParent === srcParent || destParent === path$b.parse(destParent).root) return;
  let destStat;
  try {
    destStat = await fs$e.stat(destParent, { bigint: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  if (areIdentical$2(srcStat, destStat)) {
    throw new Error(errMsg(src, dest, funcName));
  }
  return checkParentPaths(src, srcStat, destParent, funcName);
}
function checkParentPathsSync(src, srcStat, dest, funcName) {
  const srcParent = path$b.resolve(path$b.dirname(src));
  const destParent = path$b.resolve(path$b.dirname(dest));
  if (destParent === srcParent || destParent === path$b.parse(destParent).root) return;
  let destStat;
  try {
    destStat = fs$e.statSync(destParent, { bigint: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  if (areIdentical$2(srcStat, destStat)) {
    throw new Error(errMsg(src, dest, funcName));
  }
  return checkParentPathsSync(src, srcStat, destParent, funcName);
}
function areIdentical$2(srcStat, destStat) {
  return destStat.ino !== void 0 && destStat.dev !== void 0 && destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
}
function isSrcSubdir(src, dest) {
  const srcArr = path$b.resolve(src).split(path$b.sep).filter((i) => i);
  const destArr = path$b.resolve(dest).split(path$b.sep).filter((i) => i);
  return srcArr.every((cur, i) => destArr[i] === cur);
}
function errMsg(src, dest, funcName) {
  return `Cannot ${funcName} '${src}' to a subdirectory of itself, '${dest}'.`;
}
var stat$4 = {
  // checkPaths
  checkPaths: u$b(checkPaths),
  checkPathsSync,
  // checkParent
  checkParentPaths: u$b(checkParentPaths),
  checkParentPathsSync,
  // Misc
  isSrcSubdir,
  areIdentical: areIdentical$2
};
async function asyncIteratorConcurrentProcess$1(iterator, fn) {
  const promises = [];
  for await (const item of iterator) {
    promises.push(
      fn(item).then(
        () => null,
        (err) => err ?? new Error("unknown error")
      )
    );
  }
  await Promise.all(
    promises.map(
      (promise) => promise.then((possibleErr) => {
        if (possibleErr !== null) throw possibleErr;
      })
    )
  );
}
var async = {
  asyncIteratorConcurrentProcess: asyncIteratorConcurrentProcess$1
};
const fs$d = fs$j;
const path$a = path$e;
const { mkdirs: mkdirs$1 } = mkdirs$2;
const { pathExists: pathExists$5 } = pathExists_1;
const { utimesMillis } = utimes;
const stat$3 = stat$4;
const { asyncIteratorConcurrentProcess } = async;
async function copy$2(src, dest, opts = {}) {
  if (typeof opts === "function") {
    opts = { filter: opts };
  }
  opts.clobber = "clobber" in opts ? !!opts.clobber : true;
  opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
  if (opts.preserveTimestamps && process.arch === "ia32") {
    process.emitWarning(
      "Using the preserveTimestamps option in 32-bit node is not recommended;\n\n	see https://github.com/jprichardson/node-fs-extra/issues/269",
      "Warning",
      "fs-extra-WARN0001"
    );
  }
  const { srcStat, destStat } = await stat$3.checkPaths(src, dest, "copy", opts);
  await stat$3.checkParentPaths(src, srcStat, dest, "copy");
  const include = await runFilter(src, dest, opts);
  if (!include) return;
  const destParent = path$a.dirname(dest);
  const dirExists = await pathExists$5(destParent);
  if (!dirExists) {
    await mkdirs$1(destParent);
  }
  await getStatsAndPerformCopy(destStat, src, dest, opts);
}
async function runFilter(src, dest, opts) {
  if (!opts.filter) return true;
  return opts.filter(src, dest);
}
async function getStatsAndPerformCopy(destStat, src, dest, opts) {
  const statFn = opts.dereference ? fs$d.stat : fs$d.lstat;
  const srcStat = await statFn(src);
  if (srcStat.isDirectory()) return onDir$1(srcStat, destStat, src, dest, opts);
  if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) return onFile$1(srcStat, destStat, src, dest, opts);
  if (srcStat.isSymbolicLink()) return onLink$1(destStat, src, dest, opts);
  if (srcStat.isSocket()) throw new Error(`Cannot copy a socket file: ${src}`);
  if (srcStat.isFIFO()) throw new Error(`Cannot copy a FIFO pipe: ${src}`);
  throw new Error(`Unknown file: ${src}`);
}
async function onFile$1(srcStat, destStat, src, dest, opts) {
  if (!destStat) return copyFile$1(srcStat, src, dest, opts);
  if (opts.overwrite) {
    await fs$d.unlink(dest);
    return copyFile$1(srcStat, src, dest, opts);
  }
  if (opts.errorOnExist) {
    throw new Error(`'${dest}' already exists`);
  }
}
async function copyFile$1(srcStat, src, dest, opts) {
  await fs$d.copyFile(src, dest);
  if (opts.preserveTimestamps) {
    if (fileIsNotWritable$1(srcStat.mode)) {
      await makeFileWritable$1(dest, srcStat.mode);
    }
    const updatedSrcStat = await fs$d.stat(src);
    await utimesMillis(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
  }
  return fs$d.chmod(dest, srcStat.mode);
}
function fileIsNotWritable$1(srcMode) {
  return (srcMode & 128) === 0;
}
function makeFileWritable$1(dest, srcMode) {
  return fs$d.chmod(dest, srcMode | 128);
}
async function onDir$1(srcStat, destStat, src, dest, opts) {
  if (!destStat) {
    await fs$d.mkdir(dest);
  }
  await asyncIteratorConcurrentProcess(await fs$d.opendir(src), async (item) => {
    const srcItem = path$a.join(src, item.name);
    const destItem = path$a.join(dest, item.name);
    const include = await runFilter(srcItem, destItem, opts);
    if (include) {
      const { destStat: destStat2 } = await stat$3.checkPaths(srcItem, destItem, "copy", opts);
      await getStatsAndPerformCopy(destStat2, srcItem, destItem, opts);
    }
  });
  if (!destStat) {
    await fs$d.chmod(dest, srcStat.mode);
  }
}
async function onLink$1(destStat, src, dest, opts) {
  let resolvedSrc = await fs$d.readlink(src);
  if (opts.dereference) {
    resolvedSrc = path$a.resolve(process.cwd(), resolvedSrc);
  }
  if (!destStat) {
    return fs$d.symlink(resolvedSrc, dest);
  }
  let resolvedDest = null;
  try {
    resolvedDest = await fs$d.readlink(dest);
  } catch (e) {
    if (e.code === "EINVAL" || e.code === "UNKNOWN") return fs$d.symlink(resolvedSrc, dest);
    throw e;
  }
  if (opts.dereference) {
    resolvedDest = path$a.resolve(process.cwd(), resolvedDest);
  }
  if (resolvedSrc !== resolvedDest) {
    if (stat$3.isSrcSubdir(resolvedSrc, resolvedDest)) {
      throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
    }
    if (stat$3.isSrcSubdir(resolvedDest, resolvedSrc)) {
      throw new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`);
    }
  }
  await fs$d.unlink(dest);
  return fs$d.symlink(resolvedSrc, dest);
}
var copy_1 = copy$2;
const fs$c = gracefulFs;
const path$9 = path$e;
const mkdirsSync$1 = mkdirs$2.mkdirsSync;
const utimesMillisSync = utimes.utimesMillisSync;
const stat$2 = stat$4;
function copySync$1(src, dest, opts) {
  if (typeof opts === "function") {
    opts = { filter: opts };
  }
  opts = opts || {};
  opts.clobber = "clobber" in opts ? !!opts.clobber : true;
  opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
  if (opts.preserveTimestamps && process.arch === "ia32") {
    process.emitWarning(
      "Using the preserveTimestamps option in 32-bit node is not recommended;\n\n	see https://github.com/jprichardson/node-fs-extra/issues/269",
      "Warning",
      "fs-extra-WARN0002"
    );
  }
  const { srcStat, destStat } = stat$2.checkPathsSync(src, dest, "copy", opts);
  stat$2.checkParentPathsSync(src, srcStat, dest, "copy");
  if (opts.filter && !opts.filter(src, dest)) return;
  const destParent = path$9.dirname(dest);
  if (!fs$c.existsSync(destParent)) mkdirsSync$1(destParent);
  return getStats(destStat, src, dest, opts);
}
function getStats(destStat, src, dest, opts) {
  const statSync = opts.dereference ? fs$c.statSync : fs$c.lstatSync;
  const srcStat = statSync(src);
  if (srcStat.isDirectory()) return onDir(srcStat, destStat, src, dest, opts);
  else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) return onFile(srcStat, destStat, src, dest, opts);
  else if (srcStat.isSymbolicLink()) return onLink(destStat, src, dest, opts);
  else if (srcStat.isSocket()) throw new Error(`Cannot copy a socket file: ${src}`);
  else if (srcStat.isFIFO()) throw new Error(`Cannot copy a FIFO pipe: ${src}`);
  throw new Error(`Unknown file: ${src}`);
}
function onFile(srcStat, destStat, src, dest, opts) {
  if (!destStat) return copyFile(srcStat, src, dest, opts);
  return mayCopyFile(srcStat, src, dest, opts);
}
function mayCopyFile(srcStat, src, dest, opts) {
  if (opts.overwrite) {
    fs$c.unlinkSync(dest);
    return copyFile(srcStat, src, dest, opts);
  } else if (opts.errorOnExist) {
    throw new Error(`'${dest}' already exists`);
  }
}
function copyFile(srcStat, src, dest, opts) {
  fs$c.copyFileSync(src, dest);
  if (opts.preserveTimestamps) handleTimestamps(srcStat.mode, src, dest);
  return setDestMode(dest, srcStat.mode);
}
function handleTimestamps(srcMode, src, dest) {
  if (fileIsNotWritable(srcMode)) makeFileWritable(dest, srcMode);
  return setDestTimestamps(src, dest);
}
function fileIsNotWritable(srcMode) {
  return (srcMode & 128) === 0;
}
function makeFileWritable(dest, srcMode) {
  return setDestMode(dest, srcMode | 128);
}
function setDestMode(dest, srcMode) {
  return fs$c.chmodSync(dest, srcMode);
}
function setDestTimestamps(src, dest) {
  const updatedSrcStat = fs$c.statSync(src);
  return utimesMillisSync(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
}
function onDir(srcStat, destStat, src, dest, opts) {
  if (!destStat) return mkDirAndCopy(srcStat.mode, src, dest, opts);
  return copyDir(src, dest, opts);
}
function mkDirAndCopy(srcMode, src, dest, opts) {
  fs$c.mkdirSync(dest);
  copyDir(src, dest, opts);
  return setDestMode(dest, srcMode);
}
function copyDir(src, dest, opts) {
  const dir = fs$c.opendirSync(src);
  try {
    let dirent;
    while ((dirent = dir.readSync()) !== null) {
      copyDirItem(dirent.name, src, dest, opts);
    }
  } finally {
    dir.closeSync();
  }
}
function copyDirItem(item, src, dest, opts) {
  const srcItem = path$9.join(src, item);
  const destItem = path$9.join(dest, item);
  if (opts.filter && !opts.filter(srcItem, destItem)) return;
  const { destStat } = stat$2.checkPathsSync(srcItem, destItem, "copy", opts);
  return getStats(destStat, srcItem, destItem, opts);
}
function onLink(destStat, src, dest, opts) {
  let resolvedSrc = fs$c.readlinkSync(src);
  if (opts.dereference) {
    resolvedSrc = path$9.resolve(process.cwd(), resolvedSrc);
  }
  if (!destStat) {
    return fs$c.symlinkSync(resolvedSrc, dest);
  } else {
    let resolvedDest;
    try {
      resolvedDest = fs$c.readlinkSync(dest);
    } catch (err) {
      if (err.code === "EINVAL" || err.code === "UNKNOWN") return fs$c.symlinkSync(resolvedSrc, dest);
      throw err;
    }
    if (opts.dereference) {
      resolvedDest = path$9.resolve(process.cwd(), resolvedDest);
    }
    if (resolvedSrc !== resolvedDest) {
      if (stat$2.isSrcSubdir(resolvedSrc, resolvedDest)) {
        throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
      }
      if (stat$2.isSrcSubdir(resolvedDest, resolvedSrc)) {
        throw new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`);
      }
    }
    return copyLink(resolvedSrc, dest);
  }
}
function copyLink(resolvedSrc, dest) {
  fs$c.unlinkSync(dest);
  return fs$c.symlinkSync(resolvedSrc, dest);
}
var copySync_1 = copySync$1;
const u$a = universalify$1.fromPromise;
var copy$1 = {
  copy: u$a(copy_1),
  copySync: copySync_1
};
const fs$b = gracefulFs;
const u$9 = universalify$1.fromCallback;
function remove$2(path2, callback) {
  fs$b.rm(path2, { recursive: true, force: true }, callback);
}
function removeSync$1(path2) {
  fs$b.rmSync(path2, { recursive: true, force: true });
}
var remove_1 = {
  remove: u$9(remove$2),
  removeSync: removeSync$1
};
const u$8 = universalify$1.fromPromise;
const fs$a = fs$j;
const path$8 = path$e;
const mkdir$3 = mkdirs$2;
const remove$1 = remove_1;
const emptyDir = u$8(async function emptyDir2(dir) {
  let items2;
  try {
    items2 = await fs$a.readdir(dir);
  } catch {
    return mkdir$3.mkdirs(dir);
  }
  return Promise.all(items2.map((item) => remove$1.remove(path$8.join(dir, item))));
});
function emptyDirSync(dir) {
  let items2;
  try {
    items2 = fs$a.readdirSync(dir);
  } catch {
    return mkdir$3.mkdirsSync(dir);
  }
  items2.forEach((item) => {
    item = path$8.join(dir, item);
    remove$1.removeSync(item);
  });
}
var empty = {
  emptyDirSync,
  emptydirSync: emptyDirSync,
  emptyDir,
  emptydir: emptyDir
};
const u$7 = universalify$1.fromPromise;
const path$7 = path$e;
const fs$9 = fs$j;
const mkdir$2 = mkdirs$2;
async function createFile$1(file2) {
  let stats;
  try {
    stats = await fs$9.stat(file2);
  } catch {
  }
  if (stats && stats.isFile()) return;
  const dir = path$7.dirname(file2);
  let dirStats = null;
  try {
    dirStats = await fs$9.stat(dir);
  } catch (err) {
    if (err.code === "ENOENT") {
      await mkdir$2.mkdirs(dir);
      await fs$9.writeFile(file2, "");
      return;
    } else {
      throw err;
    }
  }
  if (dirStats.isDirectory()) {
    await fs$9.writeFile(file2, "");
  } else {
    await fs$9.readdir(dir);
  }
}
function createFileSync$1(file2) {
  let stats;
  try {
    stats = fs$9.statSync(file2);
  } catch {
  }
  if (stats && stats.isFile()) return;
  const dir = path$7.dirname(file2);
  try {
    if (!fs$9.statSync(dir).isDirectory()) {
      fs$9.readdirSync(dir);
    }
  } catch (err) {
    if (err && err.code === "ENOENT") mkdir$2.mkdirsSync(dir);
    else throw err;
  }
  fs$9.writeFileSync(file2, "");
}
var file = {
  createFile: u$7(createFile$1),
  createFileSync: createFileSync$1
};
const u$6 = universalify$1.fromPromise;
const path$6 = path$e;
const fs$8 = fs$j;
const mkdir$1 = mkdirs$2;
const { pathExists: pathExists$4 } = pathExists_1;
const { areIdentical: areIdentical$1 } = stat$4;
async function createLink$1(srcpath, dstpath) {
  let dstStat;
  try {
    dstStat = await fs$8.lstat(dstpath);
  } catch {
  }
  let srcStat;
  try {
    srcStat = await fs$8.lstat(srcpath);
  } catch (err) {
    err.message = err.message.replace("lstat", "ensureLink");
    throw err;
  }
  if (dstStat && areIdentical$1(srcStat, dstStat)) return;
  const dir = path$6.dirname(dstpath);
  const dirExists = await pathExists$4(dir);
  if (!dirExists) {
    await mkdir$1.mkdirs(dir);
  }
  await fs$8.link(srcpath, dstpath);
}
function createLinkSync$1(srcpath, dstpath) {
  let dstStat;
  try {
    dstStat = fs$8.lstatSync(dstpath);
  } catch {
  }
  try {
    const srcStat = fs$8.lstatSync(srcpath);
    if (dstStat && areIdentical$1(srcStat, dstStat)) return;
  } catch (err) {
    err.message = err.message.replace("lstat", "ensureLink");
    throw err;
  }
  const dir = path$6.dirname(dstpath);
  const dirExists = fs$8.existsSync(dir);
  if (dirExists) return fs$8.linkSync(srcpath, dstpath);
  mkdir$1.mkdirsSync(dir);
  return fs$8.linkSync(srcpath, dstpath);
}
var link = {
  createLink: u$6(createLink$1),
  createLinkSync: createLinkSync$1
};
const path$5 = path$e;
const fs$7 = fs$j;
const { pathExists: pathExists$3 } = pathExists_1;
const u$5 = universalify$1.fromPromise;
async function symlinkPaths$1(srcpath, dstpath) {
  if (path$5.isAbsolute(srcpath)) {
    try {
      await fs$7.lstat(srcpath);
    } catch (err) {
      err.message = err.message.replace("lstat", "ensureSymlink");
      throw err;
    }
    return {
      toCwd: srcpath,
      toDst: srcpath
    };
  }
  const dstdir = path$5.dirname(dstpath);
  const relativeToDst = path$5.join(dstdir, srcpath);
  const exists = await pathExists$3(relativeToDst);
  if (exists) {
    return {
      toCwd: relativeToDst,
      toDst: srcpath
    };
  }
  try {
    await fs$7.lstat(srcpath);
  } catch (err) {
    err.message = err.message.replace("lstat", "ensureSymlink");
    throw err;
  }
  return {
    toCwd: srcpath,
    toDst: path$5.relative(dstdir, srcpath)
  };
}
function symlinkPathsSync$1(srcpath, dstpath) {
  if (path$5.isAbsolute(srcpath)) {
    const exists2 = fs$7.existsSync(srcpath);
    if (!exists2) throw new Error("absolute srcpath does not exist");
    return {
      toCwd: srcpath,
      toDst: srcpath
    };
  }
  const dstdir = path$5.dirname(dstpath);
  const relativeToDst = path$5.join(dstdir, srcpath);
  const exists = fs$7.existsSync(relativeToDst);
  if (exists) {
    return {
      toCwd: relativeToDst,
      toDst: srcpath
    };
  }
  const srcExists = fs$7.existsSync(srcpath);
  if (!srcExists) throw new Error("relative srcpath does not exist");
  return {
    toCwd: srcpath,
    toDst: path$5.relative(dstdir, srcpath)
  };
}
var symlinkPaths_1 = {
  symlinkPaths: u$5(symlinkPaths$1),
  symlinkPathsSync: symlinkPathsSync$1
};
const fs$6 = fs$j;
const u$4 = universalify$1.fromPromise;
async function symlinkType$1(srcpath, type2) {
  if (type2) return type2;
  let stats;
  try {
    stats = await fs$6.lstat(srcpath);
  } catch {
    return "file";
  }
  return stats && stats.isDirectory() ? "dir" : "file";
}
function symlinkTypeSync$1(srcpath, type2) {
  if (type2) return type2;
  let stats;
  try {
    stats = fs$6.lstatSync(srcpath);
  } catch {
    return "file";
  }
  return stats && stats.isDirectory() ? "dir" : "file";
}
var symlinkType_1 = {
  symlinkType: u$4(symlinkType$1),
  symlinkTypeSync: symlinkTypeSync$1
};
const u$3 = universalify$1.fromPromise;
const path$4 = path$e;
const fs$5 = fs$j;
const { mkdirs, mkdirsSync } = mkdirs$2;
const { symlinkPaths, symlinkPathsSync } = symlinkPaths_1;
const { symlinkType, symlinkTypeSync } = symlinkType_1;
const { pathExists: pathExists$2 } = pathExists_1;
const { areIdentical } = stat$4;
async function createSymlink$1(srcpath, dstpath, type2) {
  let stats;
  try {
    stats = await fs$5.lstat(dstpath);
  } catch {
  }
  if (stats && stats.isSymbolicLink()) {
    const [srcStat, dstStat] = await Promise.all([
      fs$5.stat(srcpath),
      fs$5.stat(dstpath)
    ]);
    if (areIdentical(srcStat, dstStat)) return;
  }
  const relative = await symlinkPaths(srcpath, dstpath);
  srcpath = relative.toDst;
  const toType = await symlinkType(relative.toCwd, type2);
  const dir = path$4.dirname(dstpath);
  if (!await pathExists$2(dir)) {
    await mkdirs(dir);
  }
  return fs$5.symlink(srcpath, dstpath, toType);
}
function createSymlinkSync$1(srcpath, dstpath, type2) {
  let stats;
  try {
    stats = fs$5.lstatSync(dstpath);
  } catch {
  }
  if (stats && stats.isSymbolicLink()) {
    const srcStat = fs$5.statSync(srcpath);
    const dstStat = fs$5.statSync(dstpath);
    if (areIdentical(srcStat, dstStat)) return;
  }
  const relative = symlinkPathsSync(srcpath, dstpath);
  srcpath = relative.toDst;
  type2 = symlinkTypeSync(relative.toCwd, type2);
  const dir = path$4.dirname(dstpath);
  const exists = fs$5.existsSync(dir);
  if (exists) return fs$5.symlinkSync(srcpath, dstpath, type2);
  mkdirsSync(dir);
  return fs$5.symlinkSync(srcpath, dstpath, type2);
}
var symlink = {
  createSymlink: u$3(createSymlink$1),
  createSymlinkSync: createSymlinkSync$1
};
const { createFile, createFileSync } = file;
const { createLink, createLinkSync } = link;
const { createSymlink, createSymlinkSync } = symlink;
var ensure = {
  // file
  createFile,
  createFileSync,
  ensureFile: createFile,
  ensureFileSync: createFileSync,
  // link
  createLink,
  createLinkSync,
  ensureLink: createLink,
  ensureLinkSync: createLinkSync,
  // symlink
  createSymlink,
  createSymlinkSync,
  ensureSymlink: createSymlink,
  ensureSymlinkSync: createSymlinkSync
};
function stringify$3(obj, { EOL = "\n", finalEOL = true, replacer = null, spaces } = {}) {
  const EOF = finalEOL ? EOL : "";
  const str = JSON.stringify(obj, replacer, spaces);
  return str.replace(/\n/g, EOL) + EOF;
}
function stripBom$1(content2) {
  if (Buffer.isBuffer(content2)) content2 = content2.toString("utf8");
  return content2.replace(/^\uFEFF/, "");
}
var utils$1 = { stringify: stringify$3, stripBom: stripBom$1 };
let _fs;
try {
  _fs = gracefulFs;
} catch (_) {
  _fs = require$$0$3;
}
const universalify = universalify$1;
const { stringify: stringify$2, stripBom } = utils$1;
async function _readFile(file2, options = {}) {
  if (typeof options === "string") {
    options = { encoding: options };
  }
  const fs2 = options.fs || _fs;
  const shouldThrow = "throws" in options ? options.throws : true;
  let data = await universalify.fromCallback(fs2.readFile)(file2, options);
  data = stripBom(data);
  let obj;
  try {
    obj = JSON.parse(data, options ? options.reviver : null);
  } catch (err) {
    if (shouldThrow) {
      err.message = `${file2}: ${err.message}`;
      throw err;
    } else {
      return null;
    }
  }
  return obj;
}
const readFile = universalify.fromPromise(_readFile);
function readFileSync(file2, options = {}) {
  if (typeof options === "string") {
    options = { encoding: options };
  }
  const fs2 = options.fs || _fs;
  const shouldThrow = "throws" in options ? options.throws : true;
  try {
    let content2 = fs2.readFileSync(file2, options);
    content2 = stripBom(content2);
    return JSON.parse(content2, options.reviver);
  } catch (err) {
    if (shouldThrow) {
      err.message = `${file2}: ${err.message}`;
      throw err;
    } else {
      return null;
    }
  }
}
async function _writeFile(file2, obj, options = {}) {
  const fs2 = options.fs || _fs;
  const str = stringify$2(obj, options);
  await universalify.fromCallback(fs2.writeFile)(file2, str, options);
}
const writeFile = universalify.fromPromise(_writeFile);
function writeFileSync(file2, obj, options = {}) {
  const fs2 = options.fs || _fs;
  const str = stringify$2(obj, options);
  return fs2.writeFileSync(file2, str, options);
}
var jsonfile$1 = {
  readFile,
  readFileSync,
  writeFile,
  writeFileSync
};
const jsonFile$1 = jsonfile$1;
var jsonfile = {
  // jsonfile exports
  readJson: jsonFile$1.readFile,
  readJsonSync: jsonFile$1.readFileSync,
  writeJson: jsonFile$1.writeFile,
  writeJsonSync: jsonFile$1.writeFileSync
};
const u$2 = universalify$1.fromPromise;
const fs$4 = fs$j;
const path$3 = path$e;
const mkdir = mkdirs$2;
const pathExists$1 = pathExists_1.pathExists;
async function outputFile$1(file2, data, encoding = "utf-8") {
  const dir = path$3.dirname(file2);
  if (!await pathExists$1(dir)) {
    await mkdir.mkdirs(dir);
  }
  return fs$4.writeFile(file2, data, encoding);
}
function outputFileSync$1(file2, ...args) {
  const dir = path$3.dirname(file2);
  if (!fs$4.existsSync(dir)) {
    mkdir.mkdirsSync(dir);
  }
  fs$4.writeFileSync(file2, ...args);
}
var outputFile_1 = {
  outputFile: u$2(outputFile$1),
  outputFileSync: outputFileSync$1
};
const { stringify: stringify$1 } = utils$1;
const { outputFile } = outputFile_1;
async function outputJson(file2, data, options = {}) {
  const str = stringify$1(data, options);
  await outputFile(file2, str, options);
}
var outputJson_1 = outputJson;
const { stringify } = utils$1;
const { outputFileSync } = outputFile_1;
function outputJsonSync(file2, data, options) {
  const str = stringify(data, options);
  outputFileSync(file2, str, options);
}
var outputJsonSync_1 = outputJsonSync;
const u$1 = universalify$1.fromPromise;
const jsonFile = jsonfile;
jsonFile.outputJson = u$1(outputJson_1);
jsonFile.outputJsonSync = outputJsonSync_1;
jsonFile.outputJSON = jsonFile.outputJson;
jsonFile.outputJSONSync = jsonFile.outputJsonSync;
jsonFile.writeJSON = jsonFile.writeJson;
jsonFile.writeJSONSync = jsonFile.writeJsonSync;
jsonFile.readJSON = jsonFile.readJson;
jsonFile.readJSONSync = jsonFile.readJsonSync;
var json = jsonFile;
const fs$3 = fs$j;
const path$2 = path$e;
const { copy } = copy$1;
const { remove } = remove_1;
const { mkdirp } = mkdirs$2;
const { pathExists } = pathExists_1;
const stat$1 = stat$4;
async function move$1(src, dest, opts = {}) {
  const overwrite = opts.overwrite || opts.clobber || false;
  const { srcStat, isChangingCase = false } = await stat$1.checkPaths(src, dest, "move", opts);
  await stat$1.checkParentPaths(src, srcStat, dest, "move");
  const destParent = path$2.dirname(dest);
  const parsedParentPath = path$2.parse(destParent);
  if (parsedParentPath.root !== destParent) {
    await mkdirp(destParent);
  }
  return doRename$1(src, dest, overwrite, isChangingCase);
}
async function doRename$1(src, dest, overwrite, isChangingCase) {
  if (!isChangingCase) {
    if (overwrite) {
      await remove(dest);
    } else if (await pathExists(dest)) {
      throw new Error("dest already exists.");
    }
  }
  try {
    await fs$3.rename(src, dest);
  } catch (err) {
    if (err.code !== "EXDEV") {
      throw err;
    }
    await moveAcrossDevice$1(src, dest, overwrite);
  }
}
async function moveAcrossDevice$1(src, dest, overwrite) {
  const opts = {
    overwrite,
    errorOnExist: true,
    preserveTimestamps: true
  };
  await copy(src, dest, opts);
  return remove(src);
}
var move_1 = move$1;
const fs$2 = gracefulFs;
const path$1 = path$e;
const copySync = copy$1.copySync;
const removeSync = remove_1.removeSync;
const mkdirpSync = mkdirs$2.mkdirpSync;
const stat = stat$4;
function moveSync(src, dest, opts) {
  opts = opts || {};
  const overwrite = opts.overwrite || opts.clobber || false;
  const { srcStat, isChangingCase = false } = stat.checkPathsSync(src, dest, "move", opts);
  stat.checkParentPathsSync(src, srcStat, dest, "move");
  if (!isParentRoot(dest)) mkdirpSync(path$1.dirname(dest));
  return doRename(src, dest, overwrite, isChangingCase);
}
function isParentRoot(dest) {
  const parent = path$1.dirname(dest);
  const parsedPath = path$1.parse(parent);
  return parsedPath.root === parent;
}
function doRename(src, dest, overwrite, isChangingCase) {
  if (isChangingCase) return rename(src, dest, overwrite);
  if (overwrite) {
    removeSync(dest);
    return rename(src, dest, overwrite);
  }
  if (fs$2.existsSync(dest)) throw new Error("dest already exists.");
  return rename(src, dest, overwrite);
}
function rename(src, dest, overwrite) {
  try {
    fs$2.renameSync(src, dest);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    return moveAcrossDevice(src, dest, overwrite);
  }
}
function moveAcrossDevice(src, dest, overwrite) {
  const opts = {
    overwrite,
    errorOnExist: true,
    preserveTimestamps: true
  };
  copySync(src, dest, opts);
  return removeSync(src);
}
var moveSync_1 = moveSync;
const u = universalify$1.fromPromise;
var move = {
  move: u(move_1),
  moveSync: moveSync_1
};
var lib = {
  // Export promiseified graceful-fs:
  ...fs$j,
  // Export extra methods:
  ...copy$1,
  ...empty,
  ...ensure,
  ...json,
  ...mkdirs$2,
  ...move,
  ...outputFile_1,
  ...pathExists_1,
  ...remove_1
};
const fs$1 = /* @__PURE__ */ getDefaultExportFromCjs(lib);
const defaultTmsList = [
  {
    always: true,
    mapID: "osm",
    title: "OpenStreetMap"
  },
  {
    always: true,
    mapID: "gsi",
    title: "地理院地図"
  },
  {
    always: true,
    mapID: "gsi_ortho",
    title: "地理院航空写真"
  },
  {
    mapID: "gsi_ort_USA10",
    attr: "The Geospatial Information Authority of Japan",
    url: "https://cyberjapandata.gsi.go.jp/xyz/ort_USA10/{z}/{x}/{y}.png",
    maxZoom: 17,
    title: "地理院航空写真1945-50"
  },
  {
    mapID: "gsi_ort_old10",
    attr: "The Geospatial Information Authority of Japan",
    url: "https://cyberjapandata.gsi.go.jp/xyz/ort_old10/{z}/{x}/{y}.png",
    maxZoom: 17,
    title: "地理院航空写真1961-64"
  },
  {
    mapID: "gsi_gazo1",
    attr: "The Geospatial Information Authority of Japan",
    url: "https://cyberjapandata.gsi.go.jp/xyz/gazo1/{z}/{x}/{y}.jpg",
    maxZoom: 17,
    title: "地理院航空写真1974-78"
  },
  {
    mapID: "gsi_gazo2",
    attr: "The Geospatial Information Authority of Japan",
    url: "https://cyberjapandata.gsi.go.jp/xyz/gazo2/{z}/{x}/{y}.jpg",
    maxZoom: 17,
    title: "地理院航空写真1979-83"
  },
  {
    mapID: "gsi_gazo3",
    attr: "The Geospatial Information Authority of Japan",
    url: "https://cyberjapandata.gsi.go.jp/xyz/gazo3/{z}/{x}/{y}.jpg",
    maxZoom: 17,
    title: "地理院航空写真1984-86"
  },
  {
    mapID: "gsi_gazo4",
    attr: "The Geospatial Information Authority of Japan",
    url: "https://cyberjapandata.gsi.go.jp/xyz/gazo4/{z}/{x}/{y}.jpg",
    maxZoom: 17,
    title: "地理院航空写真1988-90"
  },
  {
    mapID: "affrc_rapid16",
    attr: "（独）農業環境技術研究所",
    url: "https://aginfo.cgk.affrc.go.jp/ws/tmc/1.0.0/Kanto_Rapid-900913-L/{z}/{x}/{y}.png",
    maxZoom: 17,
    title: "1/2万　迅速測図原図"
  },
  {
    mapID: "affrc_tokyo5k",
    attr: "（独）農業環境技術研究所",
    url: "https://aginfo.cgk.affrc.go.jp/ws/tmc/1.0.0/Tokyo5000-900913-L/{z}/{x}/{y}.png",
    maxZoom: 18,
    title: "1/5千　東京測量図原図"
  },
  {
    mapID: "tokyo502man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokyo50/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 首都圏 1896-1909年"
  },
  {
    mapID: "tokyo5000",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokyo50/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 首都圏 1917-1924年"
  },
  {
    mapID: "tokyo5001",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokyo50/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 首都圏 1927-1939年"
  },
  {
    mapID: "tokyo5002",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokyo50/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 首都圏 1944-1954年"
  },
  {
    mapID: "tokyo5003",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokyo50/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 首都圏 1965-1968年"
  },
  {
    mapID: "tokyo5004",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokyo50/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 首都圏 1975-1978年"
  },
  {
    mapID: "tokyo5005",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokyo50/05/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 首都圏 1983-1987年"
  },
  {
    mapID: "tokyo5006",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokyo50/06/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 首都圏 1992-1995年"
  },
  {
    mapID: "tokyo5007",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokyo50/07/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 首都圏 1998-2005年"
  },
  {
    mapID: "chukyo2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1888-1898年"
  },
  {
    mapID: "chukyo00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1920年"
  },
  {
    mapID: "chukyo01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1932年"
  },
  {
    mapID: "chukyo02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1937-1938年"
  },
  {
    mapID: "chukyo03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1947年"
  },
  {
    mapID: "chukyo04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1959-1960年"
  },
  {
    mapID: "chukyo05",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/05/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1968-1973年"
  },
  {
    mapID: "chukyo06",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/06/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1976-1980年"
  },
  {
    mapID: "chukyo07",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/07/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1984-1989年"
  },
  {
    mapID: "chukyo08",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/chukyo/08/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 中京圏 1992-1996年"
  },
  {
    mapID: "keihansin2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1892-1910年"
  },
  {
    mapID: "keihansin00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1922-1923年"
  },
  {
    mapID: "keihansin01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1927-1935年"
  },
  {
    mapID: "keihansin02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1947-1950年"
  },
  {
    mapID: "keihansin03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1954-1956年"
  },
  {
    mapID: "keihansin03x",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/03x/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1961-1964年"
  },
  {
    mapID: "keihansin04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1967-1970年"
  },
  {
    mapID: "keihansin05",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/05/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1975-1979年"
  },
  {
    mapID: "keihansin06",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/06/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1983-1988年"
  },
  {
    mapID: "keihansin07",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/keihansin/07/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 京阪神圏 1993-1997年"
  },
  {
    mapID: "sapporo00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sapporo/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 札幌 1916年"
  },
  {
    mapID: "sapporo01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sapporo/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 札幌 1935年"
  },
  {
    mapID: "sapporo02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sapporo/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 札幌 1950-1952年"
  },
  {
    mapID: "sapporo03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sapporo/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 札幌 1975-1976年"
  },
  {
    mapID: "sapporo04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sapporo/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 札幌 1995-1998年"
  },
  {
    mapID: "sendai00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sendai/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 仙台 1928-1933年"
  },
  {
    mapID: "sendai01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sendai/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 仙台 1946年"
  },
  {
    mapID: "sendai02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sendai/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 仙台 1963-1967年"
  },
  {
    mapID: "sendai03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sendai/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 仙台 1977-1978年"
  },
  {
    mapID: "sendai04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sendai/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 仙台 1995-2000年"
  },
  {
    mapID: "hiroshima2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hiroshima/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 広島 1894-1899年"
  },
  {
    mapID: "hiroshima00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hiroshima/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 広島 1925-1932年"
  },
  {
    mapID: "hiroshima01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hiroshima/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 広島 1950-1954年"
  },
  {
    mapID: "hiroshima02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hiroshima/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 広島 1967-1969年"
  },
  {
    mapID: "hiroshima03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hiroshima/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 広島 1984-1990年"
  },
  {
    mapID: "hiroshima04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hiroshima/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 広島 1992-2001年"
  },
  {
    mapID: "fukuoka00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukuoka/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福岡・北九州 1922-1926年"
  },
  {
    mapID: "fukuoka01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukuoka/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福岡・北九州 1936-1938年"
  },
  {
    mapID: "fukuoka02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukuoka/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福岡・北九州 1948-1956年"
  },
  {
    mapID: "fukuoka03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukuoka/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福岡・北九州 1967-1972年"
  },
  {
    mapID: "fukuoka04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukuoka/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福岡・北九州 1982-1986年"
  },
  {
    mapID: "fukuoka05",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukuoka/05/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福岡・北九州 1991-2000年"
  },
  {
    mapID: "tohoku_pacific_coast00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tohoku_pacific_coast/00/{z}/{x}/{-y}.png",
    maxZoom: 15,
    title: "今昔マップ 東北地方太平洋岸 1901-1913年"
  },
  {
    mapID: "tohoku_pacific_coast01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tohoku_pacific_coast/01/{z}/{x}/{-y}.png",
    maxZoom: 15,
    title: "今昔マップ 東北地方太平洋岸 1949-1953年"
  },
  {
    mapID: "tohoku_pacific_coast02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tohoku_pacific_coast/02/{z}/{x}/{-y}.png",
    maxZoom: 15,
    title: "今昔マップ 東北地方太平洋岸 1969-1982年"
  },
  {
    mapID: "tohoku_pacific_coast03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tohoku_pacific_coast/03/{z}/{x}/{-y}.png",
    maxZoom: 15,
    title: "今昔マップ 東北地方太平洋岸 1990-2008年"
  },
  {
    mapID: "kanto00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kanto/00/{z}/{x}/{-y}.png",
    maxZoom: 15,
    title: "今昔マップ 関東 1894-1915年"
  },
  {
    mapID: "kanto01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kanto/01/{z}/{x}/{-y}.png",
    maxZoom: 15,
    title: "今昔マップ 関東 1928-1945年"
  },
  {
    mapID: "kanto02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kanto/02/{z}/{x}/{-y}.png",
    maxZoom: 15,
    title: "今昔マップ 関東 1972-1982年"
  },
  {
    mapID: "kanto03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kanto/03/{z}/{x}/{-y}.png",
    maxZoom: 15,
    title: "今昔マップ 関東 1988-2008年"
  },
  {
    mapID: "okinawas00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/okinawas/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 沖縄本島南部 1919年"
  },
  {
    mapID: "okinawas01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/okinawas/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 沖縄本島南部 1973-1975年"
  },
  {
    mapID: "okinawas02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/okinawas/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 沖縄本島南部 1992-1994年"
  },
  {
    mapID: "okinawas03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/okinawas/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 沖縄本島南部 2005-2008年"
  },
  {
    mapID: "hamamatsu2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hamamatsu/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 浜松・豊橋 1889-1890年"
  },
  {
    mapID: "hamamatsu00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hamamatsu/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 浜松・豊橋 1916-1918年"
  },
  {
    mapID: "hamamatsu01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hamamatsu/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 浜松・豊橋 1938-1950年"
  },
  {
    mapID: "hamamatsu02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hamamatsu/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 浜松・豊橋 1956-1959年"
  },
  {
    mapID: "hamamatsu03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hamamatsu/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 浜松・豊橋 1975-1988年"
  },
  {
    mapID: "hamamatsu04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hamamatsu/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 浜松・豊橋 1988-1995年"
  },
  {
    mapID: "hamamatsu05",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hamamatsu/05/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 浜松・豊橋 1996-2010年"
  },
  {
    mapID: "kumamoto2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kumamoto/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 熊本 1900-1901年"
  },
  {
    mapID: "kumamoto00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kumamoto/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 熊本 1926年"
  },
  {
    mapID: "kumamoto01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kumamoto/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 熊本 1965-1971年"
  },
  {
    mapID: "kumamoto02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kumamoto/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 熊本 1983年"
  },
  {
    mapID: "kumamoto03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kumamoto/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 熊本 1998-2000年"
  },
  {
    mapID: "niigata00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/niigata/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 新潟 1911年"
  },
  {
    mapID: "niigata01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/niigata/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 新潟 1931年"
  },
  {
    mapID: "niigata02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/niigata/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 新潟 1967-1968年"
  },
  {
    mapID: "niigata03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/niigata/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 新潟 1983-1985年"
  },
  {
    mapID: "niigata04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/niigata/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 新潟 2000-2001年"
  },
  {
    mapID: "himeji2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/himeji/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 姫路 1903-1910年"
  },
  {
    mapID: "himeji00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/himeji/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 姫路 1923年"
  },
  {
    mapID: "himeji01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/himeji/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 姫路 1967年"
  },
  {
    mapID: "himeji02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/himeji/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 姫路 1981-1985年"
  },
  {
    mapID: "himeji03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/himeji/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 姫路 1997-2001年"
  },
  {
    mapID: "okayama2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/okayama/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 岡山・福山 1895-1898年"
  },
  {
    mapID: "okayama00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/okayama/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 岡山・福山 1925年"
  },
  {
    mapID: "okayama01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/okayama/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 岡山・福山 1965-1970年"
  },
  {
    mapID: "okayama02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/okayama/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 岡山・福山 1978-1988年"
  },
  {
    mapID: "okayama03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/okayama/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 岡山・福山 1990-2000年"
  },
  {
    mapID: "kagoshima5man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kagoshima/5man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鹿児島 1902年"
  },
  {
    mapID: "kagoshima2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kagoshima/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鹿児島 1902年"
  },
  {
    mapID: "kagoshima00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kagoshima/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鹿児島 1932年"
  },
  {
    mapID: "kagoshima01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kagoshima/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鹿児島 1966年"
  },
  {
    mapID: "kagoshima02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kagoshima/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鹿児島 1982-1983年"
  },
  {
    mapID: "kagoshima03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kagoshima/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鹿児島 1996-2001年"
  },
  {
    mapID: "matsuyama2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsuyama/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松山 1903年"
  },
  {
    mapID: "matsuyama00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsuyama/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松山 1928-1955年"
  },
  {
    mapID: "matsuyama01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsuyama/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松山 1968年"
  },
  {
    mapID: "matsuyama02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsuyama/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松山 1985年"
  },
  {
    mapID: "matsuyama03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsuyama/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松山 1998-1999年"
  },
  {
    mapID: "oita00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/oita/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 大分 1914年"
  },
  {
    mapID: "oita01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/oita/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 大分 1973年"
  },
  {
    mapID: "oita02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/oita/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 大分 1984-1986年"
  },
  {
    mapID: "oita03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/oita/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 大分 1997-2001年"
  },
  {
    mapID: "nagasaki2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagasaki/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長崎 1900-1901年"
  },
  {
    mapID: "nagasaki00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagasaki/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長崎 1924-1926年"
  },
  {
    mapID: "nagasaki01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagasaki/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長崎 1954年"
  },
  {
    mapID: "nagasaki02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagasaki/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長崎 1970-1970年"
  },
  {
    mapID: "nagasaki03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagasaki/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長崎 1982-1983年"
  },
  {
    mapID: "nagasaki03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagasaki/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長崎 1996-2000年"
  },
  {
    mapID: "kanazawa2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kanazawa/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 金沢・富山 1909-1910年"
  },
  {
    mapID: "kanazawa00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kanazawa/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 金沢・富山 1930年"
  },
  {
    mapID: "kanazawa01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kanazawa/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 金沢・富山 1968-1969年"
  },
  {
    mapID: "kanazawa02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kanazawa/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 金沢・富山 1981-1985年"
  },
  {
    mapID: "kanazawa03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kanazawa/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 金沢・富山 1994-2001年"
  },
  {
    mapID: "wakayama2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/wakayama/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 和歌山 1908-1912年"
  },
  {
    mapID: "wakayama00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/wakayama/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 和歌山 1934年"
  },
  {
    mapID: "wakayama01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/wakayama/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 和歌山 1947年"
  },
  {
    mapID: "wakayama02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/wakayama/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 和歌山 1966-1967年"
  },
  {
    mapID: "wakayama03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/wakayama/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 和歌山 1984-1985年"
  },
  {
    mapID: "wakayama04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/wakayama/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 和歌山 1998-2000年"
  },
  {
    mapID: "aomori00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aomori/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 青森 1912年"
  },
  {
    mapID: "aomori01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aomori/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 青森 1939-1955年"
  },
  {
    mapID: "aomori02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aomori/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 青森 1970年"
  },
  {
    mapID: "aomori03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aomori/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 青森 1984-1989年"
  },
  {
    mapID: "aomori04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aomori/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 青森 2003-2011年"
  },
  {
    mapID: "takamatsu2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/takamatsu/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高松 1896-1910年"
  },
  {
    mapID: "takamatsu00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/takamatsu/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高松 1928年"
  },
  {
    mapID: "takamatsu01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/takamatsu/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高松 1969年"
  },
  {
    mapID: "takamatsu02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/takamatsu/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高松 1983-1984年"
  },
  {
    mapID: "takamatsu03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/takamatsu/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高松 1990-2000年"
  },
  {
    mapID: "nagano00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagano/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長野 1912年"
  },
  {
    mapID: "nagano01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagano/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長野 1937年"
  },
  {
    mapID: "nagano02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagano/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長野 1960年"
  },
  {
    mapID: "nagano03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagano/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長野 1972-1973年"
  },
  {
    mapID: "nagano04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagano/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長野 1985年"
  },
  {
    mapID: "nagano05",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/nagano/05/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 長野 2001年"
  },
  {
    mapID: "fukushima00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukushima/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福島 1908年"
  },
  {
    mapID: "fukushima01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukushima/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福島 1931年"
  },
  {
    mapID: "fukushima02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukushima/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福島 1972-1973年"
  },
  {
    mapID: "fukushima03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukushima/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福島 1983年"
  },
  {
    mapID: "fukushima04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukushima/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福島 1996-2000年"
  },
  {
    mapID: "fukui2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukui/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福井 1909年"
  },
  {
    mapID: "fukui00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukui/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福井 1930年"
  },
  {
    mapID: "fukui01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukui/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福井 1969-1973年"
  },
  {
    mapID: "fukui02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukui/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福井 1988-1990年"
  },
  {
    mapID: "fukui03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/fukui/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 福井 1996-2000年"
  },
  {
    mapID: "akita00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/akita/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 秋田 1912年"
  },
  {
    mapID: "akita01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/akita/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 秋田 1971-1972年"
  },
  {
    mapID: "akita02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/akita/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 秋田 1985-1990年"
  },
  {
    mapID: "akita03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/akita/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 秋田 2006-2007年"
  },
  {
    mapID: "morioka00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/morioka/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 盛岡 1811-1912年"
  },
  {
    mapID: "morioka01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/morioka/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 盛岡 1939年"
  },
  {
    mapID: "morioka02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/morioka/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 盛岡 1968-1969年"
  },
  {
    mapID: "morioka03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/morioka/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 盛岡 1983-1988年"
  },
  {
    mapID: "morioka04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/morioka/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 盛岡 1999-2002年"
  },
  {
    mapID: "tottori2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tottori/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鳥取 1897年"
  },
  {
    mapID: "tottori00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tottori/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鳥取 1932年"
  },
  {
    mapID: "tottori01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tottori/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鳥取 1973年"
  },
  {
    mapID: "tottori02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tottori/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鳥取 1988年"
  },
  {
    mapID: "tottori03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tottori/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 鳥取 1999-2001年"
  },
  {
    mapID: "tokushima2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokushima/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 徳島 1896-1909年"
  },
  {
    mapID: "tokushima00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokushima/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 徳島 1917年"
  },
  {
    mapID: "tokushima01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokushima/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 徳島 1928-1934年"
  },
  {
    mapID: "tokushima02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokushima/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 徳島 1969-1970年"
  },
  {
    mapID: "tokushima03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokushima/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 徳島 1981-1987年"
  },
  {
    mapID: "tokushima04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tokushima/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 徳島 1997-2000年"
  },
  {
    mapID: "kochi2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kochi/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高知 1906-1907年"
  },
  {
    mapID: "kochi00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kochi/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高知 1933年"
  },
  {
    mapID: "kochi01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kochi/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高知 1965年"
  },
  {
    mapID: "kochi02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kochi/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高知 1982年"
  },
  {
    mapID: "kochi03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kochi/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 高知 1998-2003年"
  },
  {
    mapID: "miyazaki00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyazaki/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 宮崎 1902年"
  },
  {
    mapID: "miyazaki01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyazaki/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 宮崎 1935年"
  },
  {
    mapID: "miyazaki02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyazaki/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 宮崎 1962年"
  },
  {
    mapID: "miyazaki03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyazaki/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 宮崎 1979年"
  },
  {
    mapID: "miyazaki04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyazaki/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 宮崎 1999-2001年"
  },
  {
    mapID: "yamagata2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamagata/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山形 1901-1903年"
  },
  {
    mapID: "yamagata00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamagata/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山形 1931年"
  },
  {
    mapID: "yamagata01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamagata/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山形 1970年"
  },
  {
    mapID: "yamagata02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamagata/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山形 1980-1989年"
  },
  {
    mapID: "yamagata03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamagata/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山形 1999-2001年"
  },
  {
    mapID: "saga2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/saga/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐賀・久留米 1900-1911年"
  },
  {
    mapID: "saga00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/saga/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐賀・久留米 1914-1926年"
  },
  {
    mapID: "saga01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/saga/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐賀・久留米 1931-1940年"
  },
  {
    mapID: "saga02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/saga/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐賀・久留米 1958-1964年"
  },
  {
    mapID: "saga03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/saga/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐賀・久留米 1977-1982年"
  },
  {
    mapID: "saga04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/saga/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐賀・久留米 1998-2001年"
  },
  {
    mapID: "matsue00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsue/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松江・米子 1915年"
  },
  {
    mapID: "matsue01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsue/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松江・米子 1934年"
  },
  {
    mapID: "matsue02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsue/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松江・米子 1975年"
  },
  {
    mapID: "matsue03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsue/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松江・米子 1989-1990年"
  },
  {
    mapID: "matsue04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsue/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松江・米子 1997-2003年"
  },
  {
    mapID: "tsu2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tsu/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 津 1892-1898年"
  },
  {
    mapID: "tsu00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tsu/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 津 1920年"
  },
  {
    mapID: "tsu01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tsu/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 津 1937年"
  },
  {
    mapID: "tsu02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tsu/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 津 1959年"
  },
  {
    mapID: "tsu03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tsu/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 津 1980-1982年"
  },
  {
    mapID: "tsu04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tsu/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 津 1991-1999年"
  },
  {
    mapID: "yamaguchi2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamaguchi/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山口 1897-1909年"
  },
  {
    mapID: "yamaguchi00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamaguchi/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山口 1922-1927年"
  },
  {
    mapID: "yamaguchi01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamaguchi/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山口 1936-1951年"
  },
  {
    mapID: "yamaguchi02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamaguchi/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山口 1969年"
  },
  {
    mapID: "yamaguchi03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamaguchi/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山口 1983-1989年"
  },
  {
    mapID: "yamaguchi04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/yamaguchi/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 山口 2000-2001年"
  },
  {
    mapID: "asahikawa00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/asahikawa/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 旭川 1916-1917年"
  },
  {
    mapID: "asahikawa01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/asahikawa/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 旭川 1950-1952年"
  },
  {
    mapID: "asahikawa02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/asahikawa/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 旭川 1972-1974年"
  },
  {
    mapID: "asahikawa03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/asahikawa/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 旭川 1986年"
  },
  {
    mapID: "asahikawa04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/asahikawa/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 旭川 1999-2001年"
  },
  {
    mapID: "hakodate00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hakodate/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 函館 19159年"
  },
  {
    mapID: "hakodate01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hakodate/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 函館 1951-1955年"
  },
  {
    mapID: "hakodate02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hakodate/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 函館 1968年"
  },
  {
    mapID: "hakodate03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hakodate/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 函館 1986-1989年"
  },
  {
    mapID: "hakodate04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hakodate/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 函館 1996-2001年"
  },
  {
    mapID: "matsumoto00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsumoto/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松本 1910年"
  },
  {
    mapID: "matsumoto01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsumoto/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松本 1931年"
  },
  {
    mapID: "matsumoto02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsumoto/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松本 1974-1975年"
  },
  {
    mapID: "matsumoto03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsumoto/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松本 1987-1992年"
  },
  {
    mapID: "matsumoto04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/matsumoto/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 松本 1996-2001年"
  },
  {
    mapID: "sasebo2man",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sasebo/2man/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐世保 1900-1901年"
  },
  {
    mapID: "sasebo00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sasebo/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐世保 1924年"
  },
  {
    mapID: "sasebo01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sasebo/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐世保 1971年"
  },
  {
    mapID: "sasebo02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sasebo/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐世保 1985-1987年"
  },
  {
    mapID: "sasebo03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/sasebo/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 佐世保 1997-1998年"
  },
  {
    mapID: "hirosaki00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hirosaki/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 弘前 1912年"
  },
  {
    mapID: "hirosaki01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hirosaki/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 弘前 1939年"
  },
  {
    mapID: "hirosaki02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hirosaki/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 弘前 1970-1971年"
  },
  {
    mapID: "hirosaki03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hirosaki/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 弘前 1980-1986年"
  },
  {
    mapID: "hirosaki04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/hirosaki/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 弘前 1994-1997年"
  },
  {
    mapID: "aizu00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aizu/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 会津 1908-1910年"
  },
  {
    mapID: "aizu01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aizu/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 会津 1931年"
  },
  {
    mapID: "aizu02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aizu/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 会津 1972-1975年"
  },
  {
    mapID: "aizu03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aizu/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 会津 1988-1991年"
  },
  {
    mapID: "aizu04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/aizu/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 会津 1997-2000年"
  },
  {
    mapID: "kushiro00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kushiro/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 釧路 1897年"
  },
  {
    mapID: "kushiro01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kushiro/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 釧路 1922年"
  },
  {
    mapID: "kushiro02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kushiro/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 釧路 1958年"
  },
  {
    mapID: "kushiro03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kushiro/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 釧路 1981年"
  },
  {
    mapID: "kushiro04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/kushiro/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 釧路 2001年"
  },
  {
    mapID: "tomakomai00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tomakomai/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 苫小牧 1896年"
  },
  {
    mapID: "tomakomai01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tomakomai/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 苫小牧 1935年"
  },
  {
    mapID: "tomakomai02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tomakomai/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 苫小牧 1954-1955年"
  },
  {
    mapID: "tomakomai03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tomakomai/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 苫小牧 1983-1984年"
  },
  {
    mapID: "tomakomai04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/tomakomai/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 苫小牧 1993-999年"
  },
  {
    mapID: "obihiro00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/obihiro/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 帯広 1896年"
  },
  {
    mapID: "obihiro01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/obihiro/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 帯広 1930年"
  },
  {
    mapID: "obihiro02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/obihiro/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 帯広 1956-1957年"
  },
  {
    mapID: "obihiro03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/obihiro/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 帯広 1985年"
  },
  {
    mapID: "obihiro04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/obihiro/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 帯広 1998-2000年"
  },
  {
    mapID: "miyakonojyou00",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/00/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 都城 1902年"
  },
  {
    mapID: "miyakonojyou01",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/01/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 都城 1932年"
  },
  {
    mapID: "miyakonojyou02",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/02/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 都城 1966年"
  },
  {
    mapID: "miyakonojyou03",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/03/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 都城 1979-1980年"
  },
  {
    mapID: "miyakonojyou04",
    attr: "今昔マップ on the web",
    url: "https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/04/{z}/{x}/{-y}.png",
    maxZoom: 16,
    title: "今昔マップ 都城 1998-2001年"
  }
];
const defaultSettings = {
  lang: "ja",
  saveFolder: path$e.join(app$1.getPath("documents"), app$1.getName()),
  tmsList: defaultTmsList
};
class SettingsService extends EventEmitter$1 {
  constructor() {
    super();
    __publicField(this, "store");
    this.store = new ElectronStore({ defaults: defaultSettings });
    this.migrateLegacySettings();
    this.ensureDataDirectories();
  }
  // ... (migrateLegacySettings remains same)
  migrateLegacySettings() {
    if (this.store.has("migratedFromLegacy")) return;
    try {
      const appData = app$1.getPath("appData");
      const legacyStoragePath = path$e.join(appData, "MaplatEditor", "storage");
      if (fs$1.existsSync(legacyStoragePath)) {
        const saveFolderFile = path$e.join(legacyStoragePath, "saveFolder.json");
        if (fs$1.existsSync(saveFolderFile)) {
          try {
            const saveFolderVal = fs$1.readJsonSync(saveFolderFile);
            if (saveFolderVal) this.store.set("saveFolder", saveFolderVal);
          } catch (e) {
          }
        }
        const langFile = path$e.join(legacyStoragePath, "lang.json");
        if (fs$1.existsSync(langFile)) {
          try {
            const langVal = fs$1.readJsonSync(langFile);
            if (langVal) this.store.set("lang", langVal);
          } catch (e) {
          }
        }
        this.store.set("migratedFromLegacy", true);
        console.log("Migrated legacy settings.");
      }
    } catch (e) {
      console.error("Failed to migrate legacy settings", e);
    }
  }
  ensureDataDirectories() {
    const saveFolder = this.store.get("saveFolder");
    try {
      fs$1.ensureDirSync(saveFolder);
    } catch (e) {
      console.error(`Could not create/access saveFolder: ${saveFolder}`, e);
    }
  }
  get(key) {
    return this.store.get(key);
  }
  getAll() {
    return this.store.store;
  }
  set(key, value) {
    const oldValue = this.store.get(key);
    this.store.set(key, value);
    if (key === "saveFolder") {
      this.ensureDataDirectories();
    }
    if (key === "lang" && oldValue !== value) {
      this.emit("changeLang", value);
    }
  }
  async showSaveFolderDialog(mainWindow) {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: this.store.get("saveFolder"),
      properties: ["openDirectory"]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const newPath = result.filePaths[0];
      this.set("saveFolder", newPath);
      return newPath;
    }
    return null;
  }
}
const SettingsService$1 = new SettingsService();
var model$4 = {};
var utils = {};
const uniq$2 = (array, iteratee) => {
  if (iteratee) return [...new Map(array.map((x2) => [iteratee(x2), x2])).values()];
  else return [...new Set(array)];
};
const isObject = (arg) => typeof arg === "object" && arg !== null;
const isDate$3 = (d) => isObject(d) && Object.prototype.toString.call(d) === "[object Date]";
const isRegExp$1 = (re2) => isObject(re2) && Object.prototype.toString.call(re2) === "[object RegExp]";
const pick$1 = (object, keys2) => {
  return keys2.reduce((obj, key) => {
    if (object && Object.prototype.hasOwnProperty.call(object, key)) {
      obj[key] = object[key];
    }
    return obj;
  }, {});
};
const filterIndexNames$1 = (indexNames) => ([k, v]) => !!(typeof v === "string" || typeof v === "number" || typeof v === "boolean" || isDate$3(v) || v === null) && indexNames.includes(k);
utils.uniq = uniq$2;
utils.isDate = isDate$3;
utils.isRegExp = isRegExp$1;
utils.pick = pick$1;
utils.filterIndexNames = filterIndexNames$1;
const { uniq: uniq$1, isDate: isDate$2, isRegExp } = utils;
const checkKey = (k, v) => {
  if (typeof k === "number") k = k.toString();
  if (k[0] === "$" && !(k === "$$date" && typeof v === "number") && !(k === "$$deleted" && v === true) && !(k === "$$indexCreated") && !(k === "$$indexRemoved")) throw new Error("Field names cannot begin with the $ character");
  if (k.indexOf(".") !== -1) throw new Error("Field names cannot contain a .");
};
const checkObject = (obj) => {
  if (Array.isArray(obj)) {
    obj.forEach((o) => {
      checkObject(o);
    });
  }
  if (typeof obj === "object" && obj !== null) {
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        checkKey(k, obj[k]);
        checkObject(obj[k]);
      }
    }
  }
};
const serialize = (obj) => {
  return JSON.stringify(obj, function(k, v) {
    checkKey(k, v);
    if (v === void 0) return void 0;
    if (v === null) return null;
    if (typeof this[k].getTime === "function") return { $$date: this[k].getTime() };
    return v;
  });
};
const deserialize = (rawData) => JSON.parse(rawData, function(k, v) {
  if (k === "$$date") return new Date(v);
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (v && v.$$date) return v.$$date;
  return v;
});
function deepCopy(obj, strictKeys) {
  if (typeof obj === "boolean" || typeof obj === "number" || typeof obj === "string" || obj === null || isDate$2(obj)) return obj;
  if (Array.isArray(obj)) return obj.map((o) => deepCopy(o, strictKeys));
  if (typeof obj === "object") {
    const res = {};
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && (!strictKeys || k[0] !== "$" && k.indexOf(".") === -1)) {
        res[k] = deepCopy(obj[k], strictKeys);
      }
    }
    return res;
  }
  return void 0;
}
const isPrimitiveType = (obj) => typeof obj === "boolean" || typeof obj === "number" || typeof obj === "string" || obj === null || isDate$2(obj) || Array.isArray(obj);
const compareNSB = (a, b) => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};
const compareArrays = (a, b) => {
  const minLength = Math.min(a.length, b.length);
  for (let i = 0; i < minLength; i += 1) {
    const comp = compareThings(a[i], b[i]);
    if (comp !== 0) return comp;
  }
  return compareNSB(a.length, b.length);
};
const compareThings = (a, b, _compareStrings) => {
  const compareStrings = _compareStrings || compareNSB;
  if (a === void 0) return b === void 0 ? 0 : -1;
  if (b === void 0) return 1;
  if (a === null) return b === null ? 0 : -1;
  if (b === null) return 1;
  if (typeof a === "number") return typeof b === "number" ? compareNSB(a, b) : -1;
  if (typeof b === "number") return typeof a === "number" ? compareNSB(a, b) : 1;
  if (typeof a === "string") return typeof b === "string" ? compareStrings(a, b) : -1;
  if (typeof b === "string") return typeof a === "string" ? compareStrings(a, b) : 1;
  if (typeof a === "boolean") return typeof b === "boolean" ? compareNSB(a, b) : -1;
  if (typeof b === "boolean") return typeof a === "boolean" ? compareNSB(a, b) : 1;
  if (isDate$2(a)) return isDate$2(b) ? compareNSB(a.getTime(), b.getTime()) : -1;
  if (isDate$2(b)) return isDate$2(a) ? compareNSB(a.getTime(), b.getTime()) : 1;
  if (Array.isArray(a)) return Array.isArray(b) ? compareArrays(a, b) : -1;
  if (Array.isArray(b)) return Array.isArray(a) ? compareArrays(a, b) : 1;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  for (let i = 0; i < Math.min(aKeys.length, bKeys.length); i += 1) {
    const comp = compareThings(a[aKeys[i]], b[bKeys[i]]);
    if (comp !== 0) return comp;
  }
  return compareNSB(aKeys.length, bKeys.length);
};
const createModifierFunction = (lastStepModifierFunction, unset = false) => {
  const func = (obj, field, value) => {
    const fieldParts = typeof field === "string" ? field.split(".") : field;
    if (fieldParts.length === 1) lastStepModifierFunction(obj, field, value);
    else {
      if (obj[fieldParts[0]] === void 0) {
        if (unset) return;
        obj[fieldParts[0]] = {};
      }
      func(obj[fieldParts[0]], fieldParts.slice(1), value);
    }
  };
  return func;
};
const $addToSetPartial = (obj, field, value) => {
  if (!Object.prototype.hasOwnProperty.call(obj, field)) {
    obj[field] = [];
  }
  if (!Array.isArray(obj[field])) throw new Error("Can't $addToSet an element on non-array values");
  if (value !== null && typeof value === "object" && value.$each) {
    if (Object.keys(value).length > 1) throw new Error("Can't use another field in conjunction with $each");
    if (!Array.isArray(value.$each)) throw new Error("$each requires an array value");
    value.$each.forEach((v) => {
      $addToSetPartial(obj, field, v);
    });
  } else {
    let addToSet = true;
    obj[field].forEach((v) => {
      if (compareThings(v, value) === 0) addToSet = false;
    });
    if (addToSet) obj[field].push(value);
  }
};
const modifierFunctions = {
  /**
   * Set a field to a new value
   */
  $set: createModifierFunction((obj, field, value) => {
    obj[field] = value;
  }),
  /**
   * Unset a field
   */
  $unset: createModifierFunction((obj, field, value) => {
    delete obj[field];
  }, true),
  /**
   * Updates the value of the field, only if specified field is smaller than the current value of the field
   */
  $min: createModifierFunction((obj, field, value) => {
    if (typeof obj[field] === "undefined") obj[field] = value;
    else if (value < obj[field]) obj[field] = value;
  }),
  /**
   * Updates the value of the field, only if specified field is greater than the current value of the field
   */
  $max: createModifierFunction((obj, field, value) => {
    if (typeof obj[field] === "undefined") obj[field] = value;
    else if (value > obj[field]) obj[field] = value;
  }),
  /**
   * Increment a numeric field's value
   */
  $inc: createModifierFunction((obj, field, value) => {
    if (typeof value !== "number") throw new Error(`${value} must be a number`);
    if (typeof obj[field] !== "number") {
      if (!Object.prototype.hasOwnProperty.call(obj, field)) obj[field] = value;
      else throw new Error("Don't use the $inc modifier on non-number fields");
    } else obj[field] += value;
  }),
  /**
   * Removes all instances of a value from an existing array
   */
  $pull: createModifierFunction((obj, field, value) => {
    if (!Array.isArray(obj[field])) throw new Error("Can't $pull an element from non-array values");
    const arr = obj[field];
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (match(arr[i], value)) arr.splice(i, 1);
    }
  }),
  /**
   * Remove the first or last element of an array
   */
  $pop: createModifierFunction((obj, field, value) => {
    if (!Array.isArray(obj[field])) throw new Error("Can't $pop an element from non-array values");
    if (typeof value !== "number") throw new Error(`${value} isn't an integer, can't use it with $pop`);
    if (value === 0) return;
    if (value > 0) obj[field] = obj[field].slice(0, obj[field].length - 1);
    else obj[field] = obj[field].slice(1);
  }),
  /**
   * Add an element to an array field only if it is not already in it
   * No modification if the element is already in the array
   * Note that it doesn't check whether the original array contains duplicates
   */
  $addToSet: createModifierFunction($addToSetPartial),
  /**
   * Push an element to the end of an array field
   * Optional modifier $each instead of value to push several values
   * Optional modifier $slice to slice the resulting array, see https://docs.mongodb.org/manual/reference/operator/update/slice/
   * Difference with MongoDB: if $slice is specified and not $each, we act as if value is an empty array
   */
  $push: createModifierFunction((obj, field, value) => {
    if (!Object.prototype.hasOwnProperty.call(obj, field)) obj[field] = [];
    if (!Array.isArray(obj[field])) throw new Error("Can't $push an element on non-array values");
    if (value !== null && typeof value === "object" && value.$slice && value.$each === void 0) value.$each = [];
    if (value !== null && typeof value === "object" && value.$each) {
      if (Object.keys(value).length >= 3 || Object.keys(value).length === 2 && value.$slice === void 0) throw new Error("Can only use $slice in cunjunction with $each when $push to array");
      if (!Array.isArray(value.$each)) throw new Error("$each requires an array value");
      value.$each.forEach((v) => {
        obj[field].push(v);
      });
      if (value.$slice === void 0 || typeof value.$slice !== "number") return;
      if (value.$slice === 0) obj[field] = [];
      else {
        let start;
        let end;
        const n = obj[field].length;
        if (value.$slice < 0) {
          start = Math.max(0, n + value.$slice);
          end = n;
        } else if (value.$slice > 0) {
          start = 0;
          end = Math.min(n, value.$slice);
        }
        obj[field] = obj[field].slice(start, end);
      }
    } else {
      obj[field].push(value);
    }
  })
};
const modify = (obj, updateQuery) => {
  const keys2 = Object.keys(updateQuery);
  const firstChars = keys2.map((item) => item[0]);
  const dollarFirstChars = firstChars.filter((c) => c === "$");
  let newDoc;
  let modifiers;
  if (keys2.indexOf("_id") !== -1 && updateQuery._id !== obj._id) throw new Error("You cannot change a document's _id");
  if (dollarFirstChars.length !== 0 && dollarFirstChars.length !== firstChars.length) throw new Error("You cannot mix modifiers and normal fields");
  if (dollarFirstChars.length === 0) {
    newDoc = deepCopy(updateQuery);
    newDoc._id = obj._id;
  } else {
    modifiers = uniq$1(keys2);
    newDoc = deepCopy(obj);
    modifiers.forEach((m) => {
      if (!modifierFunctions[m]) throw new Error(`Unknown modifier ${m}`);
      if (typeof updateQuery[m] !== "object") throw new Error(`Modifier ${m}'s argument must be an object`);
      const keys3 = Object.keys(updateQuery[m]);
      keys3.forEach((k) => {
        modifierFunctions[m](newDoc, k, updateQuery[m][k]);
      });
    });
  }
  checkObject(newDoc);
  if (obj._id !== newDoc._id) throw new Error("You can't change a document's _id");
  return newDoc;
};
const getDotValue = (obj, field) => {
  const fieldParts = typeof field === "string" ? field.split(".") : field;
  if (!obj) return void 0;
  if (fieldParts.length === 0) return obj;
  if (fieldParts.length === 1) return obj[fieldParts[0]];
  if (Array.isArray(obj[fieldParts[0]])) {
    const i = parseInt(fieldParts[1], 10);
    if (typeof i === "number" && !isNaN(i)) return getDotValue(obj[fieldParts[0]][i], fieldParts.slice(2));
    return obj[fieldParts[0]].map((el) => getDotValue(el, fieldParts.slice(1)));
  } else return getDotValue(obj[fieldParts[0]], fieldParts.slice(1));
};
const getDotValues = (obj, fields) => {
  if (!Array.isArray(fields)) throw new Error("fields must be an Array");
  if (fields.length > 1) {
    const key = {};
    for (const field of fields) {
      key[field] = getDotValue(obj, field);
    }
    return key;
  } else return getDotValue(obj, fields[0]);
};
const areThingsEqual = (a, b) => {
  if (a === null || typeof a === "string" || typeof a === "boolean" || typeof a === "number" || b === null || typeof b === "string" || typeof b === "boolean" || typeof b === "number") return a === b;
  if (isDate$2(a) || isDate$2(b)) return isDate$2(a) && isDate$2(b) && a.getTime() === b.getTime();
  if (!(Array.isArray(a) && Array.isArray(b)) && (Array.isArray(a) || Array.isArray(b)) || a === void 0 || b === void 0) return false;
  let aKeys;
  let bKeys;
  try {
    aKeys = Object.keys(a);
    bKeys = Object.keys(b);
  } catch (e) {
    return false;
  }
  if (aKeys.length !== bKeys.length) return false;
  for (const el of aKeys) {
    if (bKeys.indexOf(el) === -1) return false;
    if (!areThingsEqual(a[el], b[el])) return false;
  }
  return true;
};
const areComparable = (a, b) => {
  if (typeof a !== "string" && typeof a !== "number" && !isDate$2(a) && typeof b !== "string" && typeof b !== "number" && !isDate$2(b)) return false;
  if (typeof a !== typeof b) return false;
  return true;
};
const comparisonFunctions = {
  /** Lower than */
  $lt: (a, b) => areComparable(a, b) && a < b,
  /** Lower than or equals */
  $lte: (a, b) => areComparable(a, b) && a <= b,
  /** Greater than */
  $gt: (a, b) => areComparable(a, b) && a > b,
  /** Greater than or equals */
  $gte: (a, b) => areComparable(a, b) && a >= b,
  /** Does not equal */
  $ne: (a, b) => a === void 0 || !areThingsEqual(a, b),
  /** Is in Array */
  $in: (a, b) => {
    if (!Array.isArray(b)) throw new Error("$in operator called with a non-array");
    for (const el of b) {
      if (areThingsEqual(a, el)) return true;
    }
    return false;
  },
  /** Is not in Array */
  $nin: (a, b) => {
    if (!Array.isArray(b)) throw new Error("$nin operator called with a non-array");
    return !comparisonFunctions.$in(a, b);
  },
  /** Matches Regexp */
  $regex: (a, b) => {
    if (!isRegExp(b)) throw new Error("$regex operator called with non regular expression");
    if (typeof a !== "string") return false;
    else return b.test(a);
  },
  /** Returns true if field exists */
  $exists: (a, b) => {
    if (b || b === "") b = true;
    else b = false;
    if (a === void 0) return !b;
    else return b;
  },
  /** Specific to Arrays, returns true if a length equals b */
  $size: (a, b) => {
    if (!Array.isArray(a)) return false;
    if (b % 1 !== 0) throw new Error("$size operator called without an integer");
    return a.length === b;
  },
  /** Specific to Arrays, returns true if some elements of a match the query b */
  $elemMatch: (a, b) => {
    if (!Array.isArray(a)) return false;
    return a.some((el) => match(el, b));
  }
};
const arrayComparisonFunctions = { $size: true, $elemMatch: true };
const logicalOperators = {
  /**
   * Match any of the subqueries
   * @param {document} obj
   * @param {query[]} query
   * @return {boolean}
   */
  $or: (obj, query) => {
    if (!Array.isArray(query)) throw new Error("$or operator used without an array");
    for (let i = 0; i < query.length; i += 1) {
      if (match(obj, query[i])) return true;
    }
    return false;
  },
  /**
   * Match all of the subqueries
   * @param {document} obj
   * @param {query[]} query
   * @return {boolean}
   */
  $and: (obj, query) => {
    if (!Array.isArray(query)) throw new Error("$and operator used without an array");
    for (let i = 0; i < query.length; i += 1) {
      if (!match(obj, query[i])) return false;
    }
    return true;
  },
  /**
   * Inverted match of the query
   * @param {document} obj
   * @param {query} query
   * @return {boolean}
   */
  $not: (obj, query) => !match(obj, query),
  /**
   * @callback whereCallback
   * @param {document} obj
   * @return {boolean}
   */
  /**
   * Use a function to match
   * @param {document} obj
   * @param {whereCallback} fn
   * @return {boolean}
   */
  $where: (obj, fn) => {
    if (typeof fn !== "function") throw new Error("$where operator used without a function");
    const result = fn.call(obj);
    if (typeof result !== "boolean") throw new Error("$where function must return boolean");
    return result;
  }
};
const match = (obj, query) => {
  if (isPrimitiveType(obj) || isPrimitiveType(query)) return matchQueryPart({ needAKey: obj }, "needAKey", query);
  for (const queryKey in query) {
    if (Object.prototype.hasOwnProperty.call(query, queryKey)) {
      const queryValue = query[queryKey];
      if (queryKey[0] === "$") {
        if (!logicalOperators[queryKey]) throw new Error(`Unknown logical operator ${queryKey}`);
        if (!logicalOperators[queryKey](obj, queryValue)) return false;
      } else if (!matchQueryPart(obj, queryKey, queryValue)) return false;
    }
  }
  return true;
};
function matchQueryPart(obj, queryKey, queryValue, treatObjAsValue) {
  const objValue = getDotValue(obj, queryKey);
  if (Array.isArray(objValue) && !treatObjAsValue) {
    if (Array.isArray(queryValue)) return matchQueryPart(obj, queryKey, queryValue, true);
    if (queryValue !== null && typeof queryValue === "object" && !isRegExp(queryValue)) {
      for (const key in queryValue) {
        if (Object.prototype.hasOwnProperty.call(queryValue, key) && arrayComparisonFunctions[key]) {
          return matchQueryPart(obj, queryKey, queryValue, true);
        }
      }
    }
    for (const el of objValue) {
      if (matchQueryPart({ k: el }, "k", queryValue)) return true;
    }
    return false;
  }
  if (queryValue !== null && typeof queryValue === "object" && !isRegExp(queryValue) && !Array.isArray(queryValue)) {
    const keys2 = Object.keys(queryValue);
    const firstChars = keys2.map((item) => item[0]);
    const dollarFirstChars = firstChars.filter((c) => c === "$");
    if (dollarFirstChars.length !== 0 && dollarFirstChars.length !== firstChars.length) throw new Error("You cannot mix operators and normal fields");
    if (dollarFirstChars.length > 0) {
      for (const key of keys2) {
        if (!comparisonFunctions[key]) throw new Error(`Unknown comparison function ${key}`);
        if (!comparisonFunctions[key](objValue, queryValue[key])) return false;
      }
      return true;
    }
  }
  if (isRegExp(queryValue)) return comparisonFunctions.$regex(objValue, queryValue);
  return areThingsEqual(objValue, queryValue);
}
model$4.serialize = serialize;
model$4.deserialize = deserialize;
model$4.deepCopy = deepCopy;
model$4.checkObject = checkObject;
model$4.isPrimitiveType = isPrimitiveType;
model$4.modify = modify;
model$4.getDotValue = getDotValue;
model$4.getDotValues = getDotValues;
model$4.match = match;
model$4.areThingsEqual = areThingsEqual;
model$4.compareThings = compareThings;
const model$3 = model$4;
const { callbackify: callbackify$1 } = require$$1$1;
let Cursor$1 = class Cursor {
  /**
   * Create a new cursor for this collection.
   * @param {Datastore} db - The datastore this cursor is bound to
   * @param {query} query - The query this cursor will operate on
   * @param {Cursor~mapFn} [mapFn] - Handler to be executed after cursor has found the results and before the callback passed to find/findOne/update/remove
   */
  constructor(db, query, mapFn) {
    this.db = db;
    this.query = query || {};
    if (mapFn) this.mapFn = mapFn;
    this._limit = void 0;
    this._skip = void 0;
    this._sort = void 0;
    this._projection = void 0;
  }
  /**
   * Set a limit to the number of results for the given Cursor.
   * @param {Number} limit
   * @return {Cursor} the same instance of Cursor, (useful for chaining).
   */
  limit(limit2) {
    this._limit = limit2;
    return this;
  }
  /**
   * Skip a number of results for the given Cursor.
   * @param {Number} skip
   * @return {Cursor} the same instance of Cursor, (useful for chaining).
   */
  skip(skip) {
    this._skip = skip;
    return this;
  }
  /**
   * Sort results of the query for the given Cursor.
   * @param {Object.<string, number>} sortQuery - sortQuery is { field: order }, field can use the dot-notation, order is 1 for ascending and -1 for descending
   * @return {Cursor} the same instance of Cursor, (useful for chaining).
   */
  sort(sortQuery) {
    this._sort = sortQuery;
    return this;
  }
  /**
   * Add the use of a projection to the given Cursor.
   * @param {Object.<string, number>} projection - MongoDB-style projection. {} means take all fields. Then it's { key1: 1, key2: 1 } to take only key1 and key2
   * { key1: 0, key2: 0 } to omit only key1 and key2. Except _id, you can't mix takes and omits.
   * @return {Cursor} the same instance of Cursor, (useful for chaining).
   */
  projection(projection) {
    this._projection = projection;
    return this;
  }
  /**
   * Apply the projection.
   *
   * This is an internal function. You should use {@link Cursor#execAsync} or {@link Cursor#exec}.
   * @param {document[]} candidates
   * @return {document[]}
   * @private
   */
  _project(candidates) {
    const res = [];
    let action;
    if (this._projection === void 0 || Object.keys(this._projection).length === 0) {
      return candidates;
    }
    const keepId = this._projection._id !== 0;
    const { _id, ...rest } = this._projection;
    this._projection = rest;
    const keys2 = Object.keys(this._projection);
    keys2.forEach((k) => {
      if (action !== void 0 && this._projection[k] !== action) throw new Error("Can't both keep and omit fields except for _id");
      action = this._projection[k];
    });
    candidates.forEach((candidate) => {
      let toPush;
      if (action === 1) {
        toPush = { $set: {} };
        keys2.forEach((k) => {
          toPush.$set[k] = model$3.getDotValue(candidate, k);
          if (toPush.$set[k] === void 0) delete toPush.$set[k];
        });
        toPush = model$3.modify({}, toPush);
      } else {
        toPush = { $unset: {} };
        keys2.forEach((k) => {
          toPush.$unset[k] = true;
        });
        toPush = model$3.modify(candidate, toPush);
      }
      if (keepId) toPush._id = candidate._id;
      else delete toPush._id;
      res.push(toPush);
    });
    return res;
  }
  /**
   * Get all matching elements
   * Will return pointers to matched elements (shallow copies), returning full copies is the role of find or findOne
   * This is an internal function, use execAsync which uses the executor
   * @return {document[]|Promise<*>}
   * @private
   */
  async _execAsync() {
    let res = [];
    let added = 0;
    let skipped = 0;
    const candidates = await this.db._getCandidatesAsync(this.query);
    for (const candidate of candidates) {
      if (model$3.match(candidate, this.query)) {
        if (!this._sort) {
          if (this._skip && this._skip > skipped) skipped += 1;
          else {
            res.push(candidate);
            added += 1;
            if (this._limit && this._limit <= added) break;
          }
        } else res.push(candidate);
      }
    }
    if (this._sort) {
      const criteria = Object.entries(this._sort).map(([key, direction]) => ({ key, direction }));
      res.sort((a, b) => {
        for (const criterion of criteria) {
          const compare2 = criterion.direction * model$3.compareThings(model$3.getDotValue(a, criterion.key), model$3.getDotValue(b, criterion.key), this.db.compareStrings);
          if (compare2 !== 0) return compare2;
        }
        return 0;
      });
      const limit2 = this._limit || res.length;
      const skip = this._skip || 0;
      res = res.slice(skip, skip + limit2);
    }
    res = this._project(res);
    if (this.mapFn) return this.mapFn(res);
    return res;
  }
  /**
   * @callback Cursor~execCallback
   * @param {Error} err
   * @param {document[]|*} res If a mapFn was given to the Cursor, then the type of this parameter is the one returned by the mapFn.
   */
  /**
   * Callback version of {@link Cursor#exec}.
   * @param {Cursor~execCallback} _callback
   * @see Cursor#execAsync
   */
  exec(_callback) {
    callbackify$1(() => this.execAsync())(_callback);
  }
  /**
   * Get all matching elements.
   * Will return pointers to matched elements (shallow copies), returning full copies is the role of {@link Datastore#findAsync} or {@link Datastore#findOneAsync}.
   * @return {Promise<document[]|*>}
   * @async
   */
  execAsync() {
    return this.db.executor.pushAsync(() => this._execAsync());
  }
  then(onFulfilled, onRejected) {
    return this.execAsync().then(onFulfilled, onRejected);
  }
  catch(onRejected) {
    return this.execAsync().catch(onRejected);
  }
  finally(onFinally) {
    return this.execAsync().finally(onFinally);
  }
};
var cursor = Cursor$1;
var customUtils$4 = {};
const crypto = require$$0$4;
const uid = (len) => crypto.randomBytes(Math.ceil(Math.max(8, len * 2))).toString("base64").replace(/[+/]/g, "").slice(0, len);
customUtils$4.uid = uid;
let Waterfall$2 = class Waterfall {
  /**
   * Instantiate a new Waterfall.
   */
  constructor() {
    this.guardian = Promise.resolve();
  }
  /**
   *
   * @param {AsyncFunction} func
   * @return {AsyncFunction}
   */
  waterfall(func) {
    return (...args) => {
      this.guardian = this.guardian.then(() => {
        return func(...args).then((result) => ({ error: false, result }), (result) => ({ error: true, result }));
      });
      return this.guardian.then(({ error: error2, result }) => {
        if (error2) return Promise.reject(result);
        else return Promise.resolve(result);
      });
    };
  }
  /**
   * Shorthand for chaining a promise to the Waterfall
   * @param {Promise} promise
   * @return {Promise}
   */
  chain(promise) {
    return this.waterfall(() => promise)();
  }
};
var waterfall = Waterfall$2;
const Waterfall$1 = waterfall;
let Executor$1 = class Executor {
  /**
   * Instantiates a new Executor.
   */
  constructor() {
    this.ready = false;
    this.queue = new Waterfall$1();
    this.buffer = null;
    this._triggerBuffer = null;
    this.resetBuffer();
  }
  /**
   * If executor is ready, queue task (and process it immediately if executor was idle)
   * If not, buffer task for later processing
   * @param {AsyncFunction} task Function to execute
   * @param {boolean} [forceQueuing = false] Optional (defaults to false) force executor to queue task even if it is not ready
   * @return {Promise<*>}
   * @async
   * @see Executor#push
   */
  pushAsync(task, forceQueuing = false) {
    if (this.ready || forceQueuing) return this.queue.waterfall(task)();
    else return this.buffer.waterfall(task)();
  }
  /**
   * Queue all tasks in buffer (in the same order they came in)
   * Automatically sets executor as ready
   */
  processBuffer() {
    this.ready = true;
    this._triggerBuffer();
    this.queue.waterfall(() => this.buffer.guardian);
  }
  /**
   * Removes all tasks queued up in the buffer
   */
  resetBuffer() {
    this.buffer = new Waterfall$1();
    this.buffer.chain(new Promise((resolve2) => {
      this._triggerBuffer = resolve2;
    }));
    if (this.ready) this._triggerBuffer();
  }
};
var executor = Executor$1;
var binarySearchTree = {};
var customUtils$3 = {};
const getRandomArray = (n) => {
  if (n === 0) return [];
  if (n === 1) return [0];
  const res = getRandomArray(n - 1);
  const next2 = Math.floor(Math.random() * n);
  res.splice(next2, 0, n - 1);
  return res;
};
customUtils$3.getRandomArray = getRandomArray;
const defaultCompareKeysFunction = (a, b) => {
  if (a < b) return -1;
  if (a > b) return 1;
  if (a === b) return 0;
  const err = new Error("Couldn't compare elements");
  err.a = a;
  err.b = b;
  throw err;
};
customUtils$3.defaultCompareKeysFunction = defaultCompareKeysFunction;
const defaultCheckValueEquality = (a, b) => a === b;
customUtils$3.defaultCheckValueEquality = defaultCheckValueEquality;
const customUtils$2 = customUtils$3;
let BinarySearchTree$2 = class BinarySearchTree {
  /**
   * Constructor
   * @param {Object} options Optional
   * @param {Boolean}  options.unique Whether to enforce a 'unique' constraint on the key or not
   * @param {Key}      options.key Initialize this BST's key with key
   * @param {Value}    options.value Initialize this BST's data with [value]
   * @param {Function} options.compareKeys Initialize this BST's compareKeys
   */
  constructor(options) {
    options = options || {};
    this.left = null;
    this.right = null;
    this.parent = options.parent !== void 0 ? options.parent : null;
    if (Object.prototype.hasOwnProperty.call(options, "key")) {
      this.key = options.key;
    }
    this.data = Object.prototype.hasOwnProperty.call(options, "value") ? [options.value] : [];
    this.unique = options.unique || false;
    this.compareKeys = options.compareKeys || customUtils$2.defaultCompareKeysFunction;
    this.checkValueEquality = options.checkValueEquality || customUtils$2.defaultCheckValueEquality;
  }
  /**
   * Get the descendant with max key
   */
  getMaxKeyDescendant() {
    if (this.right) return this.right.getMaxKeyDescendant();
    else return this;
  }
  /**
   * Get the maximum key
   */
  getMaxKey() {
    return this.getMaxKeyDescendant().key;
  }
  /**
   * Get the descendant with min key
   */
  getMinKeyDescendant() {
    if (this.left) return this.left.getMinKeyDescendant();
    else return this;
  }
  /**
   * Get the minimum key
   */
  getMinKey() {
    return this.getMinKeyDescendant().key;
  }
  /**
   * Check that all nodes (incl. leaves) fullfil condition given by fn
   * test is a function passed every (key, data) and which throws if the condition is not met
   */
  checkAllNodesFullfillCondition(test) {
    if (!Object.prototype.hasOwnProperty.call(this, "key")) return;
    test(this.key, this.data);
    if (this.left) this.left.checkAllNodesFullfillCondition(test);
    if (this.right) this.right.checkAllNodesFullfillCondition(test);
  }
  /**
   * Check that the core BST properties on node ordering are verified
   * Throw if they aren't
   */
  checkNodeOrdering() {
    if (!Object.prototype.hasOwnProperty.call(this, "key")) return;
    if (this.left) {
      this.left.checkAllNodesFullfillCondition((k) => {
        if (this.compareKeys(k, this.key) >= 0) throw new Error(`Tree with root ${this.key} is not a binary search tree`);
      });
      this.left.checkNodeOrdering();
    }
    if (this.right) {
      this.right.checkAllNodesFullfillCondition((k) => {
        if (this.compareKeys(k, this.key) <= 0) throw new Error(`Tree with root ${this.key} is not a binary search tree`);
      });
      this.right.checkNodeOrdering();
    }
  }
  /**
   * Check that all pointers are coherent in this tree
   */
  checkInternalPointers() {
    if (this.left) {
      if (this.left.parent !== this) throw new Error(`Parent pointer broken for key ${this.key}`);
      this.left.checkInternalPointers();
    }
    if (this.right) {
      if (this.right.parent !== this) throw new Error(`Parent pointer broken for key ${this.key}`);
      this.right.checkInternalPointers();
    }
  }
  /**
   * Check that a tree is a BST as defined here (node ordering and pointer references)
   */
  checkIsBST() {
    this.checkNodeOrdering();
    this.checkInternalPointers();
    if (this.parent) throw new Error("The root shouldn't have a parent");
  }
  /**
   * Get number of keys inserted
   */
  getNumberOfKeys() {
    let res;
    if (!Object.prototype.hasOwnProperty.call(this, "key")) return 0;
    res = 1;
    if (this.left) res += this.left.getNumberOfKeys();
    if (this.right) res += this.right.getNumberOfKeys();
    return res;
  }
  /**
   * Create a BST similar (i.e. same options except for key and value) to the current one
   * Use the same constructor (i.e. BinarySearchTree, AVLTree etc)
   * @param {Object} options see constructor
   */
  createSimilar(options) {
    options = options || {};
    options.unique = this.unique;
    options.compareKeys = this.compareKeys;
    options.checkValueEquality = this.checkValueEquality;
    return new this.constructor(options);
  }
  /**
   * Create the left child of this BST and return it
   */
  createLeftChild(options) {
    const leftChild = this.createSimilar(options);
    leftChild.parent = this;
    this.left = leftChild;
    return leftChild;
  }
  /**
   * Create the right child of this BST and return it
   */
  createRightChild(options) {
    const rightChild = this.createSimilar(options);
    rightChild.parent = this;
    this.right = rightChild;
    return rightChild;
  }
  /**
   * Insert a new element
   */
  insert(key, value) {
    if (!Object.prototype.hasOwnProperty.call(this, "key")) {
      this.key = key;
      this.data.push(value);
      return;
    }
    if (this.compareKeys(this.key, key) === 0) {
      if (this.unique) {
        const err = new Error(`Can't insert key ${JSON.stringify(key)}, it violates the unique constraint`);
        err.key = key;
        err.errorType = "uniqueViolated";
        throw err;
      } else this.data.push(value);
      return;
    }
    if (this.compareKeys(key, this.key) < 0) {
      if (this.left) this.left.insert(key, value);
      else this.createLeftChild({ key, value });
    } else {
      if (this.right) this.right.insert(key, value);
      else this.createRightChild({ key, value });
    }
  }
  /**
   * Search for all data corresponding to a key
   */
  search(key) {
    if (!Object.prototype.hasOwnProperty.call(this, "key")) return [];
    if (this.compareKeys(this.key, key) === 0) return this.data;
    if (this.compareKeys(key, this.key) < 0) {
      if (this.left) return this.left.search(key);
      else return [];
    } else {
      if (this.right) return this.right.search(key);
      else return [];
    }
  }
  /**
   * Return a function that tells whether a given key matches a lower bound
   */
  getLowerBoundMatcher(query) {
    if (!Object.prototype.hasOwnProperty.call(query, "$gt") && !Object.prototype.hasOwnProperty.call(query, "$gte")) return () => true;
    if (Object.prototype.hasOwnProperty.call(query, "$gt") && Object.prototype.hasOwnProperty.call(query, "$gte")) {
      if (this.compareKeys(query.$gte, query.$gt) === 0) return (key) => this.compareKeys(key, query.$gt) > 0;
      if (this.compareKeys(query.$gte, query.$gt) > 0) return (key) => this.compareKeys(key, query.$gte) >= 0;
      else return (key) => this.compareKeys(key, query.$gt) > 0;
    }
    if (Object.prototype.hasOwnProperty.call(query, "$gt")) return (key) => this.compareKeys(key, query.$gt) > 0;
    else return (key) => this.compareKeys(key, query.$gte) >= 0;
  }
  /**
   * Return a function that tells whether a given key matches an upper bound
   */
  getUpperBoundMatcher(query) {
    if (!Object.prototype.hasOwnProperty.call(query, "$lt") && !Object.prototype.hasOwnProperty.call(query, "$lte")) return () => true;
    if (Object.prototype.hasOwnProperty.call(query, "$lt") && Object.prototype.hasOwnProperty.call(query, "$lte")) {
      if (this.compareKeys(query.$lte, query.$lt) === 0) return (key) => this.compareKeys(key, query.$lt) < 0;
      if (this.compareKeys(query.$lte, query.$lt) < 0) return (key) => this.compareKeys(key, query.$lte) <= 0;
      else return (key) => this.compareKeys(key, query.$lt) < 0;
    }
    if (Object.prototype.hasOwnProperty.call(query, "$lt")) return (key) => this.compareKeys(key, query.$lt) < 0;
    else return (key) => this.compareKeys(key, query.$lte) <= 0;
  }
  /**
   * Get all data for a key between bounds
   * Return it in key order
   * @param {Object} query Mongo-style query where keys are $lt, $lte, $gt or $gte (other keys are not considered)
   * @param {Functions} lbm/ubm matching functions calculated at the first recursive step
   */
  betweenBounds(query, lbm, ubm) {
    const res = [];
    if (!Object.prototype.hasOwnProperty.call(this, "key")) return [];
    lbm = lbm || this.getLowerBoundMatcher(query);
    ubm = ubm || this.getUpperBoundMatcher(query);
    if (lbm(this.key) && this.left) append(res, this.left.betweenBounds(query, lbm, ubm));
    if (lbm(this.key) && ubm(this.key)) append(res, this.data);
    if (ubm(this.key) && this.right) append(res, this.right.betweenBounds(query, lbm, ubm));
    return res;
  }
  /**
   * Delete the current node if it is a leaf
   * Return true if it was deleted
   */
  deleteIfLeaf() {
    if (this.left || this.right) return false;
    if (!this.parent) {
      delete this.key;
      this.data = [];
      return true;
    }
    if (this.parent.left === this) this.parent.left = null;
    else this.parent.right = null;
    return true;
  }
  /**
   * Delete the current node if it has only one child
   * Return true if it was deleted
   */
  deleteIfOnlyOneChild() {
    let child;
    if (this.left && !this.right) child = this.left;
    if (!this.left && this.right) child = this.right;
    if (!child) return false;
    if (!this.parent) {
      this.key = child.key;
      this.data = child.data;
      this.left = null;
      if (child.left) {
        this.left = child.left;
        child.left.parent = this;
      }
      this.right = null;
      if (child.right) {
        this.right = child.right;
        child.right.parent = this;
      }
      return true;
    }
    if (this.parent.left === this) {
      this.parent.left = child;
      child.parent = this.parent;
    } else {
      this.parent.right = child;
      child.parent = this.parent;
    }
    return true;
  }
  /**
   * Delete a key or just a value
   * @param {Key} key
   * @param {Value} value Optional. If not set, the whole key is deleted. If set, only this value is deleted
   */
  delete(key, value) {
    const newData = [];
    let replaceWith;
    if (!Object.prototype.hasOwnProperty.call(this, "key")) return;
    if (this.compareKeys(key, this.key) < 0) {
      if (this.left) this.left.delete(key, value);
      return;
    }
    if (this.compareKeys(key, this.key) > 0) {
      if (this.right) this.right.delete(key, value);
      return;
    }
    if (!this.compareKeys(key, this.key) === 0) return;
    if (this.data.length > 1 && value !== void 0) {
      this.data.forEach((d) => {
        if (!this.checkValueEquality(d, value)) newData.push(d);
      });
      this.data = newData;
      return;
    }
    if (this.deleteIfLeaf()) return;
    if (this.deleteIfOnlyOneChild()) return;
    if (Math.random() >= 0.5) {
      replaceWith = this.left.getMaxKeyDescendant();
      this.key = replaceWith.key;
      this.data = replaceWith.data;
      if (this === replaceWith.parent) {
        this.left = replaceWith.left;
        if (replaceWith.left) replaceWith.left.parent = replaceWith.parent;
      } else {
        replaceWith.parent.right = replaceWith.left;
        if (replaceWith.left) replaceWith.left.parent = replaceWith.parent;
      }
    } else {
      replaceWith = this.right.getMinKeyDescendant();
      this.key = replaceWith.key;
      this.data = replaceWith.data;
      if (this === replaceWith.parent) {
        this.right = replaceWith.right;
        if (replaceWith.right) replaceWith.right.parent = replaceWith.parent;
      } else {
        replaceWith.parent.left = replaceWith.right;
        if (replaceWith.right) replaceWith.right.parent = replaceWith.parent;
      }
    }
  }
  /**
   * Execute a function on every node of the tree, in key order
   * @param {Function} fn Signature: node. Most useful will probably be node.key and node.data
   */
  executeOnEveryNode(fn) {
    if (this.left) this.left.executeOnEveryNode(fn);
    fn(this);
    if (this.right) this.right.executeOnEveryNode(fn);
  }
  /**
   * Pretty print a tree
   * @param {Boolean} printData To print the nodes' data along with the key
   */
  prettyPrint(printData, spacing) {
    spacing = spacing || "";
    console.log(`${spacing}* ${this.key}`);
    if (printData) console.log(`${spacing}* ${this.data}`);
    if (!this.left && !this.right) return;
    if (this.left) this.left.prettyPrint(printData, `${spacing}  `);
    else console.log(`${spacing}  *`);
    if (this.right) this.right.prettyPrint(printData, `${spacing}  `);
    else console.log(`${spacing}  *`);
  }
};
function append(array, toAppend) {
  for (let i = 0; i < toAppend.length; i += 1) {
    array.push(toAppend[i]);
  }
}
var bst = BinarySearchTree$2;
const BinarySearchTree$1 = bst;
const customUtils$1 = customUtils$3;
class AVLTree {
  /**
   * Constructor
   * We can't use a direct pointer to the root node (as in the simple binary search tree)
   * as the root will change during tree rotations
   * @param {Boolean}  options.unique Whether to enforce a 'unique' constraint on the key or not
   * @param {Function} options.compareKeys Initialize this BST's compareKeys
   */
  constructor(options) {
    this.tree = new _AVLTree(options);
  }
  checkIsAVLT() {
    this.tree.checkIsAVLT();
  }
  // Insert in the internal tree, update the pointer to the root if needed
  insert(key, value) {
    const newTree = this.tree.insert(key, value);
    if (newTree) {
      this.tree = newTree;
    }
  }
  // Delete a value
  delete(key, value) {
    const newTree = this.tree.delete(key, value);
    if (newTree) {
      this.tree = newTree;
    }
  }
}
class _AVLTree extends BinarySearchTree$1 {
  /**
   * Constructor of the internal AVLTree
   * @param {Object} options Optional
   * @param {Boolean}  options.unique Whether to enforce a 'unique' constraint on the key or not
   * @param {Key}      options.key Initialize this BST's key with key
   * @param {Value}    options.value Initialize this BST's data with [value]
   * @param {Function} options.compareKeys Initialize this BST's compareKeys
   */
  constructor(options) {
    super();
    options = options || {};
    this.left = null;
    this.right = null;
    this.parent = options.parent !== void 0 ? options.parent : null;
    if (Object.prototype.hasOwnProperty.call(options, "key")) this.key = options.key;
    this.data = Object.prototype.hasOwnProperty.call(options, "value") ? [options.value] : [];
    this.unique = options.unique || false;
    this.compareKeys = options.compareKeys || customUtils$1.defaultCompareKeysFunction;
    this.checkValueEquality = options.checkValueEquality || customUtils$1.defaultCheckValueEquality;
  }
  /**
   * Check the recorded height is correct for every node
   * Throws if one height doesn't match
   */
  checkHeightCorrect() {
    if (!Object.prototype.hasOwnProperty.call(this, "key")) {
      return;
    }
    if (this.left && this.left.height === void 0) {
      throw new Error("Undefined height for node " + this.left.key);
    }
    if (this.right && this.right.height === void 0) {
      throw new Error("Undefined height for node " + this.right.key);
    }
    if (this.height === void 0) {
      throw new Error("Undefined height for node " + this.key);
    }
    const leftH = this.left ? this.left.height : 0;
    const rightH = this.right ? this.right.height : 0;
    if (this.height !== 1 + Math.max(leftH, rightH)) {
      throw new Error("Height constraint failed for node " + this.key);
    }
    if (this.left) {
      this.left.checkHeightCorrect();
    }
    if (this.right) {
      this.right.checkHeightCorrect();
    }
  }
  /**
   * Return the balance factor
   */
  balanceFactor() {
    const leftH = this.left ? this.left.height : 0;
    const rightH = this.right ? this.right.height : 0;
    return leftH - rightH;
  }
  /**
   * Check that the balance factors are all between -1 and 1
   */
  checkBalanceFactors() {
    if (Math.abs(this.balanceFactor()) > 1) {
      throw new Error("Tree is unbalanced at node " + this.key);
    }
    if (this.left) {
      this.left.checkBalanceFactors();
    }
    if (this.right) {
      this.right.checkBalanceFactors();
    }
  }
  /**
   * When checking if the BST conditions are met, also check that the heights are correct
   * and the tree is balanced
   */
  checkIsAVLT() {
    super.checkIsBST();
    this.checkHeightCorrect();
    this.checkBalanceFactors();
  }
  /**
   * Perform a right rotation of the tree if possible
   * and return the root of the resulting tree
   * The resulting tree's nodes' heights are also updated
   */
  rightRotation() {
    const q2 = this;
    const p = this.left;
    if (!p) return q2;
    const b = p.right;
    if (q2.parent) {
      p.parent = q2.parent;
      if (q2.parent.left === q2) q2.parent.left = p;
      else q2.parent.right = p;
    } else {
      p.parent = null;
    }
    p.right = q2;
    q2.parent = p;
    q2.left = b;
    if (b) {
      b.parent = q2;
    }
    const ah = p.left ? p.left.height : 0;
    const bh = b ? b.height : 0;
    const ch = q2.right ? q2.right.height : 0;
    q2.height = Math.max(bh, ch) + 1;
    p.height = Math.max(ah, q2.height) + 1;
    return p;
  }
  /**
   * Perform a left rotation of the tree if possible
   * and return the root of the resulting tree
   * The resulting tree's nodes' heights are also updated
   */
  leftRotation() {
    const p = this;
    const q2 = this.right;
    if (!q2) {
      return this;
    }
    const b = q2.left;
    if (p.parent) {
      q2.parent = p.parent;
      if (p.parent.left === p) p.parent.left = q2;
      else p.parent.right = q2;
    } else {
      q2.parent = null;
    }
    q2.left = p;
    p.parent = q2;
    p.right = b;
    if (b) {
      b.parent = p;
    }
    const ah = p.left ? p.left.height : 0;
    const bh = b ? b.height : 0;
    const ch = q2.right ? q2.right.height : 0;
    p.height = Math.max(ah, bh) + 1;
    q2.height = Math.max(ch, p.height) + 1;
    return q2;
  }
  /**
   * Modify the tree if its right subtree is too small compared to the left
   * Return the new root if any
   */
  rightTooSmall() {
    if (this.balanceFactor() <= 1) return this;
    if (this.left.balanceFactor() < 0) this.left.leftRotation();
    return this.rightRotation();
  }
  /**
   * Modify the tree if its left subtree is too small compared to the right
   * Return the new root if any
   */
  leftTooSmall() {
    if (this.balanceFactor() >= -1) {
      return this;
    }
    if (this.right.balanceFactor() > 0) this.right.rightRotation();
    return this.leftRotation();
  }
  /**
   * Rebalance the tree along the given path. The path is given reversed (as he was calculated
   * in the insert and delete functions).
   * Returns the new root of the tree
   * Of course, the first element of the path must be the root of the tree
   */
  rebalanceAlongPath(path2) {
    let newRoot = this;
    let rotated;
    let i;
    if (!Object.prototype.hasOwnProperty.call(this, "key")) {
      delete this.height;
      return this;
    }
    for (i = path2.length - 1; i >= 0; i -= 1) {
      path2[i].height = 1 + Math.max(path2[i].left ? path2[i].left.height : 0, path2[i].right ? path2[i].right.height : 0);
      if (path2[i].balanceFactor() > 1) {
        rotated = path2[i].rightTooSmall();
        if (i === 0) newRoot = rotated;
      }
      if (path2[i].balanceFactor() < -1) {
        rotated = path2[i].leftTooSmall();
        if (i === 0) newRoot = rotated;
      }
    }
    return newRoot;
  }
  /**
   * Insert a key, value pair in the tree while maintaining the AVL tree height constraint
   * Return a pointer to the root node, which may have changed
   */
  insert(key, value) {
    const insertPath = [];
    let currentNode = this;
    if (!Object.prototype.hasOwnProperty.call(this, "key")) {
      this.key = key;
      this.data.push(value);
      this.height = 1;
      return this;
    }
    while (true) {
      if (currentNode.compareKeys(currentNode.key, key) === 0) {
        if (currentNode.unique) {
          const err = new Error(`Can't insert key ${JSON.stringify(key)}, it violates the unique constraint`);
          err.key = key;
          err.errorType = "uniqueViolated";
          throw err;
        } else currentNode.data.push(value);
        return this;
      }
      insertPath.push(currentNode);
      if (currentNode.compareKeys(key, currentNode.key) < 0) {
        if (!currentNode.left) {
          insertPath.push(currentNode.createLeftChild({ key, value }));
          break;
        } else currentNode = currentNode.left;
      } else {
        if (!currentNode.right) {
          insertPath.push(currentNode.createRightChild({ key, value }));
          break;
        } else currentNode = currentNode.right;
      }
    }
    return this.rebalanceAlongPath(insertPath);
  }
  /**
   * Delete a key or just a value and return the new root of the tree
   * @param {Key} key
   * @param {Value} value Optional. If not set, the whole key is deleted. If set, only this value is deleted
   */
  delete(key, value) {
    const newData = [];
    let replaceWith;
    let currentNode = this;
    const deletePath = [];
    if (!Object.prototype.hasOwnProperty.call(this, "key")) return this;
    while (true) {
      if (currentNode.compareKeys(key, currentNode.key) === 0) {
        break;
      }
      deletePath.push(currentNode);
      if (currentNode.compareKeys(key, currentNode.key) < 0) {
        if (currentNode.left) {
          currentNode = currentNode.left;
        } else return this;
      } else {
        if (currentNode.right) {
          currentNode = currentNode.right;
        } else return this;
      }
    }
    if (currentNode.data.length > 1 && value !== void 0) {
      currentNode.data.forEach(function(d) {
        if (!currentNode.checkValueEquality(d, value)) newData.push(d);
      });
      currentNode.data = newData;
      return this;
    }
    if (!currentNode.left && !currentNode.right) {
      if (currentNode === this) {
        delete currentNode.key;
        currentNode.data = [];
        delete currentNode.height;
        return this;
      } else {
        if (currentNode.parent.left === currentNode) currentNode.parent.left = null;
        else currentNode.parent.right = null;
        return this.rebalanceAlongPath(deletePath);
      }
    }
    if (!currentNode.left || !currentNode.right) {
      replaceWith = currentNode.left ? currentNode.left : currentNode.right;
      if (currentNode === this) {
        replaceWith.parent = null;
        return replaceWith;
      } else {
        if (currentNode.parent.left === currentNode) {
          currentNode.parent.left = replaceWith;
          replaceWith.parent = currentNode.parent;
        } else {
          currentNode.parent.right = replaceWith;
          replaceWith.parent = currentNode.parent;
        }
        return this.rebalanceAlongPath(deletePath);
      }
    }
    deletePath.push(currentNode);
    replaceWith = currentNode.left;
    if (!replaceWith.right) {
      currentNode.key = replaceWith.key;
      currentNode.data = replaceWith.data;
      currentNode.left = replaceWith.left;
      if (replaceWith.left) {
        replaceWith.left.parent = currentNode;
      }
      return this.rebalanceAlongPath(deletePath);
    }
    while (true) {
      if (replaceWith.right) {
        deletePath.push(replaceWith);
        replaceWith = replaceWith.right;
      } else break;
    }
    currentNode.key = replaceWith.key;
    currentNode.data = replaceWith.data;
    replaceWith.parent.right = replaceWith.left;
    if (replaceWith.left) replaceWith.left.parent = replaceWith.parent;
    return this.rebalanceAlongPath(deletePath);
  }
}
AVLTree._AVLTree = _AVLTree;
["getNumberOfKeys", "search", "betweenBounds", "prettyPrint", "executeOnEveryNode"].forEach(function(fn) {
  AVLTree.prototype[fn] = function() {
    return this.tree[fn].apply(this.tree, arguments);
  };
});
var avltree = AVLTree;
binarySearchTree.BinarySearchTree = bst;
binarySearchTree.AVLTree = avltree;
const BinarySearchTree2 = binarySearchTree.AVLTree;
const model$2 = model$4;
const { uniq, isDate: isDate$1 } = utils;
const checkValueEquality = (a, b) => a === b;
const projectForUnique = (elt) => {
  if (elt === null) return "$null";
  if (typeof elt === "string") return "$string" + elt;
  if (typeof elt === "boolean") return "$boolean" + elt;
  if (typeof elt === "number") return "$number" + elt;
  if (isDate$1(elt)) return "$date" + elt.getTime();
  return elt;
};
let Index$2 = class Index {
  /**
   * Create a new index
   * All methods on an index guarantee that either the whole operation was successful and the index changed
   * or the operation was unsuccessful and an error is thrown while the index is unchanged
   * @param {object} options
   * @param {string} options.fieldName On which field should the index apply, can use dot notation to index on sub fields, can use comma-separated notation to use compound indexes
   * @param {boolean} [options.unique = false] Enforces a unique constraint
   * @param {boolean} [options.sparse = false] Allows a sparse index (we can have documents for which fieldName is `undefined`)
   */
  constructor(options) {
    this.fieldName = options.fieldName;
    if (typeof this.fieldName !== "string") throw new Error("fieldName must be a string");
    this._fields = this.fieldName.split(",");
    this.unique = options.unique || false;
    this.sparse = options.sparse || false;
    this.treeOptions = { unique: this.unique, compareKeys: model$2.compareThings, checkValueEquality };
    this.tree = new BinarySearchTree2(this.treeOptions);
  }
  /**
   * Reset an index
   * @param {?document|?document[]} [newData] Data to initialize the index with. If an error is thrown during
   * insertion, the index is not modified.
   */
  reset(newData) {
    this.tree = new BinarySearchTree2(this.treeOptions);
    if (newData) this.insert(newData);
  }
  /**
   * Insert a new document in the index
   * If an array is passed, we insert all its elements (if one insertion fails the index is not modified)
   * O(log(n))
   * @param {document|document[]} doc The document, or array of documents, to insert.
   */
  insert(doc) {
    let keys2;
    let failingIndex;
    let error2;
    if (Array.isArray(doc)) {
      this.insertMultipleDocs(doc);
      return;
    }
    const key = model$2.getDotValues(doc, this._fields);
    if ((key === void 0 || typeof key === "object" && key !== null && Object.values(key).every((el) => el === void 0)) && this.sparse) return;
    if (!Array.isArray(key)) this.tree.insert(key, doc);
    else {
      keys2 = uniq(key, projectForUnique);
      for (let i = 0; i < keys2.length; i += 1) {
        try {
          this.tree.insert(keys2[i], doc);
        } catch (e) {
          error2 = e;
          failingIndex = i;
          break;
        }
      }
      if (error2) {
        for (let i = 0; i < failingIndex; i += 1) {
          this.tree.delete(keys2[i], doc);
        }
        throw error2;
      }
    }
  }
  /**
   * Insert an array of documents in the index
   * If a constraint is violated, the changes should be rolled back and an error thrown
   * @param {document[]} docs Array of documents to insert.
   * @private
   */
  insertMultipleDocs(docs) {
    let error2;
    let failingIndex;
    for (let i = 0; i < docs.length; i += 1) {
      try {
        this.insert(docs[i]);
      } catch (e) {
        error2 = e;
        failingIndex = i;
        break;
      }
    }
    if (error2) {
      for (let i = 0; i < failingIndex; i += 1) {
        this.remove(docs[i]);
      }
      throw error2;
    }
  }
  /**
   * Removes a document from the index.
   * If an array is passed, we remove all its elements
   * The remove operation is safe with regards to the 'unique' constraint
   * O(log(n))
   * @param {document[]|document} doc The document, or Array of documents, to remove.
   */
  remove(doc) {
    if (Array.isArray(doc)) {
      doc.forEach((d) => {
        this.remove(d);
      });
      return;
    }
    const key = model$2.getDotValues(doc, this._fields);
    if (key === void 0 && this.sparse) return;
    if (!Array.isArray(key)) {
      this.tree.delete(key, doc);
    } else {
      uniq(key, projectForUnique).forEach((_key) => {
        this.tree.delete(_key, doc);
      });
    }
  }
  /**
   * Update a document in the index
   * If a constraint is violated, changes are rolled back and an error thrown
   * Naive implementation, still in O(log(n))
   * @param {document|Array.<{oldDoc: document, newDoc: document}>} oldDoc Document to update, or an `Array` of
   * `{oldDoc, newDoc}` pairs.
   * @param {document} [newDoc] Document to replace the oldDoc with. If the first argument is an `Array` of
   * `{oldDoc, newDoc}` pairs, this second argument is ignored.
   */
  update(oldDoc, newDoc) {
    if (Array.isArray(oldDoc)) {
      this.updateMultipleDocs(oldDoc);
      return;
    }
    this.remove(oldDoc);
    try {
      this.insert(newDoc);
    } catch (e) {
      this.insert(oldDoc);
      throw e;
    }
  }
  /**
   * Update multiple documents in the index
   * If a constraint is violated, the changes need to be rolled back
   * and an error thrown
   * @param {Array.<{oldDoc: document, newDoc: document}>} pairs
   *
   * @private
   */
  updateMultipleDocs(pairs) {
    let failingIndex;
    let error2;
    for (let i = 0; i < pairs.length; i += 1) {
      this.remove(pairs[i].oldDoc);
    }
    for (let i = 0; i < pairs.length; i += 1) {
      try {
        this.insert(pairs[i].newDoc);
      } catch (e) {
        error2 = e;
        failingIndex = i;
        break;
      }
    }
    if (error2) {
      for (let i = 0; i < failingIndex; i += 1) {
        this.remove(pairs[i].newDoc);
      }
      for (let i = 0; i < pairs.length; i += 1) {
        this.insert(pairs[i].oldDoc);
      }
      throw error2;
    }
  }
  /**
   * Revert an update
   * @param {document|Array.<{oldDoc: document, newDoc: document}>} oldDoc Document to revert to, or an `Array` of `{oldDoc, newDoc}` pairs.
   * @param {document} [newDoc] Document to revert from. If the first argument is an Array of {oldDoc, newDoc}, this second argument is ignored.
   */
  revertUpdate(oldDoc, newDoc) {
    const revert = [];
    if (!Array.isArray(oldDoc)) this.update(newDoc, oldDoc);
    else {
      oldDoc.forEach((pair) => {
        revert.push({ oldDoc: pair.newDoc, newDoc: pair.oldDoc });
      });
      this.update(revert);
    }
  }
  /**
   * Get all documents in index whose key match value (if it is a Thing) or one of the elements of value (if it is an array of Things)
   * @param {Array.<*>|*} value Value to match the key against
   * @return {document[]}
   */
  getMatching(value) {
    if (!Array.isArray(value)) return this.tree.search(value);
    else {
      const _res = {};
      const res = [];
      value.forEach((v) => {
        this.getMatching(v).forEach((doc) => {
          _res[doc._id] = doc;
        });
      });
      Object.keys(_res).forEach((_id) => {
        res.push(_res[_id]);
      });
      return res;
    }
  }
  /**
   * Get all documents in index whose key is between bounds are they are defined by query
   * Documents are sorted by key
   * @param {object} query An object with at least one matcher among $gt, $gte, $lt, $lte.
   * @param {*} [query.$gt] Greater than matcher.
   * @param {*} [query.$gte] Greater than or equal matcher.
   * @param {*} [query.$lt] Lower than matcher.
   * @param {*} [query.$lte] Lower than or equal matcher.
   * @return {document[]}
   */
  getBetweenBounds(query) {
    return this.tree.betweenBounds(query);
  }
  /**
   * Get all elements in the index
   * @return {document[]}
   */
  getAll() {
    const res = [];
    this.tree.executeOnEveryNode((node) => {
      res.push(...node.data);
    });
    return res;
  }
};
var indexes = Index$2;
const stream = require$$0$2;
const timers = require$$1$2;
const { Buffer: Buffer$1 } = require$$2$1;
const createLineStream = (readStream, options) => {
  if (!readStream) throw new Error("expected readStream");
  if (!readStream.readable) throw new Error("readStream must be readable");
  const ls = new LineStream(options);
  readStream.pipe(ls);
  return ls;
};
class LineStream extends stream.Transform {
  constructor(options) {
    super(options);
    options = options || {};
    this._readableState.objectMode = true;
    this._lineBuffer = [];
    this._keepEmptyLines = options.keepEmptyLines || false;
    this._lastChunkEndedWithCR = false;
    this.once("pipe", (src) => {
      if (!this.encoding && src instanceof stream.Readable) this.encoding = src._readableState.encoding;
    });
  }
  _transform(chunk, encoding, done) {
    encoding = encoding || "utf8";
    if (Buffer$1.isBuffer(chunk)) {
      if (encoding === "buffer") {
        chunk = chunk.toString();
        encoding = "utf8";
      } else chunk = chunk.toString(encoding);
    }
    this._chunkEncoding = encoding;
    const lines = chunk.split(/\r\n|[\n\v\f\r\x85\u2028\u2029]/g);
    if (this._lastChunkEndedWithCR && chunk[0] === "\n") lines.shift();
    if (this._lineBuffer.length > 0) {
      this._lineBuffer[this._lineBuffer.length - 1] += lines[0];
      lines.shift();
    }
    this._lastChunkEndedWithCR = chunk[chunk.length - 1] === "\r";
    this._lineBuffer = this._lineBuffer.concat(lines);
    this._pushBuffer(encoding, 1, done);
  }
  _pushBuffer(encoding, keep, done) {
    while (this._lineBuffer.length > keep) {
      const line = this._lineBuffer.shift();
      if (this._keepEmptyLines || line.length > 0) {
        if (!this.push(this._reencode(line, encoding))) {
          timers.setImmediate(() => {
            this._pushBuffer(encoding, keep, done);
          });
          return;
        }
      }
    }
    done();
  }
  _flush(done) {
    this._pushBuffer(this._chunkEncoding, 0, done);
  }
  // see Readable::push
  _reencode(line, chunkEncoding) {
    if (this.encoding && this.encoding !== chunkEncoding) return Buffer$1.from(line, chunkEncoding).toString(this.encoding);
    else if (this.encoding) return line;
    else return Buffer$1.from(line, chunkEncoding);
  }
}
var byline$1 = createLineStream;
var storage$1 = {};
const fs = require$$0$3;
const fsPromises = fs.promises;
const path = path$e;
const { Readable } = require$$0$2;
const DEFAULT_DIR_MODE$1 = 493;
const DEFAULT_FILE_MODE$1 = 420;
const existsAsync = (file2) => fsPromises.access(file2, fs.constants.F_OK).then(() => true, () => false);
const renameAsync = fsPromises.rename;
const writeFileAsync = fsPromises.writeFile;
const writeFileStream = fs.createWriteStream;
const unlinkAsync = fsPromises.unlink;
const appendFileAsync = fsPromises.appendFile;
const readFileAsync = fsPromises.readFile;
const readFileStream = fs.createReadStream;
const mkdirAsync = fsPromises.mkdir;
const ensureFileDoesntExistAsync = async (file2) => {
  if (await existsAsync(file2)) await unlinkAsync(file2);
};
const flushToStorageAsync = async (options) => {
  let filename;
  let flags;
  let mode;
  if (typeof options === "string") {
    filename = options;
    flags = "r+";
    mode = DEFAULT_FILE_MODE$1;
  } else {
    filename = options.filename;
    flags = options.isDir ? "r" : "r+";
    mode = options.mode !== void 0 ? options.mode : DEFAULT_FILE_MODE$1;
  }
  let filehandle, errorOnFsync, errorOnClose;
  try {
    filehandle = await fsPromises.open(filename, flags, mode);
    try {
      await filehandle.sync();
    } catch (errFS) {
      errorOnFsync = errFS;
    }
  } catch (error2) {
    if (error2.code !== "EISDIR" || !options.isDir) throw error2;
  } finally {
    try {
      await filehandle.close();
    } catch (errC) {
      errorOnClose = errC;
    }
  }
  if ((errorOnFsync || errorOnClose) && !((errorOnFsync.code === "EPERM" || errorOnClose.code === "EISDIR") && options.isDir)) {
    const e = new Error("Failed to flush to storage");
    e.errorOnFsync = errorOnFsync;
    e.errorOnClose = errorOnClose;
    throw e;
  }
};
const writeFileLinesAsync = (filename, lines, mode = DEFAULT_FILE_MODE$1) => new Promise((resolve2, reject) => {
  try {
    const stream2 = writeFileStream(filename, { mode });
    const readable = Readable.from(lines);
    readable.on("data", (line) => {
      try {
        stream2.write(line + "\n");
      } catch (err) {
        reject(err);
      }
    });
    readable.on("end", () => {
      stream2.close((err) => {
        if (err) reject(err);
        else resolve2();
      });
    });
    readable.on("error", (err) => {
      reject(err);
    });
    stream2.on("error", (err) => {
      reject(err);
    });
  } catch (err) {
    reject(err);
  }
});
const crashSafeWriteFileLinesAsync = async (filename, lines, modes = { fileMode: DEFAULT_FILE_MODE$1, dirMode: DEFAULT_DIR_MODE$1 }) => {
  const tempFilename = filename + "~";
  await flushToStorageAsync({ filename: path.dirname(filename), isDir: true, mode: modes.dirMode });
  const exists = await existsAsync(filename);
  if (exists) await flushToStorageAsync({ filename, mode: modes.fileMode });
  await writeFileLinesAsync(tempFilename, lines, modes.fileMode);
  await flushToStorageAsync({ filename: tempFilename, mode: modes.fileMode });
  await renameAsync(tempFilename, filename);
  await flushToStorageAsync({ filename: path.dirname(filename), isDir: true, mode: modes.dirMode });
};
const ensureDatafileIntegrityAsync = async (filename, mode = DEFAULT_FILE_MODE$1) => {
  const tempFilename = filename + "~";
  const filenameExists = await existsAsync(filename);
  if (filenameExists) return;
  const oldFilenameExists = await existsAsync(tempFilename);
  if (!oldFilenameExists) await writeFileAsync(filename, "", { encoding: "utf8", mode });
  else await renameAsync(tempFilename, filename);
};
const ensureParentDirectoryExistsAsync = async (filename, mode) => {
  const dir = path.dirname(filename);
  const parsedDir = path.parse(path.resolve(dir));
  if (process.platform !== "win32" || parsedDir.dir !== parsedDir.root || parsedDir.base !== "") {
    await mkdirAsync(dir, { recursive: true, mode });
  }
};
storage$1.existsAsync = existsAsync;
storage$1.renameAsync = renameAsync;
storage$1.writeFileAsync = writeFileAsync;
storage$1.writeFileLinesAsync = writeFileLinesAsync;
storage$1.crashSafeWriteFileLinesAsync = crashSafeWriteFileLinesAsync;
storage$1.appendFileAsync = appendFileAsync;
storage$1.readFileAsync = readFileAsync;
storage$1.unlinkAsync = unlinkAsync;
storage$1.mkdirAsync = mkdirAsync;
storage$1.readFileStream = readFileStream;
storage$1.flushToStorageAsync = flushToStorageAsync;
storage$1.ensureDatafileIntegrityAsync = ensureDatafileIntegrityAsync;
storage$1.ensureFileDoesntExistAsync = ensureFileDoesntExistAsync;
storage$1.ensureParentDirectoryExistsAsync = ensureParentDirectoryExistsAsync;
const { deprecate: deprecate$1 } = require$$1$1;
const byline = byline$1;
const Index$1 = indexes;
const model$1 = model$4;
const storage = storage$1;
const Waterfall2 = waterfall;
const DEFAULT_DIR_MODE = 493;
const DEFAULT_FILE_MODE = 420;
let Persistence$1 = class Persistence {
  /**
   * Create a new Persistence object for database options.db
   * @param {Datastore} options.db
   * @param {Number} [options.corruptAlertThreshold] Optional, threshold after which an alert is thrown if too much data is corrupt
   * @param {serializationHook} [options.beforeDeserialization] Hook you can use to transform data after it was serialized and before it is written to disk.
   * @param {serializationHook} [options.afterSerialization] Inverse of `afterSerialization`.
   * @param {object} [options.modes] Modes to use for FS permissions. Will not work on Windows.
   * @param {number} [options.modes.fileMode=0o644] Mode to use for files.
   * @param {number} [options.modes.dirMode=0o755] Mode to use for directories.
   */
  constructor(options) {
    this.db = options.db;
    this.inMemoryOnly = this.db.inMemoryOnly;
    this.filename = this.db.filename;
    this.corruptAlertThreshold = options.corruptAlertThreshold !== void 0 ? options.corruptAlertThreshold : 0.1;
    this.modes = options.modes !== void 0 ? options.modes : {
      fileMode: DEFAULT_FILE_MODE,
      dirMode: DEFAULT_DIR_MODE
    };
    if (this.modes.fileMode === void 0) this.modes.fileMode = DEFAULT_FILE_MODE;
    if (this.modes.dirMode === void 0) this.modes.dirMode = DEFAULT_DIR_MODE;
    if (!this.inMemoryOnly && this.filename && this.filename.charAt(this.filename.length - 1) === "~") throw new Error("The datafile name can't end with a ~, which is reserved for crash safe backup files");
    if (options.afterSerialization && !options.beforeDeserialization) throw new Error("Serialization hook defined but deserialization hook undefined, cautiously refusing to start NeDB to prevent dataloss");
    if (!options.afterSerialization && options.beforeDeserialization) throw new Error("Serialization hook undefined but deserialization hook defined, cautiously refusing to start NeDB to prevent dataloss");
    this.afterSerialization = async (s) => (options.afterSerialization || ((x2) => x2))(s);
    this.beforeDeserialization = async (s) => (options.beforeDeserialization || ((x2) => x2))(s);
  }
  /**
   * Internal version without using the {@link Datastore#executor} of {@link Datastore#compactDatafileAsync}, use it instead.
   * @return {Promise<void>}
   * @private
   */
  async persistCachedDatabaseAsync() {
    const lines = [];
    if (this.inMemoryOnly) return;
    for (const doc of this.db.getAllData()) {
      lines.push(await this.afterSerialization(model$1.serialize(doc)));
    }
    for (const fieldName of Object.keys(this.db.indexes)) {
      if (fieldName !== "_id") {
        lines.push(await this.afterSerialization(model$1.serialize({
          $$indexCreated: {
            fieldName: this.db.indexes[fieldName].fieldName,
            unique: this.db.indexes[fieldName].unique,
            sparse: this.db.indexes[fieldName].sparse
          }
        })));
      }
    }
    await storage.crashSafeWriteFileLinesAsync(this.filename, lines, this.modes);
    this.db.emit("compaction.done");
  }
  /**
   * @see Datastore#compactDatafile
   * @deprecated
   * @param {NoParamCallback} [callback = () => {}]
   * @see Persistence#compactDatafileAsync
   */
  compactDatafile(callback) {
    deprecate$1((_callback) => this.db.compactDatafile(_callback), "@seald-io/nedb: calling Datastore#persistence#compactDatafile is deprecated, please use Datastore#compactDatafile, it will be removed in the next major version.")(callback);
  }
  /**
   * @see Datastore#setAutocompactionInterval
   * @deprecated
   */
  setAutocompactionInterval(interval) {
    deprecate$1((_interval) => this.db.setAutocompactionInterval(_interval), "@seald-io/nedb: calling Datastore#persistence#setAutocompactionInterval is deprecated, please use Datastore#setAutocompactionInterval, it will be removed in the next major version.")(interval);
  }
  /**
   * @see Datastore#stopAutocompaction
   * @deprecated
   */
  stopAutocompaction() {
    deprecate$1(() => this.db.stopAutocompaction(), "@seald-io/nedb: calling Datastore#persistence#stopAutocompaction is deprecated, please use Datastore#stopAutocompaction, it will be removed in the next major version.")();
  }
  /**
   * Persist new state for the given newDocs (can be insertion, update or removal)
   * Use an append-only format
   *
   * Do not use directly, it should only used by a {@link Datastore} instance.
   * @param {document[]} newDocs Can be empty if no doc was updated/removed
   * @return {Promise}
   * @private
   */
  async persistNewStateAsync(newDocs) {
    let toPersist = "";
    if (this.inMemoryOnly) return;
    for (const doc of newDocs) {
      toPersist += await this.afterSerialization(model$1.serialize(doc)) + "\n";
    }
    if (toPersist.length === 0) return;
    await storage.appendFileAsync(this.filename, toPersist, { encoding: "utf8", mode: this.modes.fileMode });
  }
  /**
   * @typedef rawIndex
   * @property {string} fieldName
   * @property {boolean} [unique]
   * @property {boolean} [sparse]
   */
  /**
   * From a database's raw data, return the corresponding machine understandable collection.
   *
   * Do not use directly, it should only used by a {@link Datastore} instance.
   * @param {string} rawData database file
   * @return {{data: document[], indexes: Object.<string, rawIndex>}}
   * @private
   */
  async treatRawData(rawData) {
    const data = rawData.split("\n").filter((datum) => datum !== "").map(async (datum) => model$1.deserialize(await this.beforeDeserialization(datum)));
    const dataById = {};
    const indexes2 = {};
    const dataLength = data.length;
    let corruptItems = 0;
    for (const docToAwait of data) {
      try {
        const doc = await docToAwait;
        if (doc._id) {
          if (doc.$$deleted === true) delete dataById[doc._id];
          else dataById[doc._id] = doc;
        } else if (doc.$$indexCreated && doc.$$indexCreated.fieldName != null) indexes2[doc.$$indexCreated.fieldName] = doc.$$indexCreated;
        else if (typeof doc.$$indexRemoved === "string") delete indexes2[doc.$$indexRemoved];
      } catch (e) {
        corruptItems += 1;
      }
    }
    if (dataLength > 0) {
      const corruptionRate = corruptItems / dataLength;
      if (corruptionRate > this.corruptAlertThreshold) {
        const error2 = new Error(`${Math.floor(100 * corruptionRate)}% of the data file is corrupt, more than given corruptAlertThreshold (${Math.floor(100 * this.corruptAlertThreshold)}%). Cautiously refusing to start NeDB to prevent dataloss.`);
        error2.corruptionRate = corruptionRate;
        error2.corruptItems = corruptItems;
        error2.dataLength = dataLength;
        throw error2;
      }
    }
    const tdata = Object.values(dataById);
    return { data: tdata, indexes: indexes2 };
  }
  /**
   * From a database's raw data stream, return the corresponding machine understandable collection
   * Is only used by a {@link Datastore} instance.
   *
   * Is only used in the Node.js version, since [React-Native]{@link module:storageReactNative} &
   * [browser]{@link module:storageBrowser} storage modules don't provide an equivalent of
   * {@link module:storage.readFileStream}.
   *
   * Do not use directly, it should only used by a {@link Datastore} instance.
   * @param {Readable} rawStream
   * @return {Promise<{data: document[], indexes: Object.<string, rawIndex>}>}
   * @async
   * @private
   */
  treatRawStreamAsync(rawStream) {
    return new Promise((resolve2, reject) => {
      const dataById = {};
      const indexes2 = {};
      let corruptItems = 0;
      const lineStream = byline(rawStream);
      let dataLength = 0;
      const waterfall2 = new Waterfall2();
      lineStream.on("data", (line) => {
        const deserializedPromise = this.beforeDeserialization(line);
        return waterfall2.waterfall(async () => {
          if (line === "") return;
          try {
            const doc = model$1.deserialize(await deserializedPromise);
            if (doc._id) {
              if (doc.$$deleted === true) delete dataById[doc._id];
              else dataById[doc._id] = doc;
            } else if (doc.$$indexCreated && doc.$$indexCreated.fieldName != null) indexes2[doc.$$indexCreated.fieldName] = doc.$$indexCreated;
            else if (typeof doc.$$indexRemoved === "string") delete indexes2[doc.$$indexRemoved];
          } catch (e) {
            corruptItems += 1;
          }
          dataLength++;
        })();
      });
      lineStream.on("end", async () => {
        await waterfall2.guardian;
        if (dataLength > 0) {
          const corruptionRate = corruptItems / dataLength;
          if (corruptionRate > this.corruptAlertThreshold) {
            const error2 = new Error(`${Math.floor(100 * corruptionRate)}% of the data file is corrupt, more than given corruptAlertThreshold (${Math.floor(100 * this.corruptAlertThreshold)}%). Cautiously refusing to start NeDB to prevent dataloss.`);
            error2.corruptionRate = corruptionRate;
            error2.corruptItems = corruptItems;
            error2.dataLength = dataLength;
            reject(error2, null);
            return;
          }
        }
        const data = Object.values(dataById);
        resolve2({ data, indexes: indexes2 });
      });
      lineStream.on("error", function(err) {
        reject(err, null);
      });
    });
  }
  /**
   * Load the database
   * 1) Create all indexes
   * 2) Insert all data
   * 3) Compact the database
   *
   * This means pulling data out of the data file or creating it if it doesn't exist
   * Also, all data is persisted right away, which has the effect of compacting the database file
   * This operation is very quick at startup for a big collection (60ms for ~10k docs)
   *
   * Do not use directly as it does not use the [Executor]{@link Datastore.executor}, use {@link Datastore#loadDatabaseAsync} instead.
   * @return {Promise<void>}
   * @private
   */
  async loadDatabaseAsync() {
    this.db._resetIndexes();
    if (this.inMemoryOnly) return;
    await Persistence.ensureParentDirectoryExistsAsync(this.filename, this.modes.dirMode);
    await storage.ensureDatafileIntegrityAsync(this.filename, this.modes.fileMode);
    let treatedData;
    if (storage.readFileStream) {
      const fileStream = storage.readFileStream(this.filename, { encoding: "utf8", mode: this.modes.fileMode });
      treatedData = await this.treatRawStreamAsync(fileStream);
    } else {
      const rawData = await storage.readFileAsync(this.filename, { encoding: "utf8", mode: this.modes.fileMode });
      treatedData = await this.treatRawData(rawData);
    }
    Object.keys(treatedData.indexes).forEach((key) => {
      this.db.indexes[key] = new Index$1(treatedData.indexes[key]);
    });
    try {
      this.db._resetIndexes(treatedData.data);
    } catch (e) {
      this.db._resetIndexes();
      throw e;
    }
    await this.db.persistence.persistCachedDatabaseAsync();
    this.db.executor.processBuffer();
  }
  /**
   * See {@link Datastore#dropDatabaseAsync}. This function uses {@link Datastore#executor} internally. Decorating this
   * function with an {@link Executor#pushAsync} will result in a deadlock.
   * @return {Promise<void>}
   * @private
   * @see Datastore#dropDatabaseAsync
   */
  async dropDatabaseAsync() {
    this.db.stopAutocompaction();
    this.db.executor.ready = false;
    this.db.executor.resetBuffer();
    await this.db.executor.queue.guardian;
    this.db.indexes = {};
    this.db.indexes._id = new Index$1({ fieldName: "_id", unique: true });
    this.db.ttlIndexes = {};
    if (!this.db.inMemoryOnly) {
      await this.db.executor.pushAsync(async () => {
        if (await storage.existsAsync(this.filename)) await storage.unlinkAsync(this.filename);
      }, true);
    }
  }
  /**
   * Check if a directory stat and create it on the fly if it is not the case.
   * @param {string} dir
   * @param {number} [mode=0o777]
   * @return {Promise<void>}
   * @private
   */
  static async ensureParentDirectoryExistsAsync(dir, mode = DEFAULT_DIR_MODE) {
    return storage.ensureParentDirectoryExistsAsync(dir, mode);
  }
};
var persistence = Persistence$1;
const { EventEmitter } = require$$0$5;
const { callbackify, deprecate } = require$$1$1;
const Cursor2 = cursor;
const customUtils = customUtils$4;
const Executor2 = executor;
const Index2 = indexes;
const model = model$4;
const Persistence2 = persistence;
const { isDate, pick, filterIndexNames } = utils;
let Datastore$2 = class Datastore extends EventEmitter {
  /**
   * Create a new collection, either persistent or in-memory.
   *
   * If you use a persistent datastore without the `autoload` option, you need to call {@link Datastore#loadDatabase} or
   * {@link Datastore#loadDatabaseAsync} manually. This function fetches the data from datafile and prepares the database.
   * **Don't forget it!** If you use a persistent datastore, no command (insert, find, update, remove) will be executed
   * before it is called, so make sure to call it yourself or use the `autoload` option.
   *
   * Also, if loading fails, all commands registered to the {@link Datastore#executor} afterwards will not be executed.
   * They will be registered and executed, in sequence, only after a successful loading.
   *
   * @param {object|string} options Can be an object or a string. If options is a string, the behavior is the same as in
   * v0.6: it will be interpreted as `options.filename`. **Giving a string is deprecated, and will be removed in the
   * next major version.**
   * @param {string} [options.filename = null] Path to the file where the data is persisted. If left blank, the datastore is
   * automatically considered in-memory only. It cannot end with a `~` which is used in the temporary files NeDB uses to
   * perform crash-safe writes. Not used if `options.inMemoryOnly` is `true`.
   * @param {boolean} [options.inMemoryOnly = false] If set to true, no data will be written in storage. This option has
   * priority over `options.filename`.
   * @param {object} [options.modes] Permissions to use for FS. Only used for Node.js storage module. Will not work on Windows.
   * @param {number} [options.modes.fileMode = 0o644] Permissions to use for database files
   * @param {number} [options.modes.dirMode = 0o755] Permissions to use for database directories
   * @param {boolean} [options.timestampData = false] If set to true, createdAt and updatedAt will be created and
   * populated automatically (if not specified by user)
   * @param {boolean} [options.autoload = false] If used, the database will automatically be loaded from the datafile
   * upon creation (you don't need to call `loadDatabase`). Any command issued before load is finished is buffered and
   * will be executed when load is done. When autoloading is done, you can either use the `onload` callback, or you can
   * use `this.autoloadPromise` which resolves (or rejects) when autloading is done.
   * @param {NoParamCallback} [options.onload] If you use autoloading, this is the handler called after the `loadDatabase`. It
   * takes one `error` argument. If you use autoloading without specifying this handler, and an error happens during
   * load, an error will be thrown.
   * @param {serializationHook} [options.beforeDeserialization] Hook you can use to transform data after it was serialized and
   * before it is written to disk. Can be used for example to encrypt data before writing database to disk. This
   * function takes a string as parameter (one line of an NeDB data file) and outputs the transformed string, **which
   * must absolutely not contain a `\n` character** (or data will be lost).
   * @param {serializationHook} [options.afterSerialization] Inverse of `afterSerialization`. Make sure to include both and not
   * just one, or you risk data loss. For the same reason, make sure both functions are inverses of one another. Some
   * failsafe mechanisms are in place to prevent data loss if you misuse the serialization hooks: NeDB checks that never
   * one is declared without the other, and checks that they are reverse of one another by testing on random strings of
   * various lengths. In addition, if too much data is detected as corrupt, NeDB will refuse to start as it could mean
   * you're not using the deserialization hook corresponding to the serialization hook used before.
   * @param {number} [options.corruptAlertThreshold = 0.1] Between 0 and 1, defaults to 10%. NeDB will refuse to start
   * if more than this percentage of the datafile is corrupt. 0 means you don't tolerate any corruption, 1 means you
   * don't care.
   * @param {compareStrings} [options.compareStrings] If specified, it overrides default string comparison which is not
   * well adapted to non-US characters in particular accented letters. Native `localCompare` will most of the time be
   * the right choice.
   * @param {boolean} [options.testSerializationHooks=true] Whether to test the serialization hooks or not,
   * might be CPU-intensive
   */
  constructor(options) {
    super();
    let filename;
    if (typeof options === "string") {
      deprecate(() => {
        filename = options;
        this.inMemoryOnly = false;
      }, "@seald-io/nedb: Giving a string to the Datastore constructor is deprecated and will be removed in the next major version. Please use an options object with an argument 'filename'.")();
    } else {
      options = options || {};
      filename = options.filename;
      this.inMemoryOnly = options.inMemoryOnly || false;
      this.autoload = options.autoload || false;
      this.timestampData = options.timestampData || false;
    }
    if (!filename || typeof filename !== "string" || filename.length === 0) {
      this.filename = null;
      this.inMemoryOnly = true;
    } else {
      this.filename = filename;
    }
    this.compareStrings = options.compareStrings;
    this.persistence = new Persistence2({
      db: this,
      afterSerialization: options.afterSerialization,
      beforeDeserialization: options.beforeDeserialization,
      corruptAlertThreshold: options.corruptAlertThreshold,
      modes: options.modes,
      testSerializationHooks: options.testSerializationHooks
    });
    this.executor = new Executor2();
    if (this.inMemoryOnly) this.executor.ready = true;
    this.indexes = {};
    this.indexes._id = new Index2({ fieldName: "_id", unique: true });
    this.ttlIndexes = {};
    if (this.autoload) {
      this.autoloadPromise = this.loadDatabaseAsync();
      this.autoloadPromise.then(() => {
        if (options.onload) options.onload();
      }, (err) => {
        if (options.onload) options.onload(err);
        else throw err;
      });
    } else this.autoloadPromise = null;
    this._autocompactionIntervalId = null;
  }
  /**
   * Queue a compaction/rewrite of the datafile.
   * It works by rewriting the database file, and compacts it since the cache always contains only the number of
   * documents in the collection while the data file is append-only so it may grow larger.
   *
   * @async
   */
  compactDatafileAsync() {
    return this.executor.pushAsync(() => this.persistence.persistCachedDatabaseAsync());
  }
  /**
   * Callback version of {@link Datastore#compactDatafileAsync}.
   * @param {NoParamCallback} [callback = () => {}]
   * @see Datastore#compactDatafileAsync
   */
  compactDatafile(callback) {
    const promise = this.compactDatafileAsync();
    if (typeof callback === "function") callbackify(() => promise)(callback);
  }
  /**
   * Set automatic compaction every `interval` ms
   * @param {Number} interval in milliseconds, with an enforced minimum of 5000 milliseconds
   */
  setAutocompactionInterval(interval) {
    const minInterval = 5e3;
    if (Number.isNaN(Number(interval))) throw new Error("Interval must be a non-NaN number");
    const realInterval = Math.max(Number(interval), minInterval);
    this.stopAutocompaction();
    this._autocompactionIntervalId = setInterval(() => {
      this.compactDatafile();
    }, realInterval);
  }
  /**
   * Stop autocompaction (do nothing if automatic compaction was not running)
   */
  stopAutocompaction() {
    if (this._autocompactionIntervalId) {
      clearInterval(this._autocompactionIntervalId);
      this._autocompactionIntervalId = null;
    }
  }
  /**
   * Callback version of {@link Datastore#loadDatabaseAsync}.
   * @param {NoParamCallback} [callback]
   * @see Datastore#loadDatabaseAsync
   */
  loadDatabase(callback) {
    const promise = this.loadDatabaseAsync();
    if (typeof callback === "function") callbackify(() => promise)(callback);
  }
  /**
   * Stops auto-compaction, finishes all queued operations, drops the database both in memory and in storage.
   * **WARNING**: it is not recommended re-using an instance of NeDB if its database has been dropped, it is
   * preferable to instantiate a new one.
   * @async
   * @return {Promise}
   */
  dropDatabaseAsync() {
    return this.persistence.dropDatabaseAsync();
  }
  /**
   * Callback version of {@link Datastore#dropDatabaseAsync}.
   * @param {NoParamCallback} [callback]
   * @see Datastore#dropDatabaseAsync
   */
  dropDatabase(callback) {
    const promise = this.dropDatabaseAsync();
    if (typeof callback === "function") callbackify(() => promise)(callback);
  }
  /**
   * Load the database from the datafile, and trigger the execution of buffered commands if any.
   * @async
   * @return {Promise}
   */
  loadDatabaseAsync() {
    return this.executor.pushAsync(() => this.persistence.loadDatabaseAsync(), true);
  }
  /**
   * Get an array of all the data in the database.
   * @return {document[]}
   */
  getAllData() {
    return this.indexes._id.getAll();
  }
  /**
   * Reset all currently defined indexes.
   * @param {?document|?document[]} [newData]
   * @private
   */
  _resetIndexes(newData) {
    for (const index of Object.values(this.indexes)) {
      index.reset(newData);
    }
  }
  /**
   * Callback version of {@link Datastore#ensureIndex}.
   * @param {object} options
   * @param {string|string[]} options.fieldName
   * @param {boolean} [options.unique = false]
   * @param {boolean} [options.sparse = false]
   * @param {number} [options.expireAfterSeconds]
   * @param {NoParamCallback} [callback]
   * @see Datastore#ensureIndex
   */
  ensureIndex(options = {}, callback) {
    const promise = this.ensureIndexAsync(options);
    if (typeof callback === "function") callbackify(() => promise)(callback);
  }
  /**
   * Ensure an index is kept for this field. Same parameters as lib/indexes
   * This function acts synchronously on the indexes, however the persistence of the indexes is deferred with the
   * executor.
   * @param {object} options
   * @param {string|string[]} options.fieldName Name of the field to index. Use the dot notation to index a field in a nested
   * document. For a compound index, use an array of field names. Using a comma in a field name is not permitted.
   * @param {boolean} [options.unique = false] Enforce field uniqueness. Note that a unique index will raise an error
   * if you try to index two documents for which the field is not defined.
   * @param {boolean} [options.sparse = false] Don't index documents for which the field is not defined. Use this option
   * along with "unique" if you want to accept multiple documents for which it is not defined.
   * @param {number} [options.expireAfterSeconds] - If set, the created index is a TTL (time to live) index, that will
   * automatically remove documents when the system date becomes larger than the date on the indexed field plus
   * `expireAfterSeconds`. Documents where the indexed field is not specified or not a `Date` object are ignored.
   * @return {Promise<void>}
   */
  async ensureIndexAsync(options = {}) {
    if (!options.fieldName) {
      const err = new Error("Cannot create an index without a fieldName");
      err.missingFieldName = true;
      throw err;
    }
    const _fields = [].concat(options.fieldName).sort();
    if (_fields.some((field) => field.includes(","))) {
      throw new Error("Cannot use comma in index fieldName");
    }
    const _options2 = {
      ...options,
      fieldName: _fields.join(",")
    };
    if (this.indexes[_options2.fieldName]) return;
    this.indexes[_options2.fieldName] = new Index2(_options2);
    if (options.expireAfterSeconds !== void 0) this.ttlIndexes[_options2.fieldName] = _options2.expireAfterSeconds;
    try {
      this.indexes[_options2.fieldName].insert(this.getAllData());
    } catch (e) {
      delete this.indexes[_options2.fieldName];
      throw e;
    }
    await this.executor.pushAsync(() => this.persistence.persistNewStateAsync([{ $$indexCreated: _options2 }]), true);
  }
  /**
   * Callback version of {@link Datastore#removeIndexAsync}.
   * @param {string} fieldName
   * @param {NoParamCallback} [callback]
   * @see Datastore#removeIndexAsync
   */
  removeIndex(fieldName, callback = () => {
  }) {
    const promise = this.removeIndexAsync(fieldName);
    callbackify(() => promise)(callback);
  }
  /**
   * Remove an index.
   * @param {string} fieldName Field name of the index to remove. Use the dot notation to remove an index referring to a
   * field in a nested document.
   * @return {Promise<void>}
   * @see Datastore#removeIndex
   */
  async removeIndexAsync(fieldName) {
    delete this.indexes[fieldName];
    await this.executor.pushAsync(() => this.persistence.persistNewStateAsync([{ $$indexRemoved: fieldName }]), true);
  }
  /**
   * Add one or several document(s) to all indexes.
   *
   * This is an internal function.
   * @param {document} doc
   * @private
   */
  _addToIndexes(doc) {
    let failingIndex;
    let error2;
    const keys2 = Object.keys(this.indexes);
    for (let i = 0; i < keys2.length; i += 1) {
      try {
        this.indexes[keys2[i]].insert(doc);
      } catch (e) {
        failingIndex = i;
        error2 = e;
        break;
      }
    }
    if (error2) {
      for (let i = 0; i < failingIndex; i += 1) {
        this.indexes[keys2[i]].remove(doc);
      }
      throw error2;
    }
  }
  /**
   * Remove one or several document(s) from all indexes.
   *
   * This is an internal function.
   * @param {document} doc
   * @private
   */
  _removeFromIndexes(doc) {
    for (const index of Object.values(this.indexes)) {
      index.remove(doc);
    }
  }
  /**
   * Update one or several documents in all indexes.
   *
   * To update multiple documents, oldDoc must be an array of { oldDoc, newDoc } pairs.
   *
   * If one update violates a constraint, all changes are rolled back.
   *
   * This is an internal function.
   * @param {document|Array.<{oldDoc: document, newDoc: document}>} oldDoc Document to update, or an `Array` of
   * `{oldDoc, newDoc}` pairs.
   * @param {document} [newDoc] Document to replace the oldDoc with. If the first argument is an `Array` of
   * `{oldDoc, newDoc}` pairs, this second argument is ignored.
   * @private
   */
  _updateIndexes(oldDoc, newDoc) {
    let failingIndex;
    let error2;
    const keys2 = Object.keys(this.indexes);
    for (let i = 0; i < keys2.length; i += 1) {
      try {
        this.indexes[keys2[i]].update(oldDoc, newDoc);
      } catch (e) {
        failingIndex = i;
        error2 = e;
        break;
      }
    }
    if (error2) {
      for (let i = 0; i < failingIndex; i += 1) {
        this.indexes[keys2[i]].revertUpdate(oldDoc, newDoc);
      }
      throw error2;
    }
  }
  /**
   * Get all candidate documents matching the query, regardless of their expiry status.
   * @param {query} query
   * @return {document[]}
   *
   * @private
   */
  _getRawCandidates(query) {
    const indexNames = Object.keys(this.indexes);
    let usableQuery;
    usableQuery = Object.entries(query).filter(filterIndexNames(indexNames)).pop();
    if (usableQuery) return this.indexes[usableQuery[0]].getMatching(usableQuery[1]);
    const compoundQueryKeys = indexNames.filter((indexName) => indexName.indexOf(",") !== -1).map((indexName) => indexName.split(",")).filter(
      (subIndexNames) => Object.entries(query).filter(filterIndexNames(subIndexNames)).length === subIndexNames.length
    );
    if (compoundQueryKeys.length > 0) return this.indexes[compoundQueryKeys[0]].getMatching(pick(query, compoundQueryKeys[0]));
    usableQuery = Object.entries(query).filter(
      ([k, v]) => !!(query[k] && Object.prototype.hasOwnProperty.call(query[k], "$in")) && indexNames.includes(k)
    ).pop();
    if (usableQuery) return this.indexes[usableQuery[0]].getMatching(usableQuery[1].$in);
    usableQuery = Object.entries(query).filter(
      ([k, v]) => !!(query[k] && (Object.prototype.hasOwnProperty.call(query[k], "$lt") || Object.prototype.hasOwnProperty.call(query[k], "$lte") || Object.prototype.hasOwnProperty.call(query[k], "$gt") || Object.prototype.hasOwnProperty.call(query[k], "$gte"))) && indexNames.includes(k)
    ).pop();
    if (usableQuery) return this.indexes[usableQuery[0]].getBetweenBounds(usableQuery[1]);
    return this.getAllData();
  }
  /**
   * Return the list of candidates for a given query
   * Crude implementation for now, we return the candidates given by the first usable index if any
   * We try the following query types, in this order: basic match, $in match, comparison match
   * One way to make it better would be to enable the use of multiple indexes if the first usable index
   * returns too much data. I may do it in the future.
   *
   * Returned candidates will be scanned to find and remove all expired documents
   *
   * This is an internal function.
   * @param {query} query
   * @param {boolean} [dontExpireStaleDocs = false] If true don't remove stale docs. Useful for the remove function
   * which shouldn't be impacted by expirations.
   * @return {Promise<document[]>} candidates
   * @private
   */
  async _getCandidatesAsync(query, dontExpireStaleDocs = false) {
    const validDocs = [];
    const docs = this._getRawCandidates(query);
    if (!dontExpireStaleDocs) {
      const expiredDocsIds = [];
      const ttlIndexesFieldNames = Object.keys(this.ttlIndexes);
      docs.forEach((doc) => {
        if (ttlIndexesFieldNames.every((i) => !(doc[i] !== void 0 && isDate(doc[i]) && Date.now() > doc[i].getTime() + this.ttlIndexes[i] * 1e3))) validDocs.push(doc);
        else expiredDocsIds.push(doc._id);
      });
      for (const _id of expiredDocsIds) {
        await this._removeAsync({ _id }, {});
      }
    } else validDocs.push(...docs);
    return validDocs;
  }
  /**
   * Insert a new document
   * This is an internal function, use {@link Datastore#insertAsync} which has the same signature.
   * @param {document|document[]} newDoc
   * @return {Promise<document|document[]>}
   * @private
   */
  async _insertAsync(newDoc) {
    const preparedDoc = this._prepareDocumentForInsertion(newDoc);
    this._insertInCache(preparedDoc);
    await this.persistence.persistNewStateAsync(Array.isArray(preparedDoc) ? preparedDoc : [preparedDoc]);
    return model.deepCopy(preparedDoc);
  }
  /**
   * Create a new _id that's not already in use
   * @return {string} id
   * @private
   */
  _createNewId() {
    let attemptId = customUtils.uid(16);
    if (this.indexes._id.getMatching(attemptId).length > 0) attemptId = this._createNewId();
    return attemptId;
  }
  /**
   * Prepare a document (or array of documents) to be inserted in a database
   * Meaning adds _id and timestamps if necessary on a copy of newDoc to avoid any side effect on user input
   * @param {document|document[]} newDoc document, or Array of documents, to prepare
   * @return {document|document[]} prepared document, or Array of prepared documents
   * @private
   */
  _prepareDocumentForInsertion(newDoc) {
    let preparedDoc;
    if (Array.isArray(newDoc)) {
      preparedDoc = [];
      newDoc.forEach((doc) => {
        preparedDoc.push(this._prepareDocumentForInsertion(doc));
      });
    } else {
      preparedDoc = model.deepCopy(newDoc);
      if (preparedDoc._id === void 0) preparedDoc._id = this._createNewId();
      const now = /* @__PURE__ */ new Date();
      if (this.timestampData && preparedDoc.createdAt === void 0) preparedDoc.createdAt = now;
      if (this.timestampData && preparedDoc.updatedAt === void 0) preparedDoc.updatedAt = now;
      model.checkObject(preparedDoc);
    }
    return preparedDoc;
  }
  /**
   * If newDoc is an array of documents, this will insert all documents in the cache
   * @param {document|document[]} preparedDoc
   * @private
   */
  _insertInCache(preparedDoc) {
    if (Array.isArray(preparedDoc)) this._insertMultipleDocsInCache(preparedDoc);
    else this._addToIndexes(preparedDoc);
  }
  /**
   * If one insertion fails (e.g. because of a unique constraint), roll back all previous
   * inserts and throws the error
   * @param {document[]} preparedDocs
   * @private
   */
  _insertMultipleDocsInCache(preparedDocs) {
    let failingIndex;
    let error2;
    for (let i = 0; i < preparedDocs.length; i += 1) {
      try {
        this._addToIndexes(preparedDocs[i]);
      } catch (e) {
        error2 = e;
        failingIndex = i;
        break;
      }
    }
    if (error2) {
      for (let i = 0; i < failingIndex; i += 1) {
        this._removeFromIndexes(preparedDocs[i]);
      }
      throw error2;
    }
  }
  /**
   * Callback version of {@link Datastore#insertAsync}.
   * @param {document|document[]} newDoc
   * @param {SingleDocumentCallback|MultipleDocumentsCallback} [callback]
   * @see Datastore#insertAsync
   */
  insert(newDoc, callback) {
    const promise = this.insertAsync(newDoc);
    if (typeof callback === "function") callbackify(() => promise)(callback);
  }
  /**
   * Insert a new document, or new documents.
   * @param {document|document[]} newDoc Document or array of documents to insert.
   * @return {Promise<document|document[]>} The document(s) inserted.
   * @async
   */
  insertAsync(newDoc) {
    return this.executor.pushAsync(() => this._insertAsync(newDoc));
  }
  /**
   * Callback for {@link Datastore#countCallback}.
   * @callback Datastore~countCallback
   * @param {?Error} err
   * @param {?number} count
   */
  /**
   * Callback-version of {@link Datastore#countAsync}.
   * @param {query} query
   * @param {Datastore~countCallback} [callback]
   * @return {Cursor<number>|undefined}
   * @see Datastore#countAsync
   */
  count(query, callback) {
    const cursor2 = this.countAsync(query);
    if (typeof callback === "function") callbackify(cursor2.execAsync.bind(cursor2))(callback);
    else return cursor2;
  }
  /**
   * Count all documents matching the query.
   * @param {query} query MongoDB-style query
   * @return {Cursor<number>} count
   * @async
   */
  countAsync(query) {
    return new Cursor2(this, query, (docs) => docs.length);
  }
  /**
   * Callback version of {@link Datastore#findAsync}.
   * @param {query} query
   * @param {projection|MultipleDocumentsCallback} [projection = {}]
   * @param {MultipleDocumentsCallback} [callback]
   * @return {Cursor<document[]>|undefined}
   * @see Datastore#findAsync
   */
  find(query, projection, callback) {
    if (arguments.length === 1) {
      projection = {};
    } else if (arguments.length === 2) {
      if (typeof projection === "function") {
        callback = projection;
        projection = {};
      }
    }
    const cursor2 = this.findAsync(query, projection);
    if (typeof callback === "function") callbackify(cursor2.execAsync.bind(cursor2))(callback);
    else return cursor2;
  }
  /**
   * Find all documents matching the query.
   * We return the {@link Cursor} that the user can either `await` directly or use to can {@link Cursor#limit} or
   * {@link Cursor#skip} before.
   * @param {query} query MongoDB-style query
   * @param {projection} [projection = {}] MongoDB-style projection
   * @return {Cursor<document[]>}
   * @async
   */
  findAsync(query, projection = {}) {
    const cursor2 = new Cursor2(this, query, (docs) => docs.map((doc) => model.deepCopy(doc)));
    cursor2.projection(projection);
    return cursor2;
  }
  /**
   * @callback Datastore~findOneCallback
   * @param {?Error} err
   * @param {document} doc
   */
  /**
   * Callback version of {@link Datastore#findOneAsync}.
   * @param {query} query
   * @param {projection|SingleDocumentCallback} [projection = {}]
   * @param {SingleDocumentCallback} [callback]
   * @return {Cursor<document>|undefined}
   * @see Datastore#findOneAsync
   */
  findOne(query, projection, callback) {
    if (arguments.length === 1) {
      projection = {};
    } else if (arguments.length === 2) {
      if (typeof projection === "function") {
        callback = projection;
        projection = {};
      }
    }
    const cursor2 = this.findOneAsync(query, projection);
    if (typeof callback === "function") callbackify(cursor2.execAsync.bind(cursor2))(callback);
    else return cursor2;
  }
  /**
   * Find one document matching the query.
   * We return the {@link Cursor} that the user can either `await` directly or use to can {@link Cursor#skip} before.
   * @param {query} query MongoDB-style query
   * @param {projection} projection MongoDB-style projection
   * @return {Cursor<document>}
   */
  findOneAsync(query, projection = {}) {
    const cursor2 = new Cursor2(this, query, (docs) => docs.length === 1 ? model.deepCopy(docs[0]) : null);
    cursor2.projection(projection).limit(1);
    return cursor2;
  }
  /**
   * See {@link Datastore#updateAsync} return type for the definition of the callback parameters.
   *
   * **WARNING:** Prior to 3.0.0, `upsert` was either `true` of falsy (but not `false`), it is now always a boolean.
   * `affectedDocuments` could be `undefined` when `returnUpdatedDocs` was `false`, it is now `null` in these cases.
   *
   * **WARNING:** Prior to 1.8.0, the `upsert` argument was not given, it was impossible for the developer to determine
   * during a `{ multi: false, returnUpdatedDocs: true, upsert: true }` update if it inserted a document or just updated
   * it.
   *
   * @callback Datastore~updateCallback
   * @param {?Error} err
   * @param {number} numAffected
   * @param {?document[]|?document} affectedDocuments
   * @param {boolean} upsert
   * @see {Datastore#updateAsync}
   */
  /**
   * Version without the using {@link Datastore~executor} of {@link Datastore#updateAsync}, use it instead.
   *
   * @param {query} query
   * @param {document|update} update
   * @param {Object} options
   * @param {boolean} [options.multi = false]
   * @param {boolean} [options.upsert = false]
   * @param {boolean} [options.returnUpdatedDocs = false]
   * @return {Promise<{numAffected: number, affectedDocuments: document[]|document|null, upsert: boolean}>}
   * @private
   * @see Datastore#updateAsync
   */
  async _updateAsync(query, update, options) {
    const multi = options.multi !== void 0 ? options.multi : false;
    const upsert = options.upsert !== void 0 ? options.upsert : false;
    if (upsert) {
      const cursor2 = new Cursor2(this, query);
      const docs = await cursor2.limit(1)._execAsync();
      if (docs.length !== 1) {
        let toBeInserted;
        try {
          model.checkObject(update);
          toBeInserted = update;
        } catch (e) {
          toBeInserted = model.modify(model.deepCopy(query, true), update);
        }
        const newDoc = await this._insertAsync(toBeInserted);
        return { numAffected: 1, affectedDocuments: newDoc, upsert: true };
      }
    }
    let numReplaced = 0;
    let modifiedDoc;
    const modifications = [];
    let createdAt;
    const candidates = await this._getCandidatesAsync(query);
    for (const candidate of candidates) {
      if (model.match(candidate, query) && (multi || numReplaced === 0)) {
        numReplaced += 1;
        if (this.timestampData) {
          createdAt = candidate.createdAt;
        }
        modifiedDoc = model.modify(candidate, update);
        if (this.timestampData) {
          modifiedDoc.createdAt = createdAt;
          modifiedDoc.updatedAt = /* @__PURE__ */ new Date();
        }
        modifications.push({ oldDoc: candidate, newDoc: modifiedDoc });
      }
    }
    this._updateIndexes(modifications);
    const updatedDocs = modifications.map((x2) => x2.newDoc);
    await this.persistence.persistNewStateAsync(updatedDocs);
    if (!options.returnUpdatedDocs) return { numAffected: numReplaced, upsert: false, affectedDocuments: null };
    else {
      let updatedDocsDC = [];
      updatedDocs.forEach((doc) => {
        updatedDocsDC.push(model.deepCopy(doc));
      });
      if (!multi) updatedDocsDC = updatedDocsDC[0];
      return { numAffected: numReplaced, affectedDocuments: updatedDocsDC, upsert: false };
    }
  }
  /**
   * Callback version of {@link Datastore#updateAsync}.
   * @param {query} query
   * @param {document|*} update
   * @param {Object|Datastore~updateCallback} [options|]
   * @param {boolean} [options.multi = false]
   * @param {boolean} [options.upsert = false]
   * @param {boolean} [options.returnUpdatedDocs = false]
   * @param {Datastore~updateCallback} [callback]
   * @see Datastore#updateAsync
   *
   */
  update(query, update, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const _callback = (err, res = {}) => {
      if (callback) callback(err, res.numAffected, res.affectedDocuments, res.upsert);
    };
    callbackify((query2, update2, options2) => this.updateAsync(query2, update2, options2))(query, update, options, _callback);
  }
  /**
   * Update all docs matching query.
   * @param {query} query is the same kind of finding query you use with `find` and `findOne`.
   * @param {document|*} update specifies how the documents should be modified. It is either a new document or a
   * set of modifiers (you cannot use both together, it doesn't make sense!). Using a new document will replace the
   * matched docs. Using a set of modifiers will create the fields they need to modify if they don't exist, and you can
   * apply them to subdocs. Available field modifiers are `$set` to change a field's value, `$unset` to delete a field,
   * `$inc` to increment a field's value and `$min`/`$max` to change field's value, only if provided value is
   * less/greater than current value. To work on arrays, you have `$push`, `$pop`, `$addToSet`, `$pull`, and the special
   * `$each` and `$slice`.
   * @param {Object} [options = {}] Optional options
   * @param {boolean} [options.multi = false] If true, can update multiple documents
   * @param {boolean} [options.upsert = false] If true, can insert a new document corresponding to the `update` rules if
   * your `query` doesn't match anything. If your `update` is a simple object with no modifiers, it is the inserted
   * document. In the other case, the `query` is stripped from all operator recursively, and the `update` is applied to
   * it.
   * @param {boolean} [options.returnUpdatedDocs = false] (not Mongo-DB compatible) If true and update is not an upsert,
   * will return the array of documents matched by the find query and updated. Updated documents will be returned even
   * if the update did not actually modify them.
   * @return {Promise<{numAffected: number, affectedDocuments: document[]|document|null, upsert: boolean}>}
   * - `upsert` is `true` if and only if the update did insert a document, **cannot be true if `options.upsert !== true`**.
   * - `numAffected` is the number of documents affected by the update or insertion (if `options.multi` is `false` or `options.upsert` is `true`, cannot exceed `1`);
   * - `affectedDocuments` can be one of the following:
   *    - If `upsert` is `true`, the inserted document;
   *    - If `options.returnUpdatedDocs` is `false`, `null`;
   *    - If `options.returnUpdatedDocs` is `true`:
   *      - If `options.multi` is `false`, the updated document;
   *      - If `options.multi` is `true`, the array of updated documents.
   * @async
   */
  updateAsync(query, update, options = {}) {
    return this.executor.pushAsync(() => this._updateAsync(query, update, options));
  }
  /**
   * @callback Datastore~removeCallback
   * @param {?Error} err
   * @param {?number} numRemoved
   */
  /**
   * Internal version without using the {@link Datastore#executor} of {@link Datastore#removeAsync}, use it instead.
   *
   * @param {query} query
   * @param {object} [options]
   * @param {boolean} [options.multi = false]
   * @return {Promise<number>}
   * @private
   * @see Datastore#removeAsync
   */
  async _removeAsync(query, options = {}) {
    const multi = options.multi !== void 0 ? options.multi : false;
    const candidates = await this._getCandidatesAsync(query, true);
    const removedDocs = [];
    let numRemoved = 0;
    candidates.forEach((d) => {
      if (model.match(d, query) && (multi || numRemoved === 0)) {
        numRemoved += 1;
        removedDocs.push({ $$deleted: true, _id: d._id });
        this._removeFromIndexes(d);
      }
    });
    await this.persistence.persistNewStateAsync(removedDocs);
    return numRemoved;
  }
  /**
   * Callback version of {@link Datastore#removeAsync}.
   * @param {query} query
   * @param {object|Datastore~removeCallback} [options={}]
   * @param {boolean} [options.multi = false]
   * @param {Datastore~removeCallback} [cb = () => {}]
   * @see Datastore#removeAsync
   */
  remove(query, options, cb) {
    if (typeof options === "function") {
      cb = options;
      options = {};
    }
    const callback = cb || (() => {
    });
    callbackify((query2, options2) => this.removeAsync(query2, options2))(query, options, callback);
  }
  /**
   * Remove all docs matching the query.
   * @param {query} query MongoDB-style query
   * @param {object} [options={}] Optional options
   * @param {boolean} [options.multi = false] If true, can update multiple documents
   * @return {Promise<number>} How many documents were removed
   * @async
   */
  removeAsync(query, options = {}) {
    return this.executor.pushAsync(() => this._removeAsync(query, options));
  }
};
var datastore = Datastore$2;
const Datastore2 = datastore;
var nedb = Datastore2;
const Datastore$1 = /* @__PURE__ */ getDefaultExportFromCjs(nedb);
var at = Object.defineProperty;
var ct = (t2, e, r) => e in t2 ? at(t2, e, { enumerable: true, configurable: true, writable: true, value: r }) : t2[e] = r;
var x = (t2, e, r) => ct(t2, typeof e != "symbol" ? e + "" : e, r);
function tt(t2, e, r = {}) {
  const n = { type: "Feature" };
  return (r.id === 0 || r.id) && (n.id = r.id), r.bbox && (n.bbox = r.bbox), n.properties = e || {}, n.geometry = t2, n;
}
function W(t2, e, r = {}) {
  if (!t2)
    throw new Error("coordinates is required");
  if (!Array.isArray(t2))
    throw new Error("coordinates must be an Array");
  if (t2.length < 2)
    throw new Error("coordinates must be at least 2 numbers long");
  if (!q(t2[0]) || !q(t2[1]))
    throw new Error("coordinates must contain numbers");
  return tt({
    type: "Point",
    coordinates: t2
  }, e, r);
}
function et(t2, e, r = {}) {
  for (const c of t2) {
    if (c.length < 4)
      throw new Error(
        "Each LinearRing of a Polygon must have 4 or more Positions."
      );
    if (c[c.length - 1].length !== c[0].length)
      throw new Error("First and last Position are not equivalent.");
    for (let i = 0; i < c[c.length - 1].length; i++)
      if (c[c.length - 1][i] !== c[0][i])
        throw new Error("First and last Position are not equivalent.");
  }
  return tt({
    type: "Polygon",
    coordinates: t2
  }, e, r);
}
function F(t2, e = {}) {
  const r = { type: "FeatureCollection" };
  return e.id && (r.id = e.id), e.bbox && (r.bbox = e.bbox), r.features = t2, r;
}
function q(t2) {
  return !isNaN(t2) && t2 !== null && !Array.isArray(t2);
}
function ut(t2) {
  if (!t2)
    throw new Error("coord is required");
  if (!Array.isArray(t2)) {
    if (t2.type === "Feature" && t2.geometry !== null && t2.geometry.type === "Point")
      return [...t2.geometry.coordinates];
    if (t2.type === "Point")
      return [...t2.coordinates];
  }
  if (Array.isArray(t2) && t2.length >= 2 && !Array.isArray(t2[0]) && !Array.isArray(t2[1]))
    return [...t2];
  throw new Error("coord must be GeoJSON Point or an Array of numbers");
}
function z(t2) {
  if (Array.isArray(t2))
    return t2;
  if (t2.type === "Feature") {
    if (t2.geometry !== null)
      return t2.geometry.coordinates;
  } else if (t2.coordinates)
    return t2.coordinates;
  throw new Error(
    "coords must be GeoJSON Feature, Geometry Object or an Array"
  );
}
function ft(t2) {
  return t2.type === "Feature" ? t2.geometry : t2;
}
const R = 11102230246251565e-32, O = 134217729, dt = (3 + 8 * R) * R;
function V(t2, e, r, n, c) {
  let i, f, g, h, l = e[0], y = n[0], o = 0, u2 = 0;
  y > l == y > -l ? (i = l, l = e[++o]) : (i = y, y = n[++u2]);
  let b = 0;
  if (o < t2 && u2 < r)
    for (y > l == y > -l ? (f = l + i, g = i - (f - l), l = e[++o]) : (f = y + i, g = i - (f - y), y = n[++u2]), i = f, g !== 0 && (c[b++] = g); o < t2 && u2 < r; )
      y > l == y > -l ? (f = i + l, h = f - i, g = i - (f - h) + (l - h), l = e[++o]) : (f = i + y, h = f - i, g = i - (f - h) + (y - h), y = n[++u2]), i = f, g !== 0 && (c[b++] = g);
  for (; o < t2; )
    f = i + l, h = f - i, g = i - (f - h) + (l - h), l = e[++o], i = f, g !== 0 && (c[b++] = g);
  for (; u2 < r; )
    f = i + y, h = f - i, g = i - (f - h) + (y - h), y = n[++u2], i = f, g !== 0 && (c[b++] = g);
  return (i !== 0 || b === 0) && (c[b++] = i), b;
}
function ht(t2, e) {
  let r = e[0];
  for (let n = 1; n < t2; n++) r += e[n];
  return r;
}
function Y(t2) {
  return new Float64Array(t2);
}
const gt = (3 + 16 * R) * R, lt = (2 + 12 * R) * R, yt = (9 + 64 * R) * R * R, U = Y(4), G = Y(8), j = Y(12), J = Y(16), S = Y(4);
function bt(t2, e, r, n, c, i, f) {
  let g, h, l, y, o, u2, b, p, d, a, s, m, v, M, _, w, A, P;
  const k = t2 - c, I = r - c, T = e - i, N = n - i;
  M = k * N, u2 = O * k, b = u2 - (u2 - k), p = k - b, u2 = O * N, d = u2 - (u2 - N), a = N - d, _ = p * a - (M - b * d - p * d - b * a), w = T * I, u2 = O * T, b = u2 - (u2 - T), p = T - b, u2 = O * I, d = u2 - (u2 - I), a = I - d, A = p * a - (w - b * d - p * d - b * a), s = _ - A, o = _ - s, U[0] = _ - (s + o) + (o - A), m = M + s, o = m - M, v = M - (m - o) + (s - o), s = v - w, o = v - s, U[1] = v - (s + o) + (o - w), P = m + s, o = P - m, U[2] = m - (P - o) + (s - o), U[3] = P;
  let C = ht(4, U), X = lt * f;
  if (C >= X || -C >= X || (o = t2 - k, g = t2 - (k + o) + (o - c), o = r - I, l = r - (I + o) + (o - c), o = e - T, h = e - (T + o) + (o - i), o = n - N, y = n - (N + o) + (o - i), g === 0 && h === 0 && l === 0 && y === 0) || (X = yt * f + dt * Math.abs(C), C += k * y + N * g - (T * l + I * h), C >= X || -C >= X)) return C;
  M = g * N, u2 = O * g, b = u2 - (u2 - g), p = g - b, u2 = O * N, d = u2 - (u2 - N), a = N - d, _ = p * a - (M - b * d - p * d - b * a), w = h * I, u2 = O * h, b = u2 - (u2 - h), p = h - b, u2 = O * I, d = u2 - (u2 - I), a = I - d, A = p * a - (w - b * d - p * d - b * a), s = _ - A, o = _ - s, S[0] = _ - (s + o) + (o - A), m = M + s, o = m - M, v = M - (m - o) + (s - o), s = v - w, o = v - s, S[1] = v - (s + o) + (o - w), P = m + s, o = P - m, S[2] = m - (P - o) + (s - o), S[3] = P;
  const it = V(4, U, 4, S, G);
  M = k * y, u2 = O * k, b = u2 - (u2 - k), p = k - b, u2 = O * y, d = u2 - (u2 - y), a = y - d, _ = p * a - (M - b * d - p * d - b * a), w = T * l, u2 = O * T, b = u2 - (u2 - T), p = T - b, u2 = O * l, d = u2 - (u2 - l), a = l - d, A = p * a - (w - b * d - p * d - b * a), s = _ - A, o = _ - s, S[0] = _ - (s + o) + (o - A), m = M + s, o = m - M, v = M - (m - o) + (s - o), s = v - w, o = v - s, S[1] = v - (s + o) + (o - w), P = m + s, o = P - m, S[2] = m - (P - o) + (s - o), S[3] = P;
  const st = V(it, G, 4, S, j);
  M = g * y, u2 = O * g, b = u2 - (u2 - g), p = g - b, u2 = O * y, d = u2 - (u2 - y), a = y - d, _ = p * a - (M - b * d - p * d - b * a), w = h * l, u2 = O * h, b = u2 - (u2 - h), p = h - b, u2 = O * l, d = u2 - (u2 - l), a = l - d, A = p * a - (w - b * d - p * d - b * a), s = _ - A, o = _ - s, S[0] = _ - (s + o) + (o - A), m = M + s, o = m - M, v = M - (m - o) + (s - o), s = v - w, o = v - s, S[1] = v - (s + o) + (o - w), P = m + s, o = P - m, S[2] = m - (P - o) + (s - o), S[3] = P;
  const ot = V(st, j, 4, S, J);
  return J[ot - 1];
}
function mt(t2, e, r, n, c, i) {
  const f = (e - i) * (r - c), g = (t2 - c) * (n - i), h = f - g, l = Math.abs(f + g);
  return Math.abs(h) >= gt * l ? h : -bt(t2, e, r, n, c, i, l);
}
function wt(t2, e) {
  var r, n, c = 0, i, f, g, h, l, y, o, u2 = t2[0], b = t2[1], p = e.length;
  for (r = 0; r < p; r++) {
    n = 0;
    var d = e[r], a = d.length - 1;
    if (y = d[0], y[0] !== d[a][0] && y[1] !== d[a][1])
      throw new Error("First and last coordinates in a ring must be the same");
    for (f = y[0] - u2, g = y[1] - b, n; n < a; n++) {
      if (o = d[n + 1], h = o[0] - u2, l = o[1] - b, g === 0 && l === 0) {
        if (h <= 0 && f >= 0 || f <= 0 && h >= 0)
          return 0;
      } else if (l >= 0 && g <= 0 || l <= 0 && g >= 0) {
        if (i = mt(f, h, g, l, 0, 0), i === 0)
          return 0;
        (i > 0 && l > 0 && g <= 0 || i < 0 && l <= 0 && g > 0) && c++;
      }
      y = o, g = l, f = h;
    }
  }
  return c % 2 !== 0;
}
function L(t2, e, r = {}) {
  if (!t2)
    throw new Error("point is required");
  if (!e)
    throw new Error("polygon is required");
  const n = ut(t2), c = ft(e), i = c.type, f = e.bbox;
  let g = c.coordinates;
  if (f && xt(n, f) === false)
    return false;
  i === "Polygon" && (g = [g]);
  let h = false;
  for (var l = 0; l < g.length; ++l) {
    const y = wt(n, g[l]);
    if (y === 0) return !r.ignoreBoundary;
    y && (h = true);
  }
  return h;
}
function xt(t2, e) {
  return e[0] <= t2[0] && e[1] <= t2[1] && e[2] >= t2[0] && e[3] >= t2[1];
}
function K(t2, e) {
  for (let r = 0; r < e.features.length; r++)
    if (L(t2, e.features[r]))
      return e.features[r];
}
function rt(t2, e, r) {
  const n = e.geometry.coordinates[0][0], c = e.geometry.coordinates[0][1], i = e.geometry.coordinates[0][2], f = t2.geometry.coordinates, g = e.properties.a.geom, h = e.properties.b.geom, l = e.properties.c.geom, y = [c[0] - n[0], c[1] - n[1]], o = [i[0] - n[0], i[1] - n[1]], u2 = [f[0] - n[0], f[1] - n[1]], b = [h[0] - g[0], h[1] - g[1]], p = [l[0] - g[0], l[1] - g[1]];
  let d = (o[1] * u2[0] - o[0] * u2[1]) / (y[0] * o[1] - y[1] * o[0]), a = (y[0] * u2[1] - y[1] * u2[0]) / (y[0] * o[1] - y[1] * o[0]);
  if (r) {
    const s = r[e.properties.a.index], m = r[e.properties.b.index], v = r[e.properties.c.index];
    let M;
    if (d < 0 || a < 0 || 1 - d - a < 0) {
      const _ = d / (d + a), w = a / (d + a);
      M = d / m / (_ / m + w / v), a = a / v / (_ / m + w / v);
    } else
      M = d / m / (d / m + a / v + (1 - d - a) / s), a = a / v / (d / m + a / v + (1 - d - a) / s);
    d = M;
  }
  return [
    d * b[0] + a * p[0] + g[0],
    d * b[1] + a * p[1] + g[1]
  ];
}
function pt(t2, e, r, n) {
  const c = t2.geometry.coordinates, i = r.geometry.coordinates, f = Math.atan2(c[0] - i[0], c[1] - i[1]), g = Mt(f, e[0]);
  if (g === void 0)
    throw new Error("Unable to determine vertex index");
  const h = e[1][g];
  return rt(t2, h.features[0], n);
}
function vt(t2, e, r, n, c, i, f, g) {
  let h;
  if (f && (h = K(t2, F([f]))), !h) {
    if (r) {
      const l = t2.geometry.coordinates, y = r.gridNum, o = r.xOrigin, u2 = r.yOrigin, b = r.xUnit, p = r.yUnit, d = r.gridCache, a = B(l[0], o, b, y), s = B(l[1], u2, p, y), m = d[a] ? d[a][s] ? d[a][s] : [] : [];
      e = F(m.map((v) => e.features[v]));
    }
    h = K(t2, e);
  }
  return g && g(h), h ? rt(t2, h, i) : pt(t2, n, c, i);
}
function B(t2, e, r, n) {
  let c = Math.floor((t2 - e) / r);
  return c >= n && (c = n - 1), c;
}
function Mt(t2, e) {
  let r = Q(t2 - e[0]), n = Math.PI * 2, c;
  for (let i = 0; i < e.length; i++) {
    const f = (i + 1) % e.length, g = Q(t2 - e[f]), h = Math.min(Math.abs(r), Math.abs(g));
    r * g <= 0 && h < n && (n = h, c = i), r = g;
  }
  return c;
}
function Q(t2, e = false) {
  const r = e ? function(n) {
    return !(n >= 0 && n < Math.PI * 2);
  } : function(n) {
    return !(n > -1 * Math.PI && n <= Math.PI);
  };
  for (; r(t2); )
    t2 = t2 + 2 * Math.PI * (t2 > 0 ? -1 : 1);
  return t2;
}
function At(t2, e) {
  return e && e >= 2.00703 || Array.isArray(t2[0]) ? t2 : t2.map((r) => [
    r.illstNodes,
    r.mercNodes,
    r.startEnd
  ]);
}
function _t(t2) {
  const e = [0, 1, 2, 0].map((n) => t2[n][0][0]), r = {
    a: { geom: t2[0][0][1], index: t2[0][1] },
    b: { geom: t2[1][0][1], index: t2[1][1] },
    c: { geom: t2[2][0][1], index: t2[2][1] }
  };
  return et([e], r);
}
function $(t2, e, r, n, c, i = false, f) {
  const g = t2.map(
    (h) => {
      (!f || f < 2.00703) && (h = nt(h));
      const l = isFinite(h) ? e[h] : h === "c" ? n : h === "b0" ? c[0] : h === "b1" ? c[1] : h === "b2" ? c[2] : h === "b3" ? c[3] : function() {
        const y = h.match(/e(\d+)/);
        if (y) {
          const o = parseInt(y[1]);
          return r[o];
        }
        throw "Bad index value for indexesToTri";
      }();
      return i ? [[l[1], l[0]], h] : [[l[0], l[1]], h];
    }
  );
  return _t(g);
}
function nt(t2) {
  return typeof t2 == "number" ? t2 : t2.replace(/^(c|e|b)(?:ent|dgeNode|box)(\d+)?$/, "$1$2");
}
const D = 2.00703;
function Et(t2) {
  return !!(t2.version || !t2.tins && t2.points && t2.tins_points);
}
function Pt(t2) {
  return {
    points: t2.points,
    pointsWeightBuffer: St(t2),
    strictStatus: kt(t2),
    verticesParams: It(t2),
    centroid: Tt(t2),
    edges: At(t2.edges || []),
    edgeNodes: t2.edgeNodes || [],
    tins: Nt(t2),
    kinks: Bt(t2.kinks_points),
    yaxisMode: t2.yaxisMode ?? "invert",
    strictMode: t2.strictMode ?? "auto",
    vertexMode: t2.vertexMode,
    bounds: t2.bounds,
    boundsPolygon: t2.boundsPolygon,
    wh: t2.wh,
    xy: t2.bounds ? t2.xy : [0, 0]
  };
}
function Ot(t2) {
  const e = Ct(t2), r = e.tins;
  return {
    compiled: e,
    tins: r,
    points: Rt(r),
    strictStatus: e.strict_status,
    pointsWeightBuffer: e.weight_buffer,
    verticesParams: e.vertices_params,
    centroid: e.centroid,
    kinks: e.kinks
  };
}
function St(t2) {
  return !t2.version || t2.version < D ? ["forw", "bakw"].reduce((e, r) => {
    const n = t2.weight_buffer[r];
    return n && (e[r] = Object.keys(n).reduce((c, i) => {
      const f = nt(i);
      return c[f] = n[i], c;
    }, {})), e;
  }, {}) : t2.weight_buffer;
}
function kt(t2) {
  return t2.strict_status ? t2.strict_status : t2.kinks_points ? "strict_error" : t2.tins_points.length === 2 ? "loose" : "strict";
}
function It(t2) {
  const e = {
    forw: [t2.vertices_params[0]],
    bakw: [t2.vertices_params[1]]
  };
  return e.forw[1] = H(t2, false), e.bakw[1] = H(t2, true), e;
}
function H(t2, e) {
  return [0, 1, 2, 3].map((r) => {
    const n = (r + 1) % 4, c = $(
      ["c", `b${r}`, `b${n}`],
      t2.points,
      t2.edgeNodes || [],
      t2.centroid_point,
      t2.vertices_points,
      e,
      D
    );
    return F([c]);
  });
}
function Tt(t2) {
  return {
    forw: W(t2.centroid_point[0], {
      target: {
        geom: t2.centroid_point[1],
        index: "c"
      }
    }),
    bakw: W(t2.centroid_point[1], {
      target: {
        geom: t2.centroid_point[0],
        index: "c"
      }
    })
  };
}
function Nt(t2) {
  const e = t2.tins_points.length === 1 ? 0 : 1;
  return {
    forw: F(
      t2.tins_points[0].map(
        (r) => $(
          r,
          t2.points,
          t2.edgeNodes || [],
          t2.centroid_point,
          t2.vertices_points,
          false,
          t2.version
        )
      )
    ),
    bakw: F(
      t2.tins_points[e].map(
        (r) => $(
          r,
          t2.points,
          t2.edgeNodes || [],
          t2.centroid_point,
          t2.vertices_points,
          true,
          t2.version
        )
      )
    )
  };
}
function Bt(t2) {
  if (t2)
    return {
      bakw: F(
        t2.map((e) => W(e))
      )
    };
}
function Ct(t2) {
  return JSON.parse(
    JSON.stringify(t2).replace('"cent"', '"c"').replace(/"bbox(\d+)"/g, '"b$1"')
  );
}
function Rt(t2) {
  const e = [], r = t2.forw.features;
  for (let n = 0; n < r.length; n++) {
    const c = r[n];
    ["a", "b", "c"].map((i, f) => {
      const g = c.geometry.coordinates[0][f], h = c.properties[i].geom, l = c.properties[i].index;
      typeof l == "number" && (e[l] = [g, h]);
    });
  }
  return e;
}
const E = class E2 {
  constructor() {
    x(this, "points", []);
    x(this, "pointsWeightBuffer");
    x(this, "strict_status");
    x(this, "vertices_params");
    x(this, "centroid");
    x(this, "edgeNodes");
    x(this, "edges");
    x(this, "tins");
    x(this, "kinks");
    x(this, "yaxisMode", E2.YAXIS_INVERT);
    x(this, "strictMode", E2.MODE_AUTO);
    x(this, "vertexMode", E2.VERTEX_PLAIN);
    x(this, "bounds");
    x(this, "boundsPolygon");
    x(this, "wh");
    x(this, "xy");
    x(this, "indexedTins");
    x(this, "stateFull", false);
    x(this, "stateTriangle");
    x(this, "stateBackward");
    x(this, "priority");
    x(this, "importance");
    x(this, "xyBounds");
    x(this, "mercBounds");
  }
  /**
   * コンパイルされた設定を適用します
   * 
   * @param compiled - コンパイルされた設定オブジェクト
   * @returns 変換に必要な主要なオブジェクトのセット
   * 
   * 以下の処理を行います：
   * 1. バージョンに応じた設定の解釈
   * 2. 各種パラメータの復元
   * 3. TINネットワークの再構築
   * 4. インデックスの作成
   */
  setCompiled(e) {
    if (Et(e)) {
      this.applyModernState(Pt(e));
      return;
    }
    this.applyLegacyState(Ot(e));
  }
  applyModernState(e) {
    this.points = e.points, this.pointsWeightBuffer = e.pointsWeightBuffer, this.strict_status = e.strictStatus, this.vertices_params = e.verticesParams, this.centroid = e.centroid, this.edges = e.edges, this.edgeNodes = e.edgeNodes || [], this.tins = e.tins, this.addIndexedTin(), this.kinks = e.kinks, this.yaxisMode = e.yaxisMode ?? E2.YAXIS_INVERT, this.vertexMode = e.vertexMode ?? E2.VERTEX_PLAIN, this.strictMode = e.strictMode ?? E2.MODE_AUTO, e.bounds ? (this.bounds = e.bounds, this.boundsPolygon = e.boundsPolygon, this.xy = e.xy, this.wh = e.wh) : (this.bounds = void 0, this.boundsPolygon = void 0, this.xy = e.xy ?? [0, 0], e.wh && (this.wh = e.wh));
  }
  applyLegacyState(e) {
    this.tins = e.tins, this.addIndexedTin(), this.strict_status = e.strictStatus, this.pointsWeightBuffer = e.pointsWeightBuffer, this.vertices_params = e.verticesParams, this.centroid = e.centroid, this.kinks = e.kinks, this.points = e.points;
  }
  /**
   * TINネットワークのインデックスを作成します
   * 
   * インデックスは変換処理を高速化するために使用されます。
   * グリッド形式のインデックスを作成し、各グリッドに
   * 含まれる三角形を記録します。
   */
  addIndexedTin() {
    const e = this.tins, r = e.forw, n = e.bakw, c = Math.ceil(Math.sqrt(r.features.length));
    if (c < 3) {
      this.indexedTins = void 0;
      return;
    }
    let i = [], f = [];
    const g = r.features.map((d) => {
      let a = [];
      return z(d)[0].map((s) => {
        i.length === 0 ? i = [Array.from(s), Array.from(s)] : (s[0] < i[0][0] && (i[0][0] = s[0]), s[0] > i[1][0] && (i[1][0] = s[0]), s[1] < i[0][1] && (i[0][1] = s[1]), s[1] > i[1][1] && (i[1][1] = s[1])), a.length === 0 ? a = [Array.from(s), Array.from(s)] : (s[0] < a[0][0] && (a[0][0] = s[0]), s[0] > a[1][0] && (a[1][0] = s[0]), s[1] < a[0][1] && (a[0][1] = s[1]), s[1] > a[1][1] && (a[1][1] = s[1]));
      }), a;
    }), h = (i[1][0] - i[0][0]) / c, l = (i[1][1] - i[0][1]) / c, y = g.reduce(
      (d, a, s) => {
        const m = B(
          a[0][0],
          i[0][0],
          h,
          c
        ), v = B(
          a[1][0],
          i[0][0],
          h,
          c
        ), M = B(
          a[0][1],
          i[0][1],
          l,
          c
        ), _ = B(
          a[1][1],
          i[0][1],
          l,
          c
        );
        for (let w = m; w <= v; w++) {
          d[w] || (d[w] = []);
          for (let A = M; A <= _; A++)
            d[w][A] || (d[w][A] = []), d[w][A].push(s);
        }
        return d;
      },
      []
    ), o = n.features.map((d) => {
      let a = [];
      return z(d)[0].map((s) => {
        f.length === 0 ? f = [Array.from(s), Array.from(s)] : (s[0] < f[0][0] && (f[0][0] = s[0]), s[0] > f[1][0] && (f[1][0] = s[0]), s[1] < f[0][1] && (f[0][1] = s[1]), s[1] > f[1][1] && (f[1][1] = s[1])), a.length === 0 ? a = [Array.from(s), Array.from(s)] : (s[0] < a[0][0] && (a[0][0] = s[0]), s[0] > a[1][0] && (a[1][0] = s[0]), s[1] < a[0][1] && (a[0][1] = s[1]), s[1] > a[1][1] && (a[1][1] = s[1]));
      }), a;
    }), u2 = (f[1][0] - f[0][0]) / c, b = (f[1][1] - f[0][1]) / c, p = o.reduce(
      (d, a, s) => {
        const m = B(
          a[0][0],
          f[0][0],
          u2,
          c
        ), v = B(
          a[1][0],
          f[0][0],
          u2,
          c
        ), M = B(
          a[0][1],
          f[0][1],
          b,
          c
        ), _ = B(
          a[1][1],
          f[0][1],
          b,
          c
        );
        for (let w = m; w <= v; w++) {
          d[w] || (d[w] = []);
          for (let A = M; A <= _; A++)
            d[w][A] || (d[w][A] = []), d[w][A].push(s);
        }
        return d;
      },
      []
    );
    this.indexedTins = {
      forw: {
        gridNum: c,
        xOrigin: i[0][0],
        yOrigin: i[0][1],
        xUnit: h,
        yUnit: l,
        gridCache: y
      },
      bakw: {
        gridNum: c,
        xOrigin: f[0][0],
        yOrigin: f[0][1],
        xUnit: u2,
        yUnit: b,
        gridCache: p
      }
    };
  }
  /**
   * 座標変換を実行します
   * 
   * @param apoint - 変換する座標
   * @param backward - 逆方向の変換かどうか
   * @param ignoreBounds - 境界チェックを無視するかどうか
   * @returns 変換後の座標、または境界外の場合はfalse
   * 
   * @throws {Error} 逆方向変換が許可されていない状態での逆変換時
   */
  transform(e, r, n) {
    if (r && this.strict_status == E2.STATUS_ERROR)
      throw 'Backward transform is not allowed if strict_status == "strict_error"';
    this.yaxisMode == E2.YAXIS_FOLLOW && r && (e = [e[0], -1 * e[1]]);
    const c = W(e);
    if (this.bounds && !r && !n && !L(c, this.boundsPolygon))
      return false;
    const i = r ? this.tins.bakw : this.tins.forw, f = r ? this.indexedTins.bakw : this.indexedTins.forw, g = r ? this.vertices_params.bakw : this.vertices_params.forw, h = r ? this.centroid.bakw : this.centroid.forw, l = r ? this.pointsWeightBuffer.bakw : this.pointsWeightBuffer.forw;
    let y, o;
    this.stateFull && (this.stateBackward == r ? y = this.stateTriangle : (this.stateBackward = r, this.stateTriangle = void 0), o = (b) => {
      this.stateTriangle = b;
    });
    let u2 = vt(
      c,
      i,
      f,
      g,
      h,
      l,
      y,
      o
    );
    if (this.bounds && r && !n) {
      const b = W(u2);
      if (!L(b, this.boundsPolygon)) return false;
    } else this.yaxisMode == E2.YAXIS_FOLLOW && !r && (u2 = [u2[0], -1 * u2[1]]);
    return u2;
  }
};
x(E, "VERTEX_PLAIN", "plain"), x(E, "VERTEX_BIRDEYE", "birdeye"), x(E, "MODE_STRICT", "strict"), x(E, "MODE_AUTO", "auto"), x(E, "MODE_LOOSE", "loose"), x(E, "STATUS_STRICT", "strict"), x(E, "STATUS_ERROR", "strict_error"), x(E, "STATUS_LOOSE", "loose"), x(E, "YAXIS_FOLLOW", "follow"), x(E, "YAXIS_INVERT", "invert");
let Z = E;
const keys = [
  "title",
  "attr",
  "officialTitle",
  "dataAttr",
  "author",
  "createdAt",
  "era",
  "license",
  "dataLicense",
  "contributor",
  "mapper",
  "reference",
  "description",
  "url",
  "lang",
  "imageExtension",
  "homePosition",
  "mercZoom"
];
async function store2HistMap(store, byCompiled = false) {
  return store2HistMap_internal(store, byCompiled, false);
}
async function store2HistMap_internal(store, byCompiled, coreLogic) {
  var _a, _b;
  const ret = coreLogic ? store : {};
  const tins = [];
  keys.forEach((key) => {
    ret[key] = store[key];
  });
  if (store["imageExtention"] || store["imageExtension"])
    ret["imageExtension"] = store["imageExtension"] || store["imageExtention"];
  if (store.compiled) {
    let tin = new Z();
    tin.setCompiled(store.compiled);
    tin.addIndexedTin();
    if (byCompiled) {
      tin = store.compiled;
    }
    const transform = tin;
    ret.strictMode = transform.strictMode;
    ret.vertexMode = transform.vertexMode;
    ret.yaxisMode = transform.yaxisMode;
    ret.width = (_a = transform.wh) == null ? void 0 : _a[0];
    ret.height = (_b = transform.wh) == null ? void 0 : _b[1];
    ret.gcps = transform.points;
    ret.edges = transform.edges;
    tins.push(tin);
  } else {
    ret.strictMode = store.strictMode;
    ret.vertexMode = store.vertexMode;
    ret.yaxisMode = store.yaxisMode;
    ret.width = store.width;
    ret.height = store.height;
    ret.gcps = store.gcps;
    ret.edges = store.edges;
    let tin = await createTinFromGcpsAsync(
      store.strictMode,
      store.vertexMode,
      store.yaxisMode,
      store.gcps,
      store.edges,
      [store.width, store.height]
    );
    if (byCompiled && typeof tin !== "string") tin = store.compiled;
    tins.push(tin);
  }
  if (store.sub_maps) {
    const sub_maps = [];
    for (let i = 0; i < store.sub_maps.length; i++) {
      const sub_map = store.sub_maps[i];
      const sub = {};
      sub.importance = sub_map.importance;
      sub.priority = sub_map.priority;
      if (sub_map.compiled) {
        let tin = new Z();
        tin.setCompiled(sub_map.compiled);
        tin.addIndexedTin();
        if (byCompiled) {
          tin = sub_map.compiled;
        }
        sub.bounds = tin.bounds;
        sub.gcps = tin.points;
        sub.edges = tin.edges;
        tins.push(tin);
      } else {
        sub.bounds = sub_map.bounds;
        sub.gcps = sub_map.gcps;
        sub.edges = sub_map.edges;
        let tin = await createTinFromGcpsAsync(
          store.strictMode,
          store.vertexMode,
          store.yaxisMode,
          sub_map.gcps,
          sub_map.edges,
          void 0,
          sub_map.bounds
        );
        if (byCompiled && typeof tin !== "string")
          tin = sub_map.compiled;
        tins.push(tin);
      }
      sub_maps.push(sub);
    }
    ret.sub_maps = sub_maps;
  }
  return [ret, tins];
}
async function histMap2Store(histmap, tins) {
  const ret = {};
  keys.forEach((key) => {
    ret[key] = histmap[key];
  });
  if (histmap["imageExtention"] || histmap["imageExtension"])
    ret["imageExtension"] = histmap["imageExtension"] || histmap["imageExtention"];
  const tin = tins.shift();
  if (typeof tin === "string") {
    ret.width = histmap.width;
    ret.height = histmap.height;
    ret.gcps = histmap.gcps;
    ret.edges = histmap.edges;
    ret.strictMode = histmap.strictMode;
    ret.vertexMode = histmap.vertexMode;
    ret.yaxisMode = histmap.yaxisMode;
  } else {
    ret.compiled = tin;
  }
  ret.sub_maps = tins.length > 0 ? tins.map((tin2, index) => {
    const sub_map = histmap.sub_maps[index];
    const sub = {
      priority: sub_map.priority,
      importance: sub_map.importance
    };
    if (typeof tin2 === "string") {
      sub.gcps = sub_map.gcps;
      sub.edges = sub_map.edges;
      sub.bounds = sub_map.bounds;
    } else {
      sub.compiled = tin2;
    }
    return sub;
  }) : [];
  return ret;
}
async function createTinFromGcpsAsync(_strict, _vertex, _yaxis, gcps = [], _edges = [], _wh, _bounds) {
  if (gcps.length < 3) return "tooLessGcps";
  console.error("@maplat/transform requires pre-compiled data. Cannot create from GCPs.");
  console.error("Please use @maplat/editor or a separate tool to generate compiled data.");
  return "compiledRequired";
}
class ProgressReporter {
  constructor(channel, total, startMsg, endMsg) {
    __publicField(this, "channel");
    __publicField(this, "total");
    __publicField(this, "startMsg");
    __publicField(this, "endMsg");
    __publicField(this, "window", null);
    this.channel = channel;
    this.total = total;
    this.startMsg = startMsg;
    this.endMsg = endMsg;
  }
  setWindow(window2) {
    this.window = window2;
  }
  update(current) {
    if (!this.window) return;
    const percent = Math.floor(current / this.total * 100);
    const progress = `${current} / ${this.total}`;
    const msg = current === this.total ? this.endMsg : this.startMsg;
    this.window.webContents.send(this.channel, {
      text: msg,
      percent,
      progress
    });
  }
}
class MapDataService {
  constructor() {
    __publicField(this, "db", null);
  }
  get folders() {
    const saveFolder = SettingsService$1.get("saveFolder");
    return {
      saveFolder,
      tileFolder: path$e.join(saveFolder, "tiles"),
      originalFolder: path$e.join(saveFolder, "originals"),
      uiThumbnailFolder: path$e.join(saveFolder, "tmbs"),
      mapFolder: path$e.join(saveFolder, "maps"),
      compFolder: path$e.join(saveFolder, "compiled"),
      dbFile: path$e.join(saveFolder, "nedb.db")
    };
  }
  async getDBInstance() {
    return this.getDB();
  }
  async getDB() {
    if (this.db) return this.db;
    const { dbFile } = this.folders;
    this.db = new Datastore$1({ filename: dbFile, autoload: true });
    return this.db;
  }
  async migrateIfNeeded(window2) {
    const { compFolder } = this.folders;
    try {
      if (!fs$1.existsSync(compFolder)) return;
      if (fs$1.existsSync(path$e.join(compFolder, ".updated"))) return;
      await this.runMigration(window2);
    } catch (e) {
      console.error("Migration check failed", e);
    }
  }
  async runMigration(window2) {
    const { compFolder } = this.folders;
    const mapFiles = await fs$1.readdir(compFolder);
    const db = await this.getDB();
    const jsonFiles = mapFiles.filter((f) => f.endsWith(".json"));
    const reporter = new ProgressReporter("taskProgress", jsonFiles.length, "maplist.migrating", "maplist.migrated");
    reporter.setWindow(window2);
    let count = 0;
    reporter.update(0);
    for (const file2 of jsonFiles) {
      const mapID = file2.replace(".json", "");
      try {
        const jsonLoad = await fs$1.readJson(path$e.join(compFolder, file2));
        const [store, tins] = await store2HistMap(jsonLoad);
        const finalStore = await histMap2Store(store, tins);
        await db.updateAsync({ _id: mapID }, { $set: finalStore }, { upsert: true });
      } catch (e) {
        console.error(`Failed to migrate ${file2}`, e);
      }
      count++;
      reporter.update(count);
      await new Promise((r) => setTimeout(r, 50));
    }
    await fs$1.writeFile(path$e.join(compFolder, ".updated"), "done");
  }
  async requestMaps(query = "", page = 1, pageSize = 20) {
    const db = await this.getDB();
    let queryObj = {};
    if (query) {
      const regex = new RegExp(query, "i");
      queryObj = { $or: [{ "title.ja": regex }, { "title.en": regex }, { title: regex }, { name: regex }] };
    }
    const skip = (page - 1) * pageSize;
    console.log(`[MapDataService] Requesting maps: query='${query}', page=${page}, skip=${skip}, limit=${pageSize}`);
    const docs = await new Promise((resolve2, reject) => {
      db.find(queryObj).sort({ _id: 1 }).skip(skip).limit(pageSize).exec((err, documents) => {
        if (err) reject(err);
        else resolve2(documents);
      });
    });
    const results = await Promise.all(docs.map(async (doc) => {
      const mapID = doc._id || doc.mapID;
      let title2 = doc.title;
      if (typeof title2 === "object") {
        title2 = title2.ja || title2.en || Object.values(title2)[0];
      }
      const width = doc.width || doc.compiled && doc.compiled.wh && doc.compiled.wh[0];
      const height = doc.height || doc.compiled && doc.compiled.wh && doc.compiled.wh[1];
      const res = {
        mapID,
        title: title2 || mapID,
        width,
        height,
        image: null
      };
      if (res.width && res.height) {
        if (res.width > res.height) {
          res.height = Math.round(res.height * 190 / res.width);
          res.width = 190;
        } else {
          res.width = Math.round(res.width * 190 / res.height);
          res.height = 190;
        }
      } else {
        res.width = 190;
        res.height = 190;
      }
      const { tileFolder } = this.folders;
      const thumbFolder = path$e.join(tileFolder, mapID, "0", "0");
      let foundTile = false;
      if (fs$1.existsSync(thumbFolder)) {
        try {
          const files = await fs$1.readdir(thumbFolder);
          const tileFile = files.find((f) => /^0\.(jpg|jpeg|png)$/.test(f));
          if (tileFile) {
            const tilePath = path$e.join(thumbFolder, tileFile);
            res.image = `file://${tilePath.split(path$e.sep).join("/")}`;
            foundTile = true;
          }
        } catch (e) {
          console.error(`Error reading existing search result tile for ${mapID}`, e);
        }
      }
      if (!foundTile) {
        res.image = null;
      }
      return res;
    }));
    return results;
  }
  async generateThumbnail(from, to) {
    if (!fs$1.existsSync(path$e.dirname(to))) {
      await fs$1.ensureDir(path$e.dirname(to));
    }
    await fs$1.copy(from, to, { overwrite: true });
  }
  async switchDataFolder() {
    this.db = null;
    const { tileFolder, originalFolder, uiThumbnailFolder, mapFolder, compFolder } = this.folders;
    try {
      await fs$1.ensureDir(tileFolder);
      await fs$1.ensureDir(originalFolder);
      await fs$1.ensureDir(uiThumbnailFolder);
      await fs$1.ensureDir(mapFolder);
      await fs$1.ensureDir(compFolder);
      console.log(`[MapDataService] Data folder switched and initialized: ${SettingsService$1.get("saveFolder")}`);
    } catch (e) {
      console.error("[MapDataService] Failed to initialize new data folders", e);
    }
  }
}
const MapDataService$1 = new MapDataService();
function registerSettingsHandlers() {
  ipcMain$1.removeHandler("settings:get");
  ipcMain$1.handle("settings:get", (_, key) => {
    return SettingsService$1.get(key);
  });
  ipcMain$1.handle("settings:set", async (event, key, value) => {
    SettingsService$1.set(key, value);
    if (key === "saveFolder") {
      await MapDataService$1.switchDataFolder();
      BrowserWindow.getAllWindows().forEach((win2) => {
        win2.webContents.send("maplist:refresh");
      });
    }
  });
  ipcMain$1.handle("settings:select-folder", async (event) => {
    const window2 = BrowserWindow.fromWebContents(event.sender);
    return await SettingsService$1.showSaveFolderDialog(window2);
  });
}
function registerMapHandlers() {
  ipcMain$1.handle("maplist:request", async (event, query, page, pageSize) => {
    const win2 = BrowserWindow.fromWebContents(event.sender);
    if (win2) await MapDataService$1.migrateIfNeeded(win2);
    return await MapDataService$1.requestMaps(query, page, pageSize);
  });
}
function fileUrl(filePath, options = {}) {
  if (typeof filePath !== "string") {
    throw new TypeError(`Expected a string, got ${typeof filePath}`);
  }
  const { resolve: resolve2 = true } = options;
  let pathName = filePath;
  if (resolve2) {
    pathName = path$e.resolve(filePath);
  }
  pathName = pathName.replace(/\\/g, "/");
  if (pathName[0] !== "/") {
    pathName = `/${pathName}`;
  }
  return encodeURI(`file://${pathName}`).replace(/[?#]/g, encodeURIComponent);
}
class MapEditService {
  async request(mapID) {
    const db = await MapDataService$1.getDBInstance();
    const json2 = await db.findOneAsync({ _id: mapID });
    if (!json2) throw new Error(`Map with ID ${mapID} not found`);
    const saveFolder = SettingsService$1.get("saveFolder");
    const tileFolder = path$e.join(saveFolder, "tiles");
    const thumbFolder = path$e.join(tileFolder, mapID, "0", "0");
    const res = await this.normalizeRequestData(json2, thumbFolder);
    res[0].mapID = mapID;
    res[0].status = "Update";
    res[0].onlyOne = true;
    return res[0];
  }
  async normalizeRequestData(json2, thumbFolder) {
    let url_;
    const whReady = json2.width && json2.height || json2.compiled && json2.compiled.wh;
    if (!whReady) {
      return [json2];
    }
    if (json2.url) {
      url_ = json2.url;
    } else {
      try {
        if (await fs$1.pathExists(thumbFolder)) {
          const thumbs = await fs$1.readdir(thumbFolder);
          const tileFile = thumbs.find((f) => /^0\.(jpg|jpeg|png)$/.test(f));
          if (tileFile) {
            let thumbURL = fileUrl(path$e.join(thumbFolder, tileFile));
            const pattern2 = /\/0\/0\/0\.(jpg|jpeg|png)$/;
            url_ = thumbURL.replace(pattern2, "/{z}/{x}/{y}.$1");
          }
        }
      } catch (e) {
        console.error("Error finding tiles:", e);
      }
    }
    const [store, tins] = await store2HistMap(json2, true);
    store.url_ = url_;
    const res = [store, tins];
    return res;
  }
}
const MapEditService$1 = new MapEditService();
const registerMapEditHandlers = () => {
  ipcMain$1.handle("mapedit:request", async (event, mapID) => {
    try {
      return await MapEditService$1.request(mapID);
    } catch (e) {
      console.error("Failed to handle mapedit:request", e);
      throw e;
    }
  });
};
createRequire(import.meta.url);
const __dirname$1 = path$d.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path$d.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path$d.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path$d.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path$d.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200,
    // Enforce minimum size like legacy
    minHeight: 800,
    icon: path$d.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path$d.join(__dirname$1, "preload.mjs"),
      webSecurity: false
      // Allow loading local resources like file://
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path$d.join(RENDERER_DIST, "index.html"));
  }
}
app$1.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app$1.quit();
    win = null;
  }
});
app$1.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app$1.whenReady().then(() => {
  ipcMain$1.removeHandler("settings:get");
  ipcMain$1.removeHandler("settings:set");
  ipcMain$1.removeHandler("settings:select-data-folder");
  ipcMain$1.removeHandler("map:list");
  ipcMain$1.removeHandler("map:get");
  ipcMain$1.removeHandler("mapedit:request");
  ipcMain$1.removeHandler("mapedit:request");
  ipcMain$1.removeHandler("mapedit:get-tms-list");
  ipcMain$1.removeHandler("dialog:showMessageBox");
  ipcMain$1.handle("dialog:showMessageBox", async (event, options) => {
    return await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), options);
  });
  registerSettingsHandlers();
  registerMapHandlers();
  registerMapEditHandlers();
  createWindow();
  setupMenu();
});
const messages = {
  en: {
    "menu.maplateditor": "MaplatEditor",
    "menu.quit": "Quit",
    "menu.about": "About MaplatEditor",
    "menu.edit": "Edit",
    "menu.undo": "Undo",
    "menu.redo": "Redo",
    "menu.cut": "Cut",
    "menu.copy": "Copy",
    "menu.paste": "Paste",
    "menu.selectAll": "Select All",
    "menu.development": "Development",
    "menu.reload": "Reload",
    "menu.toggleDevTools": "Toggle Developer Tools"
  },
  ja: {
    "menu.maplateditor": "MaplatEditor",
    "menu.quit": "MaplatEditorを終了",
    "menu.about": "MaplatEditorについて",
    "menu.edit": "編集",
    "menu.undo": "元に戻す",
    "menu.redo": "やり直す",
    "menu.cut": "切り取り",
    "menu.copy": "コピー",
    "menu.paste": "貼り付け",
    "menu.selectAll": "すべて選択",
    "menu.development": "開発",
    "menu.reload": "再読み込み",
    "menu.toggleDevTools": "開発者ツール"
  }
};
let aboutWin = null;
function createAboutWindow() {
  if (aboutWin) {
    aboutWin.focus();
    return;
  }
  aboutWin = new BrowserWindow({
    width: 400,
    height: 450,
    // Increased height to ensure all content fits
    resizable: true,
    // Allow resizing to debug layout issues if they persist
    minimizable: false,
    maximizable: false,
    title: "About MaplatEditor",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });
  aboutWin.setMenu(null);
  const aboutPath = path$d.join(process.env.VITE_PUBLIC, "about.html");
  aboutWin.loadFile(aboutPath);
  aboutWin.on("closed", () => {
    aboutWin = null;
  });
}
function setupMenu() {
  const lang = SettingsService$1.get("lang") || "en";
  const t2 = (key) => {
    var _a;
    return ((_a = messages[lang]) == null ? void 0 : _a[key]) || messages["en"][key] || key;
  };
  const template = [
    {
      label: t2("menu.maplateditor"),
      submenu: [
        {
          label: t2("menu.quit"),
          accelerator: "CmdOrCtrl+Q",
          click: () => app$1.quit()
        },
        { type: "separator" },
        {
          label: t2("menu.about"),
          click: createAboutWindow
        }
      ]
    },
    {
      label: t2("menu.edit"),
      submenu: [
        { role: "undo", label: t2("menu.undo") },
        { role: "redo", label: t2("menu.redo") },
        { type: "separator" },
        { role: "cut", label: t2("menu.cut") },
        { role: "copy", label: t2("menu.copy") },
        { role: "paste", label: t2("menu.paste") },
        { role: "selectAll", label: t2("menu.selectAll") }
      ]
    }
  ];
  template.push({
    label: t2("menu.development"),
    submenu: [
      { role: "reload", label: t2("menu.reload") },
      { role: "toggleDevTools", label: t2("menu.toggleDevTools") }
    ]
  });
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
app$1.whenReady().then(() => {
  registerSettingsHandlers();
  registerMapHandlers();
  createWindow();
  setupMenu();
  SettingsService$1.on("changeLang", () => {
    setupMenu();
  });
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
