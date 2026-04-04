import am, { app as xe, dialog as In, ipcMain as Ot, BrowserWindow as We, Menu as Xh } from "electron";
import { fileURLToPath as Bp } from "node:url";
import At from "node:path";
import Xt from "node:process";
import { promisify as ue, isDeepStrictEqual as Wh } from "node:util";
import $t from "node:fs";
import Tn from "node:crypto";
import Jh from "node:assert";
import om from "node:os";
import "node:events";
import "node:stream";
import Gr from "fs";
import Zp from "constants";
import ca from "stream";
import ha from "util";
import Vp from "assert";
import lt from "path";
import Hp, { EventEmitter as Kp } from "events";
import cm from "crypto";
import Xp from "timers";
import Wp from "buffer";
import hm from "zlib";
import { Jimp as gn } from "jimp";
const rn = (t) => {
  const e = typeof t;
  return t !== null && (e === "object" || e === "function");
}, lm = /* @__PURE__ */ new Set([
  "__proto__",
  "prototype",
  "constructor"
]), um = 1e6, Jp = (t) => t >= "0" && t <= "9";
function fm(t) {
  if (t === "0")
    return !0;
  if (/^[1-9]\d*$/.test(t)) {
    const e = Number.parseInt(t, 10);
    return e <= Number.MAX_SAFE_INTEGER && e <= um;
  }
  return !1;
}
function Sa(t, e) {
  return lm.has(t) ? !1 : (t && fm(t) ? e.push(Number.parseInt(t, 10)) : e.push(t), !0);
}
function Yp(t) {
  if (typeof t != "string")
    throw new TypeError(`Expected a string, got ${typeof t}`);
  const e = [];
  let r = "", n = "start", i = !1, s = 0;
  for (const a of t) {
    if (s++, i) {
      r += a, i = !1;
      continue;
    }
    if (a === "\\") {
      if (n === "index")
        throw new Error(`Invalid character '${a}' in an index at position ${s}`);
      if (n === "indexEnd")
        throw new Error(`Invalid character '${a}' after an index at position ${s}`);
      i = !0, n = n === "start" ? "property" : n;
      continue;
    }
    switch (a) {
      case ".": {
        if (n === "index")
          throw new Error(`Invalid character '${a}' in an index at position ${s}`);
        if (n === "indexEnd") {
          n = "property";
          break;
        }
        if (!Sa(r, e))
          return [];
        r = "", n = "property";
        break;
      }
      case "[": {
        if (n === "index")
          throw new Error(`Invalid character '${a}' in an index at position ${s}`);
        if (n === "indexEnd") {
          n = "index";
          break;
        }
        if (n === "property" || n === "start") {
          if ((r || n === "property") && !Sa(r, e))
            return [];
          r = "";
        }
        n = "index";
        break;
      }
      case "]": {
        if (n === "index") {
          if (r === "")
            r = (e.pop() || "") + "[]", n = "property";
          else {
            const o = Number.parseInt(r, 10);
            !Number.isNaN(o) && Number.isFinite(o) && o >= 0 && o <= Number.MAX_SAFE_INTEGER && o <= um && r === String(o) ? e.push(o) : e.push(r), r = "", n = "indexEnd";
          }
          break;
        }
        if (n === "indexEnd")
          throw new Error(`Invalid character '${a}' after an index at position ${s}`);
        r += a;
        break;
      }
      default: {
        if (n === "index" && !Jp(a))
          throw new Error(`Invalid character '${a}' in an index at position ${s}`);
        if (n === "indexEnd")
          throw new Error(`Invalid character '${a}' after an index at position ${s}`);
        n === "start" && (n = "property"), r += a;
      }
    }
  }
  switch (i && (r += "\\"), n) {
    case "property": {
      if (!Sa(r, e))
        return [];
      break;
    }
    case "index":
      throw new Error("Index was not closed");
    case "start": {
      e.push("");
      break;
    }
  }
  return e;
}
function la(t) {
  if (typeof t == "string")
    return Yp(t);
  if (Array.isArray(t)) {
    const e = [];
    for (const [r, n] of t.entries()) {
      if (typeof n != "string" && typeof n != "number")
        throw new TypeError(`Expected a string or number for path segment at index ${r}, got ${typeof n}`);
      if (typeof n == "number" && !Number.isFinite(n))
        throw new TypeError(`Path segment at index ${r} must be a finite number, got ${n}`);
      if (lm.has(n))
        return [];
      typeof n == "string" && fm(n) ? e.push(Number.parseInt(n, 10)) : e.push(n);
    }
    return e;
  }
  return [];
}
function Yh(t, e, r) {
  if (!rn(t) || typeof e != "string" && !Array.isArray(e))
    return r === void 0 ? t : r;
  const n = la(e);
  if (n.length === 0)
    return r;
  for (let i = 0; i < n.length; i++) {
    const s = n[i];
    if (t = t[s], t == null) {
      if (i !== n.length - 1)
        return r;
      break;
    }
  }
  return t === void 0 ? r : t;
}
function vi(t, e, r) {
  if (!rn(t) || typeof e != "string" && !Array.isArray(e))
    return t;
  const n = t, i = la(e);
  if (i.length === 0)
    return t;
  for (let s = 0; s < i.length; s++) {
    const a = i[s];
    if (s === i.length - 1)
      t[a] = r;
    else if (!rn(t[a])) {
      const c = typeof i[s + 1] == "number";
      t[a] = c ? [] : {};
    }
    t = t[a];
  }
  return n;
}
function Qp(t, e) {
  if (!rn(t) || typeof e != "string" && !Array.isArray(e))
    return !1;
  const r = la(e);
  if (r.length === 0)
    return !1;
  for (let n = 0; n < r.length; n++) {
    const i = r[n];
    if (n === r.length - 1)
      return Object.hasOwn(t, i) ? (delete t[i], !0) : !1;
    if (t = t[i], !rn(t))
      return !1;
  }
}
function Ma(t, e) {
  if (!rn(t) || typeof e != "string" && !Array.isArray(e))
    return !1;
  const r = la(e);
  if (r.length === 0)
    return !1;
  for (const n of r) {
    if (!rn(t) || !(n in t))
      return !1;
    t = t[n];
  }
  return !0;
}
const Dr = om.homedir(), gh = om.tmpdir(), { env: wn } = Xt, t1 = (t) => {
  const e = At.join(Dr, "Library");
  return {
    data: At.join(e, "Application Support", t),
    config: At.join(e, "Preferences", t),
    cache: At.join(e, "Caches", t),
    log: At.join(e, "Logs", t),
    temp: At.join(gh, t)
  };
}, e1 = (t) => {
  const e = wn.APPDATA || At.join(Dr, "AppData", "Roaming"), r = wn.LOCALAPPDATA || At.join(Dr, "AppData", "Local");
  return {
    // Data/config/cache/log are invented by me as Windows isn't opinionated about this
    data: At.join(r, t, "Data"),
    config: At.join(e, t, "Config"),
    cache: At.join(r, t, "Cache"),
    log: At.join(r, t, "Log"),
    temp: At.join(gh, t)
  };
}, r1 = (t) => {
  const e = At.basename(Dr);
  return {
    data: At.join(wn.XDG_DATA_HOME || At.join(Dr, ".local", "share"), t),
    config: At.join(wn.XDG_CONFIG_HOME || At.join(Dr, ".config"), t),
    cache: At.join(wn.XDG_CACHE_HOME || At.join(Dr, ".cache"), t),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: At.join(wn.XDG_STATE_HOME || At.join(Dr, ".local", "state"), t),
    temp: At.join(gh, e, t)
  };
};
function n1(t, { suffix: e = "nodejs" } = {}) {
  if (typeof t != "string")
    throw new TypeError(`Expected a string, got ${typeof t}`);
  return e && (t += `-${e}`), Xt.platform === "darwin" ? t1(t) : Xt.platform === "win32" ? e1(t) : r1(t);
}
const Mr = (t, e) => {
  const { onError: r } = e;
  return function(...i) {
    return t.apply(void 0, i).catch(r);
  };
}, dr = (t, e) => {
  const { onError: r } = e;
  return function(...i) {
    try {
      return t.apply(void 0, i);
    } catch (s) {
      return r(s);
    }
  };
}, i1 = 250, xr = (t, e) => {
  const { isRetriable: r } = e;
  return function(i) {
    const { timeout: s } = i, a = i.interval ?? i1, o = Date.now() + s;
    return function c(...h) {
      return t.apply(void 0, h).catch((f) => {
        if (!r(f) || Date.now() >= o)
          throw f;
        const u = Math.round(a * Math.random());
        return u > 0 ? new Promise((d) => setTimeout(d, u)).then(() => c.apply(void 0, h)) : c.apply(void 0, h);
      });
    };
  };
}, kr = (t, e) => {
  const { isRetriable: r } = e;
  return function(i) {
    const { timeout: s } = i, a = Date.now() + s;
    return function(...c) {
      for (; ; )
        try {
          return t.apply(void 0, c);
        } catch (h) {
          if (!r(h) || Date.now() >= a)
            throw h;
          continue;
        }
    };
  };
}, _n = {
  /* API */
  isChangeErrorOk: (t) => {
    if (!_n.isNodeError(t))
      return !1;
    const { code: e } = t;
    return e === "ENOSYS" || !s1 && (e === "EINVAL" || e === "EPERM");
  },
  isNodeError: (t) => t instanceof Error,
  isRetriableError: (t) => {
    if (!_n.isNodeError(t))
      return !1;
    const { code: e } = t;
    return e === "EMFILE" || e === "ENFILE" || e === "EAGAIN" || e === "EBUSY" || e === "EACCESS" || e === "EACCES" || e === "EACCS" || e === "EPERM";
  },
  onChangeError: (t) => {
    if (!_n.isNodeError(t))
      throw t;
    if (!_n.isChangeErrorOk(t))
      throw t;
  }
}, Ei = {
  onError: _n.onChangeError
}, De = {
  onError: () => {
  }
}, s1 = Xt.getuid ? !Xt.getuid() : !1, fe = {
  isRetriable: _n.isRetriableError
}, pe = {
  attempt: {
    /* ASYNC */
    chmod: Mr(ue($t.chmod), Ei),
    chown: Mr(ue($t.chown), Ei),
    close: Mr(ue($t.close), De),
    fsync: Mr(ue($t.fsync), De),
    mkdir: Mr(ue($t.mkdir), De),
    realpath: Mr(ue($t.realpath), De),
    stat: Mr(ue($t.stat), De),
    unlink: Mr(ue($t.unlink), De),
    /* SYNC */
    chmodSync: dr($t.chmodSync, Ei),
    chownSync: dr($t.chownSync, Ei),
    closeSync: dr($t.closeSync, De),
    existsSync: dr($t.existsSync, De),
    fsyncSync: dr($t.fsync, De),
    mkdirSync: dr($t.mkdirSync, De),
    realpathSync: dr($t.realpathSync, De),
    statSync: dr($t.statSync, De),
    unlinkSync: dr($t.unlinkSync, De)
  },
  retry: {
    /* ASYNC */
    close: xr(ue($t.close), fe),
    fsync: xr(ue($t.fsync), fe),
    open: xr(ue($t.open), fe),
    readFile: xr(ue($t.readFile), fe),
    rename: xr(ue($t.rename), fe),
    stat: xr(ue($t.stat), fe),
    write: xr(ue($t.write), fe),
    writeFile: xr(ue($t.writeFile), fe),
    /* SYNC */
    closeSync: kr($t.closeSync, fe),
    fsyncSync: kr($t.fsyncSync, fe),
    openSync: kr($t.openSync, fe),
    readFileSync: kr($t.readFileSync, fe),
    renameSync: kr($t.renameSync, fe),
    statSync: kr($t.statSync, fe),
    writeSync: kr($t.writeSync, fe),
    writeFileSync: kr($t.writeFileSync, fe)
  }
}, a1 = "utf8", Qh = 438, o1 = 511, c1 = {}, h1 = Xt.geteuid ? Xt.geteuid() : -1, l1 = Xt.getegid ? Xt.getegid() : -1, u1 = 1e3, f1 = !!Xt.getuid;
Xt.getuid && Xt.getuid();
const tl = 128, d1 = (t) => t instanceof Error && "code" in t, el = (t) => typeof t == "string", xa = (t) => t === void 0, m1 = Xt.platform === "linux", dm = Xt.platform === "win32", wh = ["SIGHUP", "SIGINT", "SIGTERM"];
dm || wh.push("SIGALRM", "SIGABRT", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGUSR2", "SIGTRAP", "SIGSYS", "SIGQUIT", "SIGIOT");
m1 && wh.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
class p1 {
  /* CONSTRUCTOR */
  constructor() {
    this.callbacks = /* @__PURE__ */ new Set(), this.exited = !1, this.exit = (e) => {
      if (!this.exited) {
        this.exited = !0;
        for (const r of this.callbacks)
          r();
        e && (dm && e !== "SIGINT" && e !== "SIGTERM" && e !== "SIGKILL" ? Xt.kill(Xt.pid, "SIGTERM") : Xt.kill(Xt.pid, e));
      }
    }, this.hook = () => {
      Xt.once("exit", () => this.exit());
      for (const e of wh)
        try {
          Xt.once(e, () => this.exit(e));
        } catch {
        }
    }, this.register = (e) => (this.callbacks.add(e), () => {
      this.callbacks.delete(e);
    }), this.hook();
  }
}
const y1 = new p1(), g1 = y1.register, ye = {
  /* VARIABLES */
  store: {},
  // filePath => purge
  /* API */
  create: (t) => {
    const e = `000000${Math.floor(Math.random() * 16777215).toString(16)}`.slice(-6), i = `.tmp-${Date.now().toString().slice(-10)}${e}`;
    return `${t}${i}`;
  },
  get: (t, e, r = !0) => {
    const n = ye.truncate(e(t));
    return n in ye.store ? ye.get(t, e, r) : (ye.store[n] = r, [n, () => delete ye.store[n]]);
  },
  purge: (t) => {
    ye.store[t] && (delete ye.store[t], pe.attempt.unlink(t));
  },
  purgeSync: (t) => {
    ye.store[t] && (delete ye.store[t], pe.attempt.unlinkSync(t));
  },
  purgeSyncAll: () => {
    for (const t in ye.store)
      ye.purgeSync(t);
  },
  truncate: (t) => {
    const e = At.basename(t);
    if (e.length <= tl)
      return t;
    const r = /^(\.?)(.*?)((?:\.[^.]+)?(?:\.tmp-\d{10}[a-f0-9]{6})?)$/.exec(e);
    if (!r)
      return t;
    const n = e.length - tl;
    return `${t.slice(0, -e.length)}${r[1]}${r[2].slice(0, -n)}${r[3]}`;
  }
};
g1(ye.purgeSyncAll);
function mm(t, e, r = c1) {
  if (el(r))
    return mm(t, e, { encoding: r });
  const i = { timeout: r.timeout ?? u1 };
  let s = null, a = null, o = null;
  try {
    const c = pe.attempt.realpathSync(t), h = !!c;
    t = c || t, [a, s] = ye.get(t, r.tmpCreate || ye.create, r.tmpPurge !== !1);
    const f = f1 && xa(r.chown), u = xa(r.mode);
    if (h && (f || u)) {
      const l = pe.attempt.statSync(t);
      l && (r = { ...r }, f && (r.chown = { uid: l.uid, gid: l.gid }), u && (r.mode = l.mode));
    }
    if (!h) {
      const l = At.dirname(t);
      pe.attempt.mkdirSync(l, {
        mode: o1,
        recursive: !0
      });
    }
    o = pe.retry.openSync(i)(a, "w", r.mode || Qh), r.tmpCreated && r.tmpCreated(a), el(e) ? pe.retry.writeSync(i)(o, e, 0, r.encoding || a1) : xa(e) || pe.retry.writeSync(i)(o, e, 0, e.length, 0), r.fsync !== !1 && (r.fsyncWait !== !1 ? pe.retry.fsyncSync(i)(o) : pe.attempt.fsync(o)), pe.retry.closeSync(i)(o), o = null, r.chown && (r.chown.uid !== h1 || r.chown.gid !== l1) && pe.attempt.chownSync(a, r.chown.uid, r.chown.gid), r.mode && r.mode !== Qh && pe.attempt.chmodSync(a, r.mode);
    try {
      pe.retry.renameSync(i)(a, t);
    } catch (l) {
      if (!d1(l) || l.code !== "ENAMETOOLONG")
        throw l;
      pe.retry.renameSync(i)(a, ye.truncate(t));
    }
    s(), a = null;
  } finally {
    o && pe.attempt.closeSync(o), a && ye.purge(a);
  }
}
var ka = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function an(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
var bi = { exports: {} }, $a = {}, mr = {}, Zr = {}, Ia = {}, Pa = {}, Aa = {}, rl;
function Js() {
  return rl || (rl = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.regexpCode = t.getEsmExportName = t.getProperty = t.safeStringify = t.stringify = t.strConcat = t.addCodeArg = t.str = t._ = t.nil = t._Code = t.Name = t.IDENTIFIER = t._CodeOrName = void 0;
    class e {
    }
    t._CodeOrName = e, t.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
    class r extends e {
      constructor(p) {
        if (super(), !t.IDENTIFIER.test(p))
          throw new Error("CodeGen: name must be a valid identifier");
        this.str = p;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        return !1;
      }
      get names() {
        return { [this.str]: 1 };
      }
    }
    t.Name = r;
    class n extends e {
      constructor(p) {
        super(), this._items = typeof p == "string" ? [p] : p;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        if (this._items.length > 1)
          return !1;
        const p = this._items[0];
        return p === "" || p === '""';
      }
      get str() {
        var p;
        return (p = this._str) !== null && p !== void 0 ? p : this._str = this._items.reduce((E, _) => `${E}${_}`, "");
      }
      get names() {
        var p;
        return (p = this._names) !== null && p !== void 0 ? p : this._names = this._items.reduce((E, _) => (_ instanceof r && (E[_.str] = (E[_.str] || 0) + 1), E), {});
      }
    }
    t._Code = n, t.nil = new n("");
    function i(v, ...p) {
      const E = [v[0]];
      let _ = 0;
      for (; _ < p.length; )
        o(E, p[_]), E.push(v[++_]);
      return new n(E);
    }
    t._ = i;
    const s = new n("+");
    function a(v, ...p) {
      const E = [d(v[0])];
      let _ = 0;
      for (; _ < p.length; )
        E.push(s), o(E, p[_]), E.push(s, d(v[++_]));
      return c(E), new n(E);
    }
    t.str = a;
    function o(v, p) {
      p instanceof n ? v.push(...p._items) : p instanceof r ? v.push(p) : v.push(u(p));
    }
    t.addCodeArg = o;
    function c(v) {
      let p = 1;
      for (; p < v.length - 1; ) {
        if (v[p] === s) {
          const E = h(v[p - 1], v[p + 1]);
          if (E !== void 0) {
            v.splice(p - 1, 3, E);
            continue;
          }
          v[p++] = "+";
        }
        p++;
      }
    }
    function h(v, p) {
      if (p === '""')
        return v;
      if (v === '""')
        return p;
      if (typeof v == "string")
        return p instanceof r || v[v.length - 1] !== '"' ? void 0 : typeof p != "string" ? `${v.slice(0, -1)}${p}"` : p[0] === '"' ? v.slice(0, -1) + p.slice(1) : void 0;
      if (typeof p == "string" && p[0] === '"' && !(v instanceof r))
        return `"${v}${p.slice(1)}`;
    }
    function f(v, p) {
      return p.emptyStr() ? v : v.emptyStr() ? p : a`${v}${p}`;
    }
    t.strConcat = f;
    function u(v) {
      return typeof v == "number" || typeof v == "boolean" || v === null ? v : d(Array.isArray(v) ? v.join(",") : v);
    }
    function l(v) {
      return new n(d(v));
    }
    t.stringify = l;
    function d(v) {
      return JSON.stringify(v).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    t.safeStringify = d;
    function g(v) {
      return typeof v == "string" && t.IDENTIFIER.test(v) ? new n(`.${v}`) : i`[${v}]`;
    }
    t.getProperty = g;
    function w(v) {
      if (typeof v == "string" && t.IDENTIFIER.test(v))
        return new n(`${v}`);
      throw new Error(`CodeGen: invalid export name: ${v}, use explicit $id name mapping`);
    }
    t.getEsmExportName = w;
    function m(v) {
      return new n(v.toString());
    }
    t.regexpCode = m;
  })(Aa)), Aa;
}
var Na = {}, nl;
function il() {
  return nl || (nl = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.ValueScope = t.ValueScopeName = t.Scope = t.varKinds = t.UsedValueState = void 0;
    const e = Js();
    class r extends Error {
      constructor(h) {
        super(`CodeGen: "code" for ${h} not defined`), this.value = h.value;
      }
    }
    var n;
    (function(c) {
      c[c.Started = 0] = "Started", c[c.Completed = 1] = "Completed";
    })(n || (t.UsedValueState = n = {})), t.varKinds = {
      const: new e.Name("const"),
      let: new e.Name("let"),
      var: new e.Name("var")
    };
    class i {
      constructor({ prefixes: h, parent: f } = {}) {
        this._names = {}, this._prefixes = h, this._parent = f;
      }
      toName(h) {
        return h instanceof e.Name ? h : this.name(h);
      }
      name(h) {
        return new e.Name(this._newName(h));
      }
      _newName(h) {
        const f = this._names[h] || this._nameGroup(h);
        return `${h}${f.index++}`;
      }
      _nameGroup(h) {
        var f, u;
        if (!((u = (f = this._parent) === null || f === void 0 ? void 0 : f._prefixes) === null || u === void 0) && u.has(h) || this._prefixes && !this._prefixes.has(h))
          throw new Error(`CodeGen: prefix "${h}" is not allowed in this scope`);
        return this._names[h] = { prefix: h, index: 0 };
      }
    }
    t.Scope = i;
    class s extends e.Name {
      constructor(h, f) {
        super(f), this.prefix = h;
      }
      setValue(h, { property: f, itemIndex: u }) {
        this.value = h, this.scopePath = (0, e._)`.${new e.Name(f)}[${u}]`;
      }
    }
    t.ValueScopeName = s;
    const a = (0, e._)`\n`;
    class o extends i {
      constructor(h) {
        super(h), this._values = {}, this._scope = h.scope, this.opts = { ...h, _n: h.lines ? a : e.nil };
      }
      get() {
        return this._scope;
      }
      name(h) {
        return new s(h, this._newName(h));
      }
      value(h, f) {
        var u;
        if (f.ref === void 0)
          throw new Error("CodeGen: ref must be passed in value");
        const l = this.toName(h), { prefix: d } = l, g = (u = f.key) !== null && u !== void 0 ? u : f.ref;
        let w = this._values[d];
        if (w) {
          const p = w.get(g);
          if (p)
            return p;
        } else
          w = this._values[d] = /* @__PURE__ */ new Map();
        w.set(g, l);
        const m = this._scope[d] || (this._scope[d] = []), v = m.length;
        return m[v] = f.ref, l.setValue(f, { property: d, itemIndex: v }), l;
      }
      getValue(h, f) {
        const u = this._values[h];
        if (u)
          return u.get(f);
      }
      scopeRefs(h, f = this._values) {
        return this._reduceValues(f, (u) => {
          if (u.scopePath === void 0)
            throw new Error(`CodeGen: name "${u}" has no value`);
          return (0, e._)`${h}${u.scopePath}`;
        });
      }
      scopeCode(h = this._values, f, u) {
        return this._reduceValues(h, (l) => {
          if (l.value === void 0)
            throw new Error(`CodeGen: name "${l}" has no value`);
          return l.value.code;
        }, f, u);
      }
      _reduceValues(h, f, u = {}, l) {
        let d = e.nil;
        for (const g in h) {
          const w = h[g];
          if (!w)
            continue;
          const m = u[g] = u[g] || /* @__PURE__ */ new Map();
          w.forEach((v) => {
            if (m.has(v))
              return;
            m.set(v, n.Started);
            let p = f(v);
            if (p) {
              const E = this.opts.es5 ? t.varKinds.var : t.varKinds.const;
              d = (0, e._)`${d}${E} ${v} = ${p};${this.opts._n}`;
            } else if (p = l?.(v))
              d = (0, e._)`${d}${p}${this.opts._n}`;
            else
              throw new r(v);
            m.set(v, n.Completed);
          });
        }
        return d;
      }
    }
    t.ValueScope = o;
  })(Na)), Na;
}
var sl;
function kt() {
  return sl || (sl = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.or = t.and = t.not = t.CodeGen = t.operators = t.varKinds = t.ValueScopeName = t.ValueScope = t.Scope = t.Name = t.regexpCode = t.stringify = t.getProperty = t.nil = t.strConcat = t.str = t._ = void 0;
    const e = Js(), r = il();
    var n = Js();
    Object.defineProperty(t, "_", { enumerable: !0, get: function() {
      return n._;
    } }), Object.defineProperty(t, "str", { enumerable: !0, get: function() {
      return n.str;
    } }), Object.defineProperty(t, "strConcat", { enumerable: !0, get: function() {
      return n.strConcat;
    } }), Object.defineProperty(t, "nil", { enumerable: !0, get: function() {
      return n.nil;
    } }), Object.defineProperty(t, "getProperty", { enumerable: !0, get: function() {
      return n.getProperty;
    } }), Object.defineProperty(t, "stringify", { enumerable: !0, get: function() {
      return n.stringify;
    } }), Object.defineProperty(t, "regexpCode", { enumerable: !0, get: function() {
      return n.regexpCode;
    } }), Object.defineProperty(t, "Name", { enumerable: !0, get: function() {
      return n.Name;
    } });
    var i = il();
    Object.defineProperty(t, "Scope", { enumerable: !0, get: function() {
      return i.Scope;
    } }), Object.defineProperty(t, "ValueScope", { enumerable: !0, get: function() {
      return i.ValueScope;
    } }), Object.defineProperty(t, "ValueScopeName", { enumerable: !0, get: function() {
      return i.ValueScopeName;
    } }), Object.defineProperty(t, "varKinds", { enumerable: !0, get: function() {
      return i.varKinds;
    } }), t.operators = {
      GT: new e._Code(">"),
      GTE: new e._Code(">="),
      LT: new e._Code("<"),
      LTE: new e._Code("<="),
      EQ: new e._Code("==="),
      NEQ: new e._Code("!=="),
      NOT: new e._Code("!"),
      OR: new e._Code("||"),
      AND: new e._Code("&&"),
      ADD: new e._Code("+")
    };
    class s {
      optimizeNodes() {
        return this;
      }
      optimizeNames(A, P) {
        return this;
      }
    }
    class a extends s {
      constructor(A, P, U) {
        super(), this.varKind = A, this.name = P, this.rhs = U;
      }
      render({ es5: A, _n: P }) {
        const U = A ? r.varKinds.var : this.varKind, K = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
        return `${U} ${this.name}${K};` + P;
      }
      optimizeNames(A, P) {
        if (A[this.name.str])
          return this.rhs && (this.rhs = I(this.rhs, A, P)), this;
      }
      get names() {
        return this.rhs instanceof e._CodeOrName ? this.rhs.names : {};
      }
    }
    class o extends s {
      constructor(A, P, U) {
        super(), this.lhs = A, this.rhs = P, this.sideEffects = U;
      }
      render({ _n: A }) {
        return `${this.lhs} = ${this.rhs};` + A;
      }
      optimizeNames(A, P) {
        if (!(this.lhs instanceof e.Name && !A[this.lhs.str] && !this.sideEffects))
          return this.rhs = I(this.rhs, A, P), this;
      }
      get names() {
        const A = this.lhs instanceof e.Name ? {} : { ...this.lhs.names };
        return T(A, this.rhs);
      }
    }
    class c extends o {
      constructor(A, P, U, K) {
        super(A, U, K), this.op = P;
      }
      render({ _n: A }) {
        return `${this.lhs} ${this.op}= ${this.rhs};` + A;
      }
    }
    class h extends s {
      constructor(A) {
        super(), this.label = A, this.names = {};
      }
      render({ _n: A }) {
        return `${this.label}:` + A;
      }
    }
    class f extends s {
      constructor(A) {
        super(), this.label = A, this.names = {};
      }
      render({ _n: A }) {
        return `break${this.label ? ` ${this.label}` : ""};` + A;
      }
    }
    class u extends s {
      constructor(A) {
        super(), this.error = A;
      }
      render({ _n: A }) {
        return `throw ${this.error};` + A;
      }
      get names() {
        return this.error.names;
      }
    }
    class l extends s {
      constructor(A) {
        super(), this.code = A;
      }
      render({ _n: A }) {
        return `${this.code};` + A;
      }
      optimizeNodes() {
        return `${this.code}` ? this : void 0;
      }
      optimizeNames(A, P) {
        return this.code = I(this.code, A, P), this;
      }
      get names() {
        return this.code instanceof e._CodeOrName ? this.code.names : {};
      }
    }
    class d extends s {
      constructor(A = []) {
        super(), this.nodes = A;
      }
      render(A) {
        return this.nodes.reduce((P, U) => P + U.render(A), "");
      }
      optimizeNodes() {
        const { nodes: A } = this;
        let P = A.length;
        for (; P--; ) {
          const U = A[P].optimizeNodes();
          Array.isArray(U) ? A.splice(P, 1, ...U) : U ? A[P] = U : A.splice(P, 1);
        }
        return A.length > 0 ? this : void 0;
      }
      optimizeNames(A, P) {
        const { nodes: U } = this;
        let K = U.length;
        for (; K--; ) {
          const J = U[K];
          J.optimizeNames(A, P) || (N(A, J.names), U.splice(K, 1));
        }
        return U.length > 0 ? this : void 0;
      }
      get names() {
        return this.nodes.reduce((A, P) => O(A, P.names), {});
      }
    }
    class g extends d {
      render(A) {
        return "{" + A._n + super.render(A) + "}" + A._n;
      }
    }
    class w extends d {
    }
    class m extends g {
    }
    m.kind = "else";
    class v extends g {
      constructor(A, P) {
        super(P), this.condition = A;
      }
      render(A) {
        let P = `if(${this.condition})` + super.render(A);
        return this.else && (P += "else " + this.else.render(A)), P;
      }
      optimizeNodes() {
        super.optimizeNodes();
        const A = this.condition;
        if (A === !0)
          return this.nodes;
        let P = this.else;
        if (P) {
          const U = P.optimizeNodes();
          P = this.else = Array.isArray(U) ? new m(U) : U;
        }
        if (P)
          return A === !1 ? P instanceof v ? P : P.nodes : this.nodes.length ? this : new v(j(A), P instanceof v ? [P] : P.nodes);
        if (!(A === !1 || !this.nodes.length))
          return this;
      }
      optimizeNames(A, P) {
        var U;
        if (this.else = (U = this.else) === null || U === void 0 ? void 0 : U.optimizeNames(A, P), !!(super.optimizeNames(A, P) || this.else))
          return this.condition = I(this.condition, A, P), this;
      }
      get names() {
        const A = super.names;
        return T(A, this.condition), this.else && O(A, this.else.names), A;
      }
    }
    v.kind = "if";
    class p extends g {
    }
    p.kind = "for";
    class E extends p {
      constructor(A) {
        super(), this.iteration = A;
      }
      render(A) {
        return `for(${this.iteration})` + super.render(A);
      }
      optimizeNames(A, P) {
        if (super.optimizeNames(A, P))
          return this.iteration = I(this.iteration, A, P), this;
      }
      get names() {
        return O(super.names, this.iteration.names);
      }
    }
    class _ extends p {
      constructor(A, P, U, K) {
        super(), this.varKind = A, this.name = P, this.from = U, this.to = K;
      }
      render(A) {
        const P = A.es5 ? r.varKinds.var : this.varKind, { name: U, from: K, to: J } = this;
        return `for(${P} ${U}=${K}; ${U}<${J}; ${U}++)` + super.render(A);
      }
      get names() {
        const A = T(super.names, this.from);
        return T(A, this.to);
      }
    }
    class y extends p {
      constructor(A, P, U, K) {
        super(), this.loop = A, this.varKind = P, this.name = U, this.iterable = K;
      }
      render(A) {
        return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(A);
      }
      optimizeNames(A, P) {
        if (super.optimizeNames(A, P))
          return this.iterable = I(this.iterable, A, P), this;
      }
      get names() {
        return O(super.names, this.iterable.names);
      }
    }
    class b extends g {
      constructor(A, P, U) {
        super(), this.name = A, this.args = P, this.async = U;
      }
      render(A) {
        return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(A);
      }
    }
    b.kind = "func";
    class S extends d {
      render(A) {
        return "return " + super.render(A);
      }
    }
    S.kind = "return";
    class x extends g {
      render(A) {
        let P = "try" + super.render(A);
        return this.catch && (P += this.catch.render(A)), this.finally && (P += this.finally.render(A)), P;
      }
      optimizeNodes() {
        var A, P;
        return super.optimizeNodes(), (A = this.catch) === null || A === void 0 || A.optimizeNodes(), (P = this.finally) === null || P === void 0 || P.optimizeNodes(), this;
      }
      optimizeNames(A, P) {
        var U, K;
        return super.optimizeNames(A, P), (U = this.catch) === null || U === void 0 || U.optimizeNames(A, P), (K = this.finally) === null || K === void 0 || K.optimizeNames(A, P), this;
      }
      get names() {
        const A = super.names;
        return this.catch && O(A, this.catch.names), this.finally && O(A, this.finally.names), A;
      }
    }
    class M extends g {
      constructor(A) {
        super(), this.error = A;
      }
      render(A) {
        return `catch(${this.error})` + super.render(A);
      }
    }
    M.kind = "catch";
    class k extends g {
      render(A) {
        return "finally" + super.render(A);
      }
    }
    k.kind = "finally";
    class $ {
      constructor(A, P = {}) {
        this._values = {}, this._blockStarts = [], this._constants = {}, this.opts = { ...P, _n: P.lines ? `
` : "" }, this._extScope = A, this._scope = new r.Scope({ parent: A }), this._nodes = [new w()];
      }
      toString() {
        return this._root.render(this.opts);
      }
      // returns unique name in the internal scope
      name(A) {
        return this._scope.name(A);
      }
      // reserves unique name in the external scope
      scopeName(A) {
        return this._extScope.name(A);
      }
      // reserves unique name in the external scope and assigns value to it
      scopeValue(A, P) {
        const U = this._extScope.value(A, P);
        return (this._values[U.prefix] || (this._values[U.prefix] = /* @__PURE__ */ new Set())).add(U), U;
      }
      getScopeValue(A, P) {
        return this._extScope.getValue(A, P);
      }
      // return code that assigns values in the external scope to the names that are used internally
      // (same names that were returned by gen.scopeName or gen.scopeValue)
      scopeRefs(A) {
        return this._extScope.scopeRefs(A, this._values);
      }
      scopeCode() {
        return this._extScope.scopeCode(this._values);
      }
      _def(A, P, U, K) {
        const J = this._scope.toName(P);
        return U !== void 0 && K && (this._constants[J.str] = U), this._leafNode(new a(A, J, U)), J;
      }
      // `const` declaration (`var` in es5 mode)
      const(A, P, U) {
        return this._def(r.varKinds.const, A, P, U);
      }
      // `let` declaration with optional assignment (`var` in es5 mode)
      let(A, P, U) {
        return this._def(r.varKinds.let, A, P, U);
      }
      // `var` declaration with optional assignment
      var(A, P, U) {
        return this._def(r.varKinds.var, A, P, U);
      }
      // assignment code
      assign(A, P, U) {
        return this._leafNode(new o(A, P, U));
      }
      // `+=` code
      add(A, P) {
        return this._leafNode(new c(A, t.operators.ADD, P));
      }
      // appends passed SafeExpr to code or executes Block
      code(A) {
        return typeof A == "function" ? A() : A !== e.nil && this._leafNode(new l(A)), this;
      }
      // returns code for object literal for the passed argument list of key-value pairs
      object(...A) {
        const P = ["{"];
        for (const [U, K] of A)
          P.length > 1 && P.push(","), P.push(U), (U !== K || this.opts.es5) && (P.push(":"), (0, e.addCodeArg)(P, K));
        return P.push("}"), new e._Code(P);
      }
      // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
      if(A, P, U) {
        if (this._blockNode(new v(A)), P && U)
          this.code(P).else().code(U).endIf();
        else if (P)
          this.code(P).endIf();
        else if (U)
          throw new Error('CodeGen: "else" body without "then" body');
        return this;
      }
      // `else if` clause - invalid without `if` or after `else` clauses
      elseIf(A) {
        return this._elseNode(new v(A));
      }
      // `else` clause - only valid after `if` or `else if` clauses
      else() {
        return this._elseNode(new m());
      }
      // end `if` statement (needed if gen.if was used only with condition)
      endIf() {
        return this._endBlockNode(v, m);
      }
      _for(A, P) {
        return this._blockNode(A), P && this.code(P).endFor(), this;
      }
      // a generic `for` clause (or statement if `forBody` is passed)
      for(A, P) {
        return this._for(new E(A), P);
      }
      // `for` statement for a range of values
      forRange(A, P, U, K, J = this.opts.es5 ? r.varKinds.var : r.varKinds.let) {
        const et = this._scope.toName(A);
        return this._for(new _(J, et, P, U), () => K(et));
      }
      // `for-of` statement (in es5 mode replace with a normal for loop)
      forOf(A, P, U, K = r.varKinds.const) {
        const J = this._scope.toName(A);
        if (this.opts.es5) {
          const et = P instanceof e.Name ? P : this.var("_arr", P);
          return this.forRange("_i", 0, (0, e._)`${et}.length`, (rt) => {
            this.var(J, (0, e._)`${et}[${rt}]`), U(J);
          });
        }
        return this._for(new y("of", K, J, P), () => U(J));
      }
      // `for-in` statement.
      // With option `ownProperties` replaced with a `for-of` loop for object keys
      forIn(A, P, U, K = this.opts.es5 ? r.varKinds.var : r.varKinds.const) {
        if (this.opts.ownProperties)
          return this.forOf(A, (0, e._)`Object.keys(${P})`, U);
        const J = this._scope.toName(A);
        return this._for(new y("in", K, J, P), () => U(J));
      }
      // end `for` loop
      endFor() {
        return this._endBlockNode(p);
      }
      // `label` statement
      label(A) {
        return this._leafNode(new h(A));
      }
      // `break` statement
      break(A) {
        return this._leafNode(new f(A));
      }
      // `return` statement
      return(A) {
        const P = new S();
        if (this._blockNode(P), this.code(A), P.nodes.length !== 1)
          throw new Error('CodeGen: "return" should have one node');
        return this._endBlockNode(S);
      }
      // `try` statement
      try(A, P, U) {
        if (!P && !U)
          throw new Error('CodeGen: "try" without "catch" and "finally"');
        const K = new x();
        if (this._blockNode(K), this.code(A), P) {
          const J = this.name("e");
          this._currNode = K.catch = new M(J), P(J);
        }
        return U && (this._currNode = K.finally = new k(), this.code(U)), this._endBlockNode(M, k);
      }
      // `throw` statement
      throw(A) {
        return this._leafNode(new u(A));
      }
      // start self-balancing block
      block(A, P) {
        return this._blockStarts.push(this._nodes.length), A && this.code(A).endBlock(P), this;
      }
      // end the current self-balancing block
      endBlock(A) {
        const P = this._blockStarts.pop();
        if (P === void 0)
          throw new Error("CodeGen: not in self-balancing block");
        const U = this._nodes.length - P;
        if (U < 0 || A !== void 0 && U !== A)
          throw new Error(`CodeGen: wrong number of nodes: ${U} vs ${A} expected`);
        return this._nodes.length = P, this;
      }
      // `function` heading (or definition if funcBody is passed)
      func(A, P = e.nil, U, K) {
        return this._blockNode(new b(A, P, U)), K && this.code(K).endFunc(), this;
      }
      // end function definition
      endFunc() {
        return this._endBlockNode(b);
      }
      optimize(A = 1) {
        for (; A-- > 0; )
          this._root.optimizeNodes(), this._root.optimizeNames(this._root.names, this._constants);
      }
      _leafNode(A) {
        return this._currNode.nodes.push(A), this;
      }
      _blockNode(A) {
        this._currNode.nodes.push(A), this._nodes.push(A);
      }
      _endBlockNode(A, P) {
        const U = this._currNode;
        if (U instanceof A || P && U instanceof P)
          return this._nodes.pop(), this;
        throw new Error(`CodeGen: not in block "${P ? `${A.kind}/${P.kind}` : A.kind}"`);
      }
      _elseNode(A) {
        const P = this._currNode;
        if (!(P instanceof v))
          throw new Error('CodeGen: "else" without "if"');
        return this._currNode = P.else = A, this;
      }
      get _root() {
        return this._nodes[0];
      }
      get _currNode() {
        const A = this._nodes;
        return A[A.length - 1];
      }
      set _currNode(A) {
        const P = this._nodes;
        P[P.length - 1] = A;
      }
    }
    t.CodeGen = $;
    function O(L, A) {
      for (const P in A)
        L[P] = (L[P] || 0) + (A[P] || 0);
      return L;
    }
    function T(L, A) {
      return A instanceof e._CodeOrName ? O(L, A.names) : L;
    }
    function I(L, A, P) {
      if (L instanceof e.Name)
        return U(L);
      if (!K(L))
        return L;
      return new e._Code(L._items.reduce((J, et) => (et instanceof e.Name && (et = U(et)), et instanceof e._Code ? J.push(...et._items) : J.push(et), J), []));
      function U(J) {
        const et = P[J.str];
        return et === void 0 || A[J.str] !== 1 ? J : (delete A[J.str], et);
      }
      function K(J) {
        return J instanceof e._Code && J._items.some((et) => et instanceof e.Name && A[et.str] === 1 && P[et.str] !== void 0);
      }
    }
    function N(L, A) {
      for (const P in A)
        L[P] = (L[P] || 0) - (A[P] || 0);
    }
    function j(L) {
      return typeof L == "boolean" || typeof L == "number" || L === null ? !L : (0, e._)`!${G(L)}`;
    }
    t.not = j;
    const C = D(t.operators.AND);
    function F(...L) {
      return L.reduce(C);
    }
    t.and = F;
    const q = D(t.operators.OR);
    function R(...L) {
      return L.reduce(q);
    }
    t.or = R;
    function D(L) {
      return (A, P) => A === e.nil ? P : P === e.nil ? A : (0, e._)`${G(A)} ${L} ${G(P)}`;
    }
    function G(L) {
      return L instanceof e.Name ? L : (0, e._)`(${L})`;
    }
  })(Pa)), Pa;
}
var Nt = {}, al;
function Rt() {
  if (al) return Nt;
  al = 1, Object.defineProperty(Nt, "__esModule", { value: !0 }), Nt.checkStrictMode = Nt.getErrorPath = Nt.Type = Nt.useFunc = Nt.setEvaluated = Nt.evaluatedPropsToName = Nt.mergeEvaluated = Nt.eachItem = Nt.unescapeJsonPointer = Nt.escapeJsonPointer = Nt.escapeFragment = Nt.unescapeFragment = Nt.schemaRefOrVal = Nt.schemaHasRulesButRef = Nt.schemaHasRules = Nt.checkUnknownRules = Nt.alwaysValidSchema = Nt.toHash = void 0;
  const t = kt(), e = Js();
  function r(y) {
    const b = {};
    for (const S of y)
      b[S] = !0;
    return b;
  }
  Nt.toHash = r;
  function n(y, b) {
    return typeof b == "boolean" ? b : Object.keys(b).length === 0 ? !0 : (i(y, b), !s(b, y.self.RULES.all));
  }
  Nt.alwaysValidSchema = n;
  function i(y, b = y.schema) {
    const { opts: S, self: x } = y;
    if (!S.strictSchema || typeof b == "boolean")
      return;
    const M = x.RULES.keywords;
    for (const k in b)
      M[k] || _(y, `unknown keyword: "${k}"`);
  }
  Nt.checkUnknownRules = i;
  function s(y, b) {
    if (typeof y == "boolean")
      return !y;
    for (const S in y)
      if (b[S])
        return !0;
    return !1;
  }
  Nt.schemaHasRules = s;
  function a(y, b) {
    if (typeof y == "boolean")
      return !y;
    for (const S in y)
      if (S !== "$ref" && b.all[S])
        return !0;
    return !1;
  }
  Nt.schemaHasRulesButRef = a;
  function o({ topSchemaRef: y, schemaPath: b }, S, x, M) {
    if (!M) {
      if (typeof S == "number" || typeof S == "boolean")
        return S;
      if (typeof S == "string")
        return (0, t._)`${S}`;
    }
    return (0, t._)`${y}${b}${(0, t.getProperty)(x)}`;
  }
  Nt.schemaRefOrVal = o;
  function c(y) {
    return u(decodeURIComponent(y));
  }
  Nt.unescapeFragment = c;
  function h(y) {
    return encodeURIComponent(f(y));
  }
  Nt.escapeFragment = h;
  function f(y) {
    return typeof y == "number" ? `${y}` : y.replace(/~/g, "~0").replace(/\//g, "~1");
  }
  Nt.escapeJsonPointer = f;
  function u(y) {
    return y.replace(/~1/g, "/").replace(/~0/g, "~");
  }
  Nt.unescapeJsonPointer = u;
  function l(y, b) {
    if (Array.isArray(y))
      for (const S of y)
        b(S);
    else
      b(y);
  }
  Nt.eachItem = l;
  function d({ mergeNames: y, mergeToName: b, mergeValues: S, resultToName: x }) {
    return (M, k, $, O) => {
      const T = $ === void 0 ? k : $ instanceof t.Name ? (k instanceof t.Name ? y(M, k, $) : b(M, k, $), $) : k instanceof t.Name ? (b(M, $, k), k) : S(k, $);
      return O === t.Name && !(T instanceof t.Name) ? x(M, T) : T;
    };
  }
  Nt.mergeEvaluated = {
    props: d({
      mergeNames: (y, b, S) => y.if((0, t._)`${S} !== true && ${b} !== undefined`, () => {
        y.if((0, t._)`${b} === true`, () => y.assign(S, !0), () => y.assign(S, (0, t._)`${S} || {}`).code((0, t._)`Object.assign(${S}, ${b})`));
      }),
      mergeToName: (y, b, S) => y.if((0, t._)`${S} !== true`, () => {
        b === !0 ? y.assign(S, !0) : (y.assign(S, (0, t._)`${S} || {}`), w(y, S, b));
      }),
      mergeValues: (y, b) => y === !0 ? !0 : { ...y, ...b },
      resultToName: g
    }),
    items: d({
      mergeNames: (y, b, S) => y.if((0, t._)`${S} !== true && ${b} !== undefined`, () => y.assign(S, (0, t._)`${b} === true ? true : ${S} > ${b} ? ${S} : ${b}`)),
      mergeToName: (y, b, S) => y.if((0, t._)`${S} !== true`, () => y.assign(S, b === !0 ? !0 : (0, t._)`${S} > ${b} ? ${S} : ${b}`)),
      mergeValues: (y, b) => y === !0 ? !0 : Math.max(y, b),
      resultToName: (y, b) => y.var("items", b)
    })
  };
  function g(y, b) {
    if (b === !0)
      return y.var("props", !0);
    const S = y.var("props", (0, t._)`{}`);
    return b !== void 0 && w(y, S, b), S;
  }
  Nt.evaluatedPropsToName = g;
  function w(y, b, S) {
    Object.keys(S).forEach((x) => y.assign((0, t._)`${b}${(0, t.getProperty)(x)}`, !0));
  }
  Nt.setEvaluated = w;
  const m = {};
  function v(y, b) {
    return y.scopeValue("func", {
      ref: b,
      code: m[b.code] || (m[b.code] = new e._Code(b.code))
    });
  }
  Nt.useFunc = v;
  var p;
  (function(y) {
    y[y.Num = 0] = "Num", y[y.Str = 1] = "Str";
  })(p || (Nt.Type = p = {}));
  function E(y, b, S) {
    if (y instanceof t.Name) {
      const x = b === p.Num;
      return S ? x ? (0, t._)`"[" + ${y} + "]"` : (0, t._)`"['" + ${y} + "']"` : x ? (0, t._)`"/" + ${y}` : (0, t._)`"/" + ${y}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
    }
    return S ? (0, t.getProperty)(y).toString() : "/" + f(y);
  }
  Nt.getErrorPath = E;
  function _(y, b, S = y.opts.strictSchema) {
    if (S) {
      if (b = `strict mode: ${b}`, S === !0)
        throw new Error(b);
      y.self.logger.warn(b);
    }
  }
  return Nt.checkStrictMode = _, Nt;
}
var Si = {}, ol;
function Ye() {
  if (ol) return Si;
  ol = 1, Object.defineProperty(Si, "__esModule", { value: !0 });
  const t = kt(), e = {
    // validation function arguments
    data: new t.Name("data"),
    // data passed to validation function
    // args passed from referencing schema
    valCxt: new t.Name("valCxt"),
    // validation/data context - should not be used directly, it is destructured to the names below
    instancePath: new t.Name("instancePath"),
    parentData: new t.Name("parentData"),
    parentDataProperty: new t.Name("parentDataProperty"),
    rootData: new t.Name("rootData"),
    // root data - same as the data passed to the first/top validation function
    dynamicAnchors: new t.Name("dynamicAnchors"),
    // used to support recursiveRef and dynamicRef
    // function scoped variables
    vErrors: new t.Name("vErrors"),
    // null or array of validation errors
    errors: new t.Name("errors"),
    // counter of validation errors
    this: new t.Name("this"),
    // "globals"
    self: new t.Name("self"),
    scope: new t.Name("scope"),
    // JTD serialize/parse name for JSON string and position
    json: new t.Name("json"),
    jsonPos: new t.Name("jsonPos"),
    jsonLen: new t.Name("jsonLen"),
    jsonPart: new t.Name("jsonPart")
  };
  return Si.default = e, Si;
}
var cl;
function ua() {
  return cl || (cl = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.extendErrors = t.resetErrorsCount = t.reportExtraError = t.reportError = t.keyword$DataError = t.keywordError = void 0;
    const e = kt(), r = Rt(), n = Ye();
    t.keywordError = {
      message: ({ keyword: m }) => (0, e.str)`must pass "${m}" keyword validation`
    }, t.keyword$DataError = {
      message: ({ keyword: m, schemaType: v }) => v ? (0, e.str)`"${m}" keyword must be ${v} ($data)` : (0, e.str)`"${m}" keyword is invalid ($data)`
    };
    function i(m, v = t.keywordError, p, E) {
      const { it: _ } = m, { gen: y, compositeRule: b, allErrors: S } = _, x = u(m, v, p);
      E ?? (b || S) ? c(y, x) : h(_, (0, e._)`[${x}]`);
    }
    t.reportError = i;
    function s(m, v = t.keywordError, p) {
      const { it: E } = m, { gen: _, compositeRule: y, allErrors: b } = E, S = u(m, v, p);
      c(_, S), y || b || h(E, n.default.vErrors);
    }
    t.reportExtraError = s;
    function a(m, v) {
      m.assign(n.default.errors, v), m.if((0, e._)`${n.default.vErrors} !== null`, () => m.if(v, () => m.assign((0, e._)`${n.default.vErrors}.length`, v), () => m.assign(n.default.vErrors, null)));
    }
    t.resetErrorsCount = a;
    function o({ gen: m, keyword: v, schemaValue: p, data: E, errsCount: _, it: y }) {
      if (_ === void 0)
        throw new Error("ajv implementation error");
      const b = m.name("err");
      m.forRange("i", _, n.default.errors, (S) => {
        m.const(b, (0, e._)`${n.default.vErrors}[${S}]`), m.if((0, e._)`${b}.instancePath === undefined`, () => m.assign((0, e._)`${b}.instancePath`, (0, e.strConcat)(n.default.instancePath, y.errorPath))), m.assign((0, e._)`${b}.schemaPath`, (0, e.str)`${y.errSchemaPath}/${v}`), y.opts.verbose && (m.assign((0, e._)`${b}.schema`, p), m.assign((0, e._)`${b}.data`, E));
      });
    }
    t.extendErrors = o;
    function c(m, v) {
      const p = m.const("err", v);
      m.if((0, e._)`${n.default.vErrors} === null`, () => m.assign(n.default.vErrors, (0, e._)`[${p}]`), (0, e._)`${n.default.vErrors}.push(${p})`), m.code((0, e._)`${n.default.errors}++`);
    }
    function h(m, v) {
      const { gen: p, validateName: E, schemaEnv: _ } = m;
      _.$async ? p.throw((0, e._)`new ${m.ValidationError}(${v})`) : (p.assign((0, e._)`${E}.errors`, v), p.return(!1));
    }
    const f = {
      keyword: new e.Name("keyword"),
      schemaPath: new e.Name("schemaPath"),
      // also used in JTD errors
      params: new e.Name("params"),
      propertyName: new e.Name("propertyName"),
      message: new e.Name("message"),
      schema: new e.Name("schema"),
      parentSchema: new e.Name("parentSchema")
    };
    function u(m, v, p) {
      const { createErrors: E } = m.it;
      return E === !1 ? (0, e._)`{}` : l(m, v, p);
    }
    function l(m, v, p = {}) {
      const { gen: E, it: _ } = m, y = [
        d(_, p),
        g(m, p)
      ];
      return w(m, v, y), E.object(...y);
    }
    function d({ errorPath: m }, { instancePath: v }) {
      const p = v ? (0, e.str)`${m}${(0, r.getErrorPath)(v, r.Type.Str)}` : m;
      return [n.default.instancePath, (0, e.strConcat)(n.default.instancePath, p)];
    }
    function g({ keyword: m, it: { errSchemaPath: v } }, { schemaPath: p, parentSchema: E }) {
      let _ = E ? v : (0, e.str)`${v}/${m}`;
      return p && (_ = (0, e.str)`${_}${(0, r.getErrorPath)(p, r.Type.Str)}`), [f.schemaPath, _];
    }
    function w(m, { params: v, message: p }, E) {
      const { keyword: _, data: y, schemaValue: b, it: S } = m, { opts: x, propertyName: M, topSchemaRef: k, schemaPath: $ } = S;
      E.push([f.keyword, _], [f.params, typeof v == "function" ? v(m) : v || (0, e._)`{}`]), x.messages && E.push([f.message, typeof p == "function" ? p(m) : p]), x.verbose && E.push([f.schema, b], [f.parentSchema, (0, e._)`${k}${$}`], [n.default.data, y]), M && E.push([f.propertyName, M]);
    }
  })(Ia)), Ia;
}
var hl;
function w1() {
  if (hl) return Zr;
  hl = 1, Object.defineProperty(Zr, "__esModule", { value: !0 }), Zr.boolOrEmptySchema = Zr.topBoolOrEmptySchema = void 0;
  const t = ua(), e = kt(), r = Ye(), n = {
    message: "boolean schema is false"
  };
  function i(o) {
    const { gen: c, schema: h, validateName: f } = o;
    h === !1 ? a(o, !1) : typeof h == "object" && h.$async === !0 ? c.return(r.default.data) : (c.assign((0, e._)`${f}.errors`, null), c.return(!0));
  }
  Zr.topBoolOrEmptySchema = i;
  function s(o, c) {
    const { gen: h, schema: f } = o;
    f === !1 ? (h.var(c, !1), a(o)) : h.var(c, !0);
  }
  Zr.boolOrEmptySchema = s;
  function a(o, c) {
    const { gen: h, data: f } = o, u = {
      gen: h,
      keyword: "false schema",
      data: f,
      schema: !1,
      schemaCode: !1,
      schemaValue: !1,
      params: {},
      it: o
    };
    (0, t.reportError)(u, n, void 0, c);
  }
  return Zr;
}
var oe = {}, Vr = {}, ll;
function pm() {
  if (ll) return Vr;
  ll = 1, Object.defineProperty(Vr, "__esModule", { value: !0 }), Vr.getRules = Vr.isJSONType = void 0;
  const t = ["string", "number", "integer", "boolean", "null", "object", "array"], e = new Set(t);
  function r(i) {
    return typeof i == "string" && e.has(i);
  }
  Vr.isJSONType = r;
  function n() {
    const i = {
      number: { type: "number", rules: [] },
      string: { type: "string", rules: [] },
      array: { type: "array", rules: [] },
      object: { type: "object", rules: [] }
    };
    return {
      types: { ...i, integer: !0, boolean: !0, null: !0 },
      rules: [{ rules: [] }, i.number, i.string, i.array, i.object],
      post: { rules: [] },
      all: {},
      keywords: {}
    };
  }
  return Vr.getRules = n, Vr;
}
var pr = {}, ul;
function ym() {
  if (ul) return pr;
  ul = 1, Object.defineProperty(pr, "__esModule", { value: !0 }), pr.shouldUseRule = pr.shouldUseGroup = pr.schemaHasRulesForType = void 0;
  function t({ schema: n, self: i }, s) {
    const a = i.RULES.types[s];
    return a && a !== !0 && e(n, a);
  }
  pr.schemaHasRulesForType = t;
  function e(n, i) {
    return i.rules.some((s) => r(n, s));
  }
  pr.shouldUseGroup = e;
  function r(n, i) {
    var s;
    return n[i.keyword] !== void 0 || ((s = i.definition.implements) === null || s === void 0 ? void 0 : s.some((a) => n[a] !== void 0));
  }
  return pr.shouldUseRule = r, pr;
}
var fl;
function Ys() {
  if (fl) return oe;
  fl = 1, Object.defineProperty(oe, "__esModule", { value: !0 }), oe.reportTypeError = oe.checkDataTypes = oe.checkDataType = oe.coerceAndCheckDataType = oe.getJSONTypes = oe.getSchemaTypes = oe.DataType = void 0;
  const t = pm(), e = ym(), r = ua(), n = kt(), i = Rt();
  var s;
  (function(p) {
    p[p.Correct = 0] = "Correct", p[p.Wrong = 1] = "Wrong";
  })(s || (oe.DataType = s = {}));
  function a(p) {
    const E = o(p.type);
    if (E.includes("null")) {
      if (p.nullable === !1)
        throw new Error("type: null contradicts nullable: false");
    } else {
      if (!E.length && p.nullable !== void 0)
        throw new Error('"nullable" cannot be used without "type"');
      p.nullable === !0 && E.push("null");
    }
    return E;
  }
  oe.getSchemaTypes = a;
  function o(p) {
    const E = Array.isArray(p) ? p : p ? [p] : [];
    if (E.every(t.isJSONType))
      return E;
    throw new Error("type must be JSONType or JSONType[]: " + E.join(","));
  }
  oe.getJSONTypes = o;
  function c(p, E) {
    const { gen: _, data: y, opts: b } = p, S = f(E, b.coerceTypes), x = E.length > 0 && !(S.length === 0 && E.length === 1 && (0, e.schemaHasRulesForType)(p, E[0]));
    if (x) {
      const M = g(E, y, b.strictNumbers, s.Wrong);
      _.if(M, () => {
        S.length ? u(p, E, S) : m(p);
      });
    }
    return x;
  }
  oe.coerceAndCheckDataType = c;
  const h = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
  function f(p, E) {
    return E ? p.filter((_) => h.has(_) || E === "array" && _ === "array") : [];
  }
  function u(p, E, _) {
    const { gen: y, data: b, opts: S } = p, x = y.let("dataType", (0, n._)`typeof ${b}`), M = y.let("coerced", (0, n._)`undefined`);
    S.coerceTypes === "array" && y.if((0, n._)`${x} == 'object' && Array.isArray(${b}) && ${b}.length == 1`, () => y.assign(b, (0, n._)`${b}[0]`).assign(x, (0, n._)`typeof ${b}`).if(g(E, b, S.strictNumbers), () => y.assign(M, b))), y.if((0, n._)`${M} !== undefined`);
    for (const $ of _)
      (h.has($) || $ === "array" && S.coerceTypes === "array") && k($);
    y.else(), m(p), y.endIf(), y.if((0, n._)`${M} !== undefined`, () => {
      y.assign(b, M), l(p, M);
    });
    function k($) {
      switch ($) {
        case "string":
          y.elseIf((0, n._)`${x} == "number" || ${x} == "boolean"`).assign(M, (0, n._)`"" + ${b}`).elseIf((0, n._)`${b} === null`).assign(M, (0, n._)`""`);
          return;
        case "number":
          y.elseIf((0, n._)`${x} == "boolean" || ${b} === null
              || (${x} == "string" && ${b} && ${b} == +${b})`).assign(M, (0, n._)`+${b}`);
          return;
        case "integer":
          y.elseIf((0, n._)`${x} === "boolean" || ${b} === null
              || (${x} === "string" && ${b} && ${b} == +${b} && !(${b} % 1))`).assign(M, (0, n._)`+${b}`);
          return;
        case "boolean":
          y.elseIf((0, n._)`${b} === "false" || ${b} === 0 || ${b} === null`).assign(M, !1).elseIf((0, n._)`${b} === "true" || ${b} === 1`).assign(M, !0);
          return;
        case "null":
          y.elseIf((0, n._)`${b} === "" || ${b} === 0 || ${b} === false`), y.assign(M, null);
          return;
        case "array":
          y.elseIf((0, n._)`${x} === "string" || ${x} === "number"
              || ${x} === "boolean" || ${b} === null`).assign(M, (0, n._)`[${b}]`);
      }
    }
  }
  function l({ gen: p, parentData: E, parentDataProperty: _ }, y) {
    p.if((0, n._)`${E} !== undefined`, () => p.assign((0, n._)`${E}[${_}]`, y));
  }
  function d(p, E, _, y = s.Correct) {
    const b = y === s.Correct ? n.operators.EQ : n.operators.NEQ;
    let S;
    switch (p) {
      case "null":
        return (0, n._)`${E} ${b} null`;
      case "array":
        S = (0, n._)`Array.isArray(${E})`;
        break;
      case "object":
        S = (0, n._)`${E} && typeof ${E} == "object" && !Array.isArray(${E})`;
        break;
      case "integer":
        S = x((0, n._)`!(${E} % 1) && !isNaN(${E})`);
        break;
      case "number":
        S = x();
        break;
      default:
        return (0, n._)`typeof ${E} ${b} ${p}`;
    }
    return y === s.Correct ? S : (0, n.not)(S);
    function x(M = n.nil) {
      return (0, n.and)((0, n._)`typeof ${E} == "number"`, M, _ ? (0, n._)`isFinite(${E})` : n.nil);
    }
  }
  oe.checkDataType = d;
  function g(p, E, _, y) {
    if (p.length === 1)
      return d(p[0], E, _, y);
    let b;
    const S = (0, i.toHash)(p);
    if (S.array && S.object) {
      const x = (0, n._)`typeof ${E} != "object"`;
      b = S.null ? x : (0, n._)`!${E} || ${x}`, delete S.null, delete S.array, delete S.object;
    } else
      b = n.nil;
    S.number && delete S.integer;
    for (const x in S)
      b = (0, n.and)(b, d(x, E, _, y));
    return b;
  }
  oe.checkDataTypes = g;
  const w = {
    message: ({ schema: p }) => `must be ${p}`,
    params: ({ schema: p, schemaValue: E }) => typeof p == "string" ? (0, n._)`{type: ${p}}` : (0, n._)`{type: ${E}}`
  };
  function m(p) {
    const E = v(p);
    (0, r.reportError)(E, w);
  }
  oe.reportTypeError = m;
  function v(p) {
    const { gen: E, data: _, schema: y } = p, b = (0, i.schemaRefOrVal)(p, y, "type");
    return {
      gen: E,
      keyword: "type",
      data: _,
      schema: y.type,
      schemaCode: b,
      schemaValue: b,
      parentSchema: y,
      params: {},
      it: p
    };
  }
  return oe;
}
var Cn = {}, dl;
function _1() {
  if (dl) return Cn;
  dl = 1, Object.defineProperty(Cn, "__esModule", { value: !0 }), Cn.assignDefaults = void 0;
  const t = kt(), e = Rt();
  function r(i, s) {
    const { properties: a, items: o } = i.schema;
    if (s === "object" && a)
      for (const c in a)
        n(i, c, a[c].default);
    else s === "array" && Array.isArray(o) && o.forEach((c, h) => n(i, h, c.default));
  }
  Cn.assignDefaults = r;
  function n(i, s, a) {
    const { gen: o, compositeRule: c, data: h, opts: f } = i;
    if (a === void 0)
      return;
    const u = (0, t._)`${h}${(0, t.getProperty)(s)}`;
    if (c) {
      (0, e.checkStrictMode)(i, `default is ignored for: ${u}`);
      return;
    }
    let l = (0, t._)`${u} === undefined`;
    f.useDefaults === "empty" && (l = (0, t._)`${l} || ${u} === null || ${u} === ""`), o.if(l, (0, t._)`${u} = ${(0, t.stringify)(a)}`);
  }
  return Cn;
}
var He = {}, Bt = {}, ml;
function Qe() {
  if (ml) return Bt;
  ml = 1, Object.defineProperty(Bt, "__esModule", { value: !0 }), Bt.validateUnion = Bt.validateArray = Bt.usePattern = Bt.callValidateCode = Bt.schemaProperties = Bt.allSchemaProperties = Bt.noPropertyInData = Bt.propertyInData = Bt.isOwnProperty = Bt.hasPropFunc = Bt.reportMissingProp = Bt.checkMissingProp = Bt.checkReportMissingProp = void 0;
  const t = kt(), e = Rt(), r = Ye(), n = Rt();
  function i(p, E) {
    const { gen: _, data: y, it: b } = p;
    _.if(f(_, y, E, b.opts.ownProperties), () => {
      p.setParams({ missingProperty: (0, t._)`${E}` }, !0), p.error();
    });
  }
  Bt.checkReportMissingProp = i;
  function s({ gen: p, data: E, it: { opts: _ } }, y, b) {
    return (0, t.or)(...y.map((S) => (0, t.and)(f(p, E, S, _.ownProperties), (0, t._)`${b} = ${S}`)));
  }
  Bt.checkMissingProp = s;
  function a(p, E) {
    p.setParams({ missingProperty: E }, !0), p.error();
  }
  Bt.reportMissingProp = a;
  function o(p) {
    return p.scopeValue("func", {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ref: Object.prototype.hasOwnProperty,
      code: (0, t._)`Object.prototype.hasOwnProperty`
    });
  }
  Bt.hasPropFunc = o;
  function c(p, E, _) {
    return (0, t._)`${o(p)}.call(${E}, ${_})`;
  }
  Bt.isOwnProperty = c;
  function h(p, E, _, y) {
    const b = (0, t._)`${E}${(0, t.getProperty)(_)} !== undefined`;
    return y ? (0, t._)`${b} && ${c(p, E, _)}` : b;
  }
  Bt.propertyInData = h;
  function f(p, E, _, y) {
    const b = (0, t._)`${E}${(0, t.getProperty)(_)} === undefined`;
    return y ? (0, t.or)(b, (0, t.not)(c(p, E, _))) : b;
  }
  Bt.noPropertyInData = f;
  function u(p) {
    return p ? Object.keys(p).filter((E) => E !== "__proto__") : [];
  }
  Bt.allSchemaProperties = u;
  function l(p, E) {
    return u(E).filter((_) => !(0, e.alwaysValidSchema)(p, E[_]));
  }
  Bt.schemaProperties = l;
  function d({ schemaCode: p, data: E, it: { gen: _, topSchemaRef: y, schemaPath: b, errorPath: S }, it: x }, M, k, $) {
    const O = $ ? (0, t._)`${p}, ${E}, ${y}${b}` : E, T = [
      [r.default.instancePath, (0, t.strConcat)(r.default.instancePath, S)],
      [r.default.parentData, x.parentData],
      [r.default.parentDataProperty, x.parentDataProperty],
      [r.default.rootData, r.default.rootData]
    ];
    x.opts.dynamicRef && T.push([r.default.dynamicAnchors, r.default.dynamicAnchors]);
    const I = (0, t._)`${O}, ${_.object(...T)}`;
    return k !== t.nil ? (0, t._)`${M}.call(${k}, ${I})` : (0, t._)`${M}(${I})`;
  }
  Bt.callValidateCode = d;
  const g = (0, t._)`new RegExp`;
  function w({ gen: p, it: { opts: E } }, _) {
    const y = E.unicodeRegExp ? "u" : "", { regExp: b } = E.code, S = b(_, y);
    return p.scopeValue("pattern", {
      key: S.toString(),
      ref: S,
      code: (0, t._)`${b.code === "new RegExp" ? g : (0, n.useFunc)(p, b)}(${_}, ${y})`
    });
  }
  Bt.usePattern = w;
  function m(p) {
    const { gen: E, data: _, keyword: y, it: b } = p, S = E.name("valid");
    if (b.allErrors) {
      const M = E.let("valid", !0);
      return x(() => E.assign(M, !1)), M;
    }
    return E.var(S, !0), x(() => E.break()), S;
    function x(M) {
      const k = E.const("len", (0, t._)`${_}.length`);
      E.forRange("i", 0, k, ($) => {
        p.subschema({
          keyword: y,
          dataProp: $,
          dataPropType: e.Type.Num
        }, S), E.if((0, t.not)(S), M);
      });
    }
  }
  Bt.validateArray = m;
  function v(p) {
    const { gen: E, schema: _, keyword: y, it: b } = p;
    if (!Array.isArray(_))
      throw new Error("ajv implementation error");
    if (_.some((k) => (0, e.alwaysValidSchema)(b, k)) && !b.opts.unevaluated)
      return;
    const x = E.let("valid", !1), M = E.name("_valid");
    E.block(() => _.forEach((k, $) => {
      const O = p.subschema({
        keyword: y,
        schemaProp: $,
        compositeRule: !0
      }, M);
      E.assign(x, (0, t._)`${x} || ${M}`), p.mergeValidEvaluated(O, M) || E.if((0, t.not)(x));
    })), p.result(x, () => p.reset(), () => p.error(!0));
  }
  return Bt.validateUnion = v, Bt;
}
var pl;
function v1() {
  if (pl) return He;
  pl = 1, Object.defineProperty(He, "__esModule", { value: !0 }), He.validateKeywordUsage = He.validSchemaType = He.funcKeywordCode = He.macroKeywordCode = void 0;
  const t = kt(), e = Ye(), r = Qe(), n = ua();
  function i(l, d) {
    const { gen: g, keyword: w, schema: m, parentSchema: v, it: p } = l, E = d.macro.call(p.self, m, v, p), _ = h(g, w, E);
    p.opts.validateSchema !== !1 && p.self.validateSchema(E, !0);
    const y = g.name("valid");
    l.subschema({
      schema: E,
      schemaPath: t.nil,
      errSchemaPath: `${p.errSchemaPath}/${w}`,
      topSchemaRef: _,
      compositeRule: !0
    }, y), l.pass(y, () => l.error(!0));
  }
  He.macroKeywordCode = i;
  function s(l, d) {
    var g;
    const { gen: w, keyword: m, schema: v, parentSchema: p, $data: E, it: _ } = l;
    c(_, d);
    const y = !E && d.compile ? d.compile.call(_.self, v, p, _) : d.validate, b = h(w, m, y), S = w.let("valid");
    l.block$data(S, x), l.ok((g = d.valid) !== null && g !== void 0 ? g : S);
    function x() {
      if (d.errors === !1)
        $(), d.modifying && a(l), O(() => l.error());
      else {
        const T = d.async ? M() : k();
        d.modifying && a(l), O(() => o(l, T));
      }
    }
    function M() {
      const T = w.let("ruleErrs", null);
      return w.try(() => $((0, t._)`await `), (I) => w.assign(S, !1).if((0, t._)`${I} instanceof ${_.ValidationError}`, () => w.assign(T, (0, t._)`${I}.errors`), () => w.throw(I))), T;
    }
    function k() {
      const T = (0, t._)`${b}.errors`;
      return w.assign(T, null), $(t.nil), T;
    }
    function $(T = d.async ? (0, t._)`await ` : t.nil) {
      const I = _.opts.passContext ? e.default.this : e.default.self, N = !("compile" in d && !E || d.schema === !1);
      w.assign(S, (0, t._)`${T}${(0, r.callValidateCode)(l, b, I, N)}`, d.modifying);
    }
    function O(T) {
      var I;
      w.if((0, t.not)((I = d.valid) !== null && I !== void 0 ? I : S), T);
    }
  }
  He.funcKeywordCode = s;
  function a(l) {
    const { gen: d, data: g, it: w } = l;
    d.if(w.parentData, () => d.assign(g, (0, t._)`${w.parentData}[${w.parentDataProperty}]`));
  }
  function o(l, d) {
    const { gen: g } = l;
    g.if((0, t._)`Array.isArray(${d})`, () => {
      g.assign(e.default.vErrors, (0, t._)`${e.default.vErrors} === null ? ${d} : ${e.default.vErrors}.concat(${d})`).assign(e.default.errors, (0, t._)`${e.default.vErrors}.length`), (0, n.extendErrors)(l);
    }, () => l.error());
  }
  function c({ schemaEnv: l }, d) {
    if (d.async && !l.$async)
      throw new Error("async keyword in sync schema");
  }
  function h(l, d, g) {
    if (g === void 0)
      throw new Error(`keyword "${d}" failed to compile`);
    return l.scopeValue("keyword", typeof g == "function" ? { ref: g } : { ref: g, code: (0, t.stringify)(g) });
  }
  function f(l, d, g = !1) {
    return !d.length || d.some((w) => w === "array" ? Array.isArray(l) : w === "object" ? l && typeof l == "object" && !Array.isArray(l) : typeof l == w || g && typeof l > "u");
  }
  He.validSchemaType = f;
  function u({ schema: l, opts: d, self: g, errSchemaPath: w }, m, v) {
    if (Array.isArray(m.keyword) ? !m.keyword.includes(v) : m.keyword !== v)
      throw new Error("ajv implementation error");
    const p = m.dependencies;
    if (p?.some((E) => !Object.prototype.hasOwnProperty.call(l, E)))
      throw new Error(`parent schema must have dependencies of ${v}: ${p.join(",")}`);
    if (m.validateSchema && !m.validateSchema(l[v])) {
      const _ = `keyword "${v}" value is invalid at path "${w}": ` + g.errorsText(m.validateSchema.errors);
      if (d.validateSchema === "log")
        g.logger.error(_);
      else
        throw new Error(_);
    }
  }
  return He.validateKeywordUsage = u, He;
}
var yr = {}, yl;
function E1() {
  if (yl) return yr;
  yl = 1, Object.defineProperty(yr, "__esModule", { value: !0 }), yr.extendSubschemaMode = yr.extendSubschemaData = yr.getSubschema = void 0;
  const t = kt(), e = Rt();
  function r(s, { keyword: a, schemaProp: o, schema: c, schemaPath: h, errSchemaPath: f, topSchemaRef: u }) {
    if (a !== void 0 && c !== void 0)
      throw new Error('both "keyword" and "schema" passed, only one allowed');
    if (a !== void 0) {
      const l = s.schema[a];
      return o === void 0 ? {
        schema: l,
        schemaPath: (0, t._)`${s.schemaPath}${(0, t.getProperty)(a)}`,
        errSchemaPath: `${s.errSchemaPath}/${a}`
      } : {
        schema: l[o],
        schemaPath: (0, t._)`${s.schemaPath}${(0, t.getProperty)(a)}${(0, t.getProperty)(o)}`,
        errSchemaPath: `${s.errSchemaPath}/${a}/${(0, e.escapeFragment)(o)}`
      };
    }
    if (c !== void 0) {
      if (h === void 0 || f === void 0 || u === void 0)
        throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
      return {
        schema: c,
        schemaPath: h,
        topSchemaRef: u,
        errSchemaPath: f
      };
    }
    throw new Error('either "keyword" or "schema" must be passed');
  }
  yr.getSubschema = r;
  function n(s, a, { dataProp: o, dataPropType: c, data: h, dataTypes: f, propertyName: u }) {
    if (h !== void 0 && o !== void 0)
      throw new Error('both "data" and "dataProp" passed, only one allowed');
    const { gen: l } = a;
    if (o !== void 0) {
      const { errorPath: g, dataPathArr: w, opts: m } = a, v = l.let("data", (0, t._)`${a.data}${(0, t.getProperty)(o)}`, !0);
      d(v), s.errorPath = (0, t.str)`${g}${(0, e.getErrorPath)(o, c, m.jsPropertySyntax)}`, s.parentDataProperty = (0, t._)`${o}`, s.dataPathArr = [...w, s.parentDataProperty];
    }
    if (h !== void 0) {
      const g = h instanceof t.Name ? h : l.let("data", h, !0);
      d(g), u !== void 0 && (s.propertyName = u);
    }
    f && (s.dataTypes = f);
    function d(g) {
      s.data = g, s.dataLevel = a.dataLevel + 1, s.dataTypes = [], a.definedProperties = /* @__PURE__ */ new Set(), s.parentData = a.data, s.dataNames = [...a.dataNames, g];
    }
  }
  yr.extendSubschemaData = n;
  function i(s, { jtdDiscriminator: a, jtdMetadata: o, compositeRule: c, createErrors: h, allErrors: f }) {
    c !== void 0 && (s.compositeRule = c), h !== void 0 && (s.createErrors = h), f !== void 0 && (s.allErrors = f), s.jtdDiscriminator = a, s.jtdMetadata = o;
  }
  return yr.extendSubschemaMode = i, yr;
}
var _e = {}, Oa, gl;
function gm() {
  return gl || (gl = 1, Oa = function t(e, r) {
    if (e === r) return !0;
    if (e && r && typeof e == "object" && typeof r == "object") {
      if (e.constructor !== r.constructor) return !1;
      var n, i, s;
      if (Array.isArray(e)) {
        if (n = e.length, n != r.length) return !1;
        for (i = n; i-- !== 0; )
          if (!t(e[i], r[i])) return !1;
        return !0;
      }
      if (e.constructor === RegExp) return e.source === r.source && e.flags === r.flags;
      if (e.valueOf !== Object.prototype.valueOf) return e.valueOf() === r.valueOf();
      if (e.toString !== Object.prototype.toString) return e.toString() === r.toString();
      if (s = Object.keys(e), n = s.length, n !== Object.keys(r).length) return !1;
      for (i = n; i-- !== 0; )
        if (!Object.prototype.hasOwnProperty.call(r, s[i])) return !1;
      for (i = n; i-- !== 0; ) {
        var a = s[i];
        if (!t(e[a], r[a])) return !1;
      }
      return !0;
    }
    return e !== e && r !== r;
  }), Oa;
}
var Ra = { exports: {} }, wl;
function b1() {
  if (wl) return Ra.exports;
  wl = 1;
  var t = Ra.exports = function(n, i, s) {
    typeof i == "function" && (s = i, i = {}), s = i.cb || s;
    var a = typeof s == "function" ? s : s.pre || function() {
    }, o = s.post || function() {
    };
    e(i, a, o, n, "", n);
  };
  t.keywords = {
    additionalItems: !0,
    items: !0,
    contains: !0,
    additionalProperties: !0,
    propertyNames: !0,
    not: !0,
    if: !0,
    then: !0,
    else: !0
  }, t.arrayKeywords = {
    items: !0,
    allOf: !0,
    anyOf: !0,
    oneOf: !0
  }, t.propsKeywords = {
    $defs: !0,
    definitions: !0,
    properties: !0,
    patternProperties: !0,
    dependencies: !0
  }, t.skipKeywords = {
    default: !0,
    enum: !0,
    const: !0,
    required: !0,
    maximum: !0,
    minimum: !0,
    exclusiveMaximum: !0,
    exclusiveMinimum: !0,
    multipleOf: !0,
    maxLength: !0,
    minLength: !0,
    pattern: !0,
    format: !0,
    maxItems: !0,
    minItems: !0,
    uniqueItems: !0,
    maxProperties: !0,
    minProperties: !0
  };
  function e(n, i, s, a, o, c, h, f, u, l) {
    if (a && typeof a == "object" && !Array.isArray(a)) {
      i(a, o, c, h, f, u, l);
      for (var d in a) {
        var g = a[d];
        if (Array.isArray(g)) {
          if (d in t.arrayKeywords)
            for (var w = 0; w < g.length; w++)
              e(n, i, s, g[w], o + "/" + d + "/" + w, c, o, d, a, w);
        } else if (d in t.propsKeywords) {
          if (g && typeof g == "object")
            for (var m in g)
              e(n, i, s, g[m], o + "/" + d + "/" + r(m), c, o, d, a, m);
        } else (d in t.keywords || n.allKeys && !(d in t.skipKeywords)) && e(n, i, s, g, o + "/" + d, c, o, d, a);
      }
      s(a, o, c, h, f, u, l);
    }
  }
  function r(n) {
    return n.replace(/~/g, "~0").replace(/\//g, "~1");
  }
  return Ra.exports;
}
var _l;
function fa() {
  if (_l) return _e;
  _l = 1, Object.defineProperty(_e, "__esModule", { value: !0 }), _e.getSchemaRefs = _e.resolveUrl = _e.normalizeId = _e._getFullPath = _e.getFullPath = _e.inlineRef = void 0;
  const t = Rt(), e = gm(), r = b1(), n = /* @__PURE__ */ new Set([
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
  function i(w, m = !0) {
    return typeof w == "boolean" ? !0 : m === !0 ? !a(w) : m ? o(w) <= m : !1;
  }
  _e.inlineRef = i;
  const s = /* @__PURE__ */ new Set([
    "$ref",
    "$recursiveRef",
    "$recursiveAnchor",
    "$dynamicRef",
    "$dynamicAnchor"
  ]);
  function a(w) {
    for (const m in w) {
      if (s.has(m))
        return !0;
      const v = w[m];
      if (Array.isArray(v) && v.some(a) || typeof v == "object" && a(v))
        return !0;
    }
    return !1;
  }
  function o(w) {
    let m = 0;
    for (const v in w) {
      if (v === "$ref")
        return 1 / 0;
      if (m++, !n.has(v) && (typeof w[v] == "object" && (0, t.eachItem)(w[v], (p) => m += o(p)), m === 1 / 0))
        return 1 / 0;
    }
    return m;
  }
  function c(w, m = "", v) {
    v !== !1 && (m = u(m));
    const p = w.parse(m);
    return h(w, p);
  }
  _e.getFullPath = c;
  function h(w, m) {
    return w.serialize(m).split("#")[0] + "#";
  }
  _e._getFullPath = h;
  const f = /#\/?$/;
  function u(w) {
    return w ? w.replace(f, "") : "";
  }
  _e.normalizeId = u;
  function l(w, m, v) {
    return v = u(v), w.resolve(m, v);
  }
  _e.resolveUrl = l;
  const d = /^[a-z_][-a-z0-9._]*$/i;
  function g(w, m) {
    if (typeof w == "boolean")
      return {};
    const { schemaId: v, uriResolver: p } = this.opts, E = u(w[v] || m), _ = { "": E }, y = c(p, E, !1), b = {}, S = /* @__PURE__ */ new Set();
    return r(w, { allKeys: !0 }, (k, $, O, T) => {
      if (T === void 0)
        return;
      const I = y + $;
      let N = _[T];
      typeof k[v] == "string" && (N = j.call(this, k[v])), C.call(this, k.$anchor), C.call(this, k.$dynamicAnchor), _[$] = N;
      function j(F) {
        const q = this.opts.uriResolver.resolve;
        if (F = u(N ? q(N, F) : F), S.has(F))
          throw M(F);
        S.add(F);
        let R = this.refs[F];
        return typeof R == "string" && (R = this.refs[R]), typeof R == "object" ? x(k, R.schema, F) : F !== u(I) && (F[0] === "#" ? (x(k, b[F], F), b[F] = k) : this.refs[F] = I), F;
      }
      function C(F) {
        if (typeof F == "string") {
          if (!d.test(F))
            throw new Error(`invalid anchor "${F}"`);
          j.call(this, `#${F}`);
        }
      }
    }), b;
    function x(k, $, O) {
      if ($ !== void 0 && !e(k, $))
        throw M(O);
    }
    function M(k) {
      return new Error(`reference "${k}" resolves to more than one schema`);
    }
  }
  return _e.getSchemaRefs = g, _e;
}
var vl;
function ci() {
  if (vl) return mr;
  vl = 1, Object.defineProperty(mr, "__esModule", { value: !0 }), mr.getData = mr.KeywordCxt = mr.validateFunctionCode = void 0;
  const t = w1(), e = Ys(), r = ym(), n = Ys(), i = _1(), s = v1(), a = E1(), o = kt(), c = Ye(), h = fa(), f = Rt(), u = ua();
  function l(z) {
    if (y(z) && (S(z), _(z))) {
      m(z);
      return;
    }
    d(z, () => (0, t.topBoolOrEmptySchema)(z));
  }
  mr.validateFunctionCode = l;
  function d({ gen: z, validateName: B, schema: X, schemaEnv: Y, opts: nt }, vt) {
    nt.code.es5 ? z.func(B, (0, o._)`${c.default.data}, ${c.default.valCxt}`, Y.$async, () => {
      z.code((0, o._)`"use strict"; ${p(X, nt)}`), w(z, nt), z.code(vt);
    }) : z.func(B, (0, o._)`${c.default.data}, ${g(nt)}`, Y.$async, () => z.code(p(X, nt)).code(vt));
  }
  function g(z) {
    return (0, o._)`{${c.default.instancePath}="", ${c.default.parentData}, ${c.default.parentDataProperty}, ${c.default.rootData}=${c.default.data}${z.dynamicRef ? (0, o._)`, ${c.default.dynamicAnchors}={}` : o.nil}}={}`;
  }
  function w(z, B) {
    z.if(c.default.valCxt, () => {
      z.var(c.default.instancePath, (0, o._)`${c.default.valCxt}.${c.default.instancePath}`), z.var(c.default.parentData, (0, o._)`${c.default.valCxt}.${c.default.parentData}`), z.var(c.default.parentDataProperty, (0, o._)`${c.default.valCxt}.${c.default.parentDataProperty}`), z.var(c.default.rootData, (0, o._)`${c.default.valCxt}.${c.default.rootData}`), B.dynamicRef && z.var(c.default.dynamicAnchors, (0, o._)`${c.default.valCxt}.${c.default.dynamicAnchors}`);
    }, () => {
      z.var(c.default.instancePath, (0, o._)`""`), z.var(c.default.parentData, (0, o._)`undefined`), z.var(c.default.parentDataProperty, (0, o._)`undefined`), z.var(c.default.rootData, c.default.data), B.dynamicRef && z.var(c.default.dynamicAnchors, (0, o._)`{}`);
    });
  }
  function m(z) {
    const { schema: B, opts: X, gen: Y } = z;
    d(z, () => {
      X.$comment && B.$comment && T(z), k(z), Y.let(c.default.vErrors, null), Y.let(c.default.errors, 0), X.unevaluated && v(z), x(z), I(z);
    });
  }
  function v(z) {
    const { gen: B, validateName: X } = z;
    z.evaluated = B.const("evaluated", (0, o._)`${X}.evaluated`), B.if((0, o._)`${z.evaluated}.dynamicProps`, () => B.assign((0, o._)`${z.evaluated}.props`, (0, o._)`undefined`)), B.if((0, o._)`${z.evaluated}.dynamicItems`, () => B.assign((0, o._)`${z.evaluated}.items`, (0, o._)`undefined`));
  }
  function p(z, B) {
    const X = typeof z == "object" && z[B.schemaId];
    return X && (B.code.source || B.code.process) ? (0, o._)`/*# sourceURL=${X} */` : o.nil;
  }
  function E(z, B) {
    if (y(z) && (S(z), _(z))) {
      b(z, B);
      return;
    }
    (0, t.boolOrEmptySchema)(z, B);
  }
  function _({ schema: z, self: B }) {
    if (typeof z == "boolean")
      return !z;
    for (const X in z)
      if (B.RULES.all[X])
        return !0;
    return !1;
  }
  function y(z) {
    return typeof z.schema != "boolean";
  }
  function b(z, B) {
    const { schema: X, gen: Y, opts: nt } = z;
    nt.$comment && X.$comment && T(z), $(z), O(z);
    const vt = Y.const("_errs", c.default.errors);
    x(z, vt), Y.var(B, (0, o._)`${vt} === ${c.default.errors}`);
  }
  function S(z) {
    (0, f.checkUnknownRules)(z), M(z);
  }
  function x(z, B) {
    if (z.opts.jtd)
      return j(z, [], !1, B);
    const X = (0, e.getSchemaTypes)(z.schema), Y = (0, e.coerceAndCheckDataType)(z, X);
    j(z, X, !Y, B);
  }
  function M(z) {
    const { schema: B, errSchemaPath: X, opts: Y, self: nt } = z;
    B.$ref && Y.ignoreKeywordsWithRef && (0, f.schemaHasRulesButRef)(B, nt.RULES) && nt.logger.warn(`$ref: keywords ignored in schema at path "${X}"`);
  }
  function k(z) {
    const { schema: B, opts: X } = z;
    B.default !== void 0 && X.useDefaults && X.strictSchema && (0, f.checkStrictMode)(z, "default is ignored in the schema root");
  }
  function $(z) {
    const B = z.schema[z.opts.schemaId];
    B && (z.baseId = (0, h.resolveUrl)(z.opts.uriResolver, z.baseId, B));
  }
  function O(z) {
    if (z.schema.$async && !z.schemaEnv.$async)
      throw new Error("async schema in sync schema");
  }
  function T({ gen: z, schemaEnv: B, schema: X, errSchemaPath: Y, opts: nt }) {
    const vt = X.$comment;
    if (nt.$comment === !0)
      z.code((0, o._)`${c.default.self}.logger.log(${vt})`);
    else if (typeof nt.$comment == "function") {
      const xt = (0, o.str)`${Y}/$comment`, re = z.scopeValue("root", { ref: B.root });
      z.code((0, o._)`${c.default.self}.opts.$comment(${vt}, ${xt}, ${re}.schema)`);
    }
  }
  function I(z) {
    const { gen: B, schemaEnv: X, validateName: Y, ValidationError: nt, opts: vt } = z;
    X.$async ? B.if((0, o._)`${c.default.errors} === 0`, () => B.return(c.default.data), () => B.throw((0, o._)`new ${nt}(${c.default.vErrors})`)) : (B.assign((0, o._)`${Y}.errors`, c.default.vErrors), vt.unevaluated && N(z), B.return((0, o._)`${c.default.errors} === 0`));
  }
  function N({ gen: z, evaluated: B, props: X, items: Y }) {
    X instanceof o.Name && z.assign((0, o._)`${B}.props`, X), Y instanceof o.Name && z.assign((0, o._)`${B}.items`, Y);
  }
  function j(z, B, X, Y) {
    const { gen: nt, schema: vt, data: xt, allErrors: re, opts: ne, self: ie } = z, { RULES: Ct } = ie;
    if (vt.$ref && (ne.ignoreKeywordsWithRef || !(0, f.schemaHasRulesButRef)(vt, Ct))) {
      nt.block(() => K(z, "$ref", Ct.all.$ref.definition));
      return;
    }
    ne.jtd || F(z, B), nt.block(() => {
      for (const se of Ct.rules)
        te(se);
      te(Ct.post);
    });
    function te(se) {
      (0, r.shouldUseGroup)(vt, se) && (se.type ? (nt.if((0, n.checkDataType)(se.type, xt, ne.strictNumbers)), C(z, se), B.length === 1 && B[0] === se.type && X && (nt.else(), (0, n.reportTypeError)(z)), nt.endIf()) : C(z, se), re || nt.if((0, o._)`${c.default.errors} === ${Y || 0}`));
    }
  }
  function C(z, B) {
    const { gen: X, schema: Y, opts: { useDefaults: nt } } = z;
    nt && (0, i.assignDefaults)(z, B.type), X.block(() => {
      for (const vt of B.rules)
        (0, r.shouldUseRule)(Y, vt) && K(z, vt.keyword, vt.definition, B.type);
    });
  }
  function F(z, B) {
    z.schemaEnv.meta || !z.opts.strictTypes || (q(z, B), z.opts.allowUnionTypes || R(z, B), D(z, z.dataTypes));
  }
  function q(z, B) {
    if (B.length) {
      if (!z.dataTypes.length) {
        z.dataTypes = B;
        return;
      }
      B.forEach((X) => {
        L(z.dataTypes, X) || P(z, `type "${X}" not allowed by context "${z.dataTypes.join(",")}"`);
      }), A(z, B);
    }
  }
  function R(z, B) {
    B.length > 1 && !(B.length === 2 && B.includes("null")) && P(z, "use allowUnionTypes to allow union type keyword");
  }
  function D(z, B) {
    const X = z.self.RULES.all;
    for (const Y in X) {
      const nt = X[Y];
      if (typeof nt == "object" && (0, r.shouldUseRule)(z.schema, nt)) {
        const { type: vt } = nt.definition;
        vt.length && !vt.some((xt) => G(B, xt)) && P(z, `missing type "${vt.join(",")}" for keyword "${Y}"`);
      }
    }
  }
  function G(z, B) {
    return z.includes(B) || B === "number" && z.includes("integer");
  }
  function L(z, B) {
    return z.includes(B) || B === "integer" && z.includes("number");
  }
  function A(z, B) {
    const X = [];
    for (const Y of z.dataTypes)
      L(B, Y) ? X.push(Y) : B.includes("integer") && Y === "number" && X.push("integer");
    z.dataTypes = X;
  }
  function P(z, B) {
    const X = z.schemaEnv.baseId + z.errSchemaPath;
    B += ` at "${X}" (strictTypes)`, (0, f.checkStrictMode)(z, B, z.opts.strictTypes);
  }
  class U {
    constructor(B, X, Y) {
      if ((0, s.validateKeywordUsage)(B, X, Y), this.gen = B.gen, this.allErrors = B.allErrors, this.keyword = Y, this.data = B.data, this.schema = B.schema[Y], this.$data = X.$data && B.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, f.schemaRefOrVal)(B, this.schema, Y, this.$data), this.schemaType = X.schemaType, this.parentSchema = B.schema, this.params = {}, this.it = B, this.def = X, this.$data)
        this.schemaCode = B.gen.const("vSchema", rt(this.$data, B));
      else if (this.schemaCode = this.schemaValue, !(0, s.validSchemaType)(this.schema, X.schemaType, X.allowUndefined))
        throw new Error(`${Y} value must be ${JSON.stringify(X.schemaType)}`);
      ("code" in X ? X.trackErrors : X.errors !== !1) && (this.errsCount = B.gen.const("_errs", c.default.errors));
    }
    result(B, X, Y) {
      this.failResult((0, o.not)(B), X, Y);
    }
    failResult(B, X, Y) {
      this.gen.if(B), Y ? Y() : this.error(), X ? (this.gen.else(), X(), this.allErrors && this.gen.endIf()) : this.allErrors ? this.gen.endIf() : this.gen.else();
    }
    pass(B, X) {
      this.failResult((0, o.not)(B), void 0, X);
    }
    fail(B) {
      if (B === void 0) {
        this.error(), this.allErrors || this.gen.if(!1);
        return;
      }
      this.gen.if(B), this.error(), this.allErrors ? this.gen.endIf() : this.gen.else();
    }
    fail$data(B) {
      if (!this.$data)
        return this.fail(B);
      const { schemaCode: X } = this;
      this.fail((0, o._)`${X} !== undefined && (${(0, o.or)(this.invalid$data(), B)})`);
    }
    error(B, X, Y) {
      if (X) {
        this.setParams(X), this._error(B, Y), this.setParams({});
        return;
      }
      this._error(B, Y);
    }
    _error(B, X) {
      (B ? u.reportExtraError : u.reportError)(this, this.def.error, X);
    }
    $dataError() {
      (0, u.reportError)(this, this.def.$dataError || u.keyword$DataError);
    }
    reset() {
      if (this.errsCount === void 0)
        throw new Error('add "trackErrors" to keyword definition');
      (0, u.resetErrorsCount)(this.gen, this.errsCount);
    }
    ok(B) {
      this.allErrors || this.gen.if(B);
    }
    setParams(B, X) {
      X ? Object.assign(this.params, B) : this.params = B;
    }
    block$data(B, X, Y = o.nil) {
      this.gen.block(() => {
        this.check$data(B, Y), X();
      });
    }
    check$data(B = o.nil, X = o.nil) {
      if (!this.$data)
        return;
      const { gen: Y, schemaCode: nt, schemaType: vt, def: xt } = this;
      Y.if((0, o.or)((0, o._)`${nt} === undefined`, X)), B !== o.nil && Y.assign(B, !0), (vt.length || xt.validateSchema) && (Y.elseIf(this.invalid$data()), this.$dataError(), B !== o.nil && Y.assign(B, !1)), Y.else();
    }
    invalid$data() {
      const { gen: B, schemaCode: X, schemaType: Y, def: nt, it: vt } = this;
      return (0, o.or)(xt(), re());
      function xt() {
        if (Y.length) {
          if (!(X instanceof o.Name))
            throw new Error("ajv implementation error");
          const ne = Array.isArray(Y) ? Y : [Y];
          return (0, o._)`${(0, n.checkDataTypes)(ne, X, vt.opts.strictNumbers, n.DataType.Wrong)}`;
        }
        return o.nil;
      }
      function re() {
        if (nt.validateSchema) {
          const ne = B.scopeValue("validate$data", { ref: nt.validateSchema });
          return (0, o._)`!${ne}(${X})`;
        }
        return o.nil;
      }
    }
    subschema(B, X) {
      const Y = (0, a.getSubschema)(this.it, B);
      (0, a.extendSubschemaData)(Y, this.it, B), (0, a.extendSubschemaMode)(Y, B);
      const nt = { ...this.it, ...Y, items: void 0, props: void 0 };
      return E(nt, X), nt;
    }
    mergeEvaluated(B, X) {
      const { it: Y, gen: nt } = this;
      Y.opts.unevaluated && (Y.props !== !0 && B.props !== void 0 && (Y.props = f.mergeEvaluated.props(nt, B.props, Y.props, X)), Y.items !== !0 && B.items !== void 0 && (Y.items = f.mergeEvaluated.items(nt, B.items, Y.items, X)));
    }
    mergeValidEvaluated(B, X) {
      const { it: Y, gen: nt } = this;
      if (Y.opts.unevaluated && (Y.props !== !0 || Y.items !== !0))
        return nt.if(X, () => this.mergeEvaluated(B, o.Name)), !0;
    }
  }
  mr.KeywordCxt = U;
  function K(z, B, X, Y) {
    const nt = new U(z, X, B);
    "code" in X ? X.code(nt, Y) : nt.$data && X.validate ? (0, s.funcKeywordCode)(nt, X) : "macro" in X ? (0, s.macroKeywordCode)(nt, X) : (X.compile || X.validate) && (0, s.funcKeywordCode)(nt, X);
  }
  const J = /^\/(?:[^~]|~0|~1)*$/, et = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
  function rt(z, { dataLevel: B, dataNames: X, dataPathArr: Y }) {
    let nt, vt;
    if (z === "")
      return c.default.rootData;
    if (z[0] === "/") {
      if (!J.test(z))
        throw new Error(`Invalid JSON-pointer: ${z}`);
      nt = z, vt = c.default.rootData;
    } else {
      const ie = et.exec(z);
      if (!ie)
        throw new Error(`Invalid JSON-pointer: ${z}`);
      const Ct = +ie[1];
      if (nt = ie[2], nt === "#") {
        if (Ct >= B)
          throw new Error(ne("property/index", Ct));
        return Y[B - Ct];
      }
      if (Ct > B)
        throw new Error(ne("data", Ct));
      if (vt = X[B - Ct], !nt)
        return vt;
    }
    let xt = vt;
    const re = nt.split("/");
    for (const ie of re)
      ie && (vt = (0, o._)`${vt}${(0, o.getProperty)((0, f.unescapeJsonPointer)(ie))}`, xt = (0, o._)`${xt} && ${vt}`);
    return xt;
    function ne(ie, Ct) {
      return `Cannot access ${ie} ${Ct} levels up, current level is ${B}`;
    }
  }
  return mr.getData = rt, mr;
}
var Mi = {}, El;
function da() {
  if (El) return Mi;
  El = 1, Object.defineProperty(Mi, "__esModule", { value: !0 });
  class t extends Error {
    constructor(r) {
      super("validation failed"), this.errors = r, this.ajv = this.validation = !0;
    }
  }
  return Mi.default = t, Mi;
}
var xi = {}, bl;
function hi() {
  if (bl) return xi;
  bl = 1, Object.defineProperty(xi, "__esModule", { value: !0 });
  const t = fa();
  class e extends Error {
    constructor(n, i, s, a) {
      super(a || `can't resolve reference ${s} from id ${i}`), this.missingRef = (0, t.resolveUrl)(n, i, s), this.missingSchema = (0, t.normalizeId)((0, t.getFullPath)(n, this.missingRef));
    }
  }
  return xi.default = e, xi;
}
var je = {}, Sl;
function ma() {
  if (Sl) return je;
  Sl = 1, Object.defineProperty(je, "__esModule", { value: !0 }), je.resolveSchema = je.getCompilingSchema = je.resolveRef = je.compileSchema = je.SchemaEnv = void 0;
  const t = kt(), e = da(), r = Ye(), n = fa(), i = Rt(), s = ci();
  class a {
    constructor(v) {
      var p;
      this.refs = {}, this.dynamicAnchors = {};
      let E;
      typeof v.schema == "object" && (E = v.schema), this.schema = v.schema, this.schemaId = v.schemaId, this.root = v.root || this, this.baseId = (p = v.baseId) !== null && p !== void 0 ? p : (0, n.normalizeId)(E?.[v.schemaId || "$id"]), this.schemaPath = v.schemaPath, this.localRefs = v.localRefs, this.meta = v.meta, this.$async = E?.$async, this.refs = {};
    }
  }
  je.SchemaEnv = a;
  function o(m) {
    const v = f.call(this, m);
    if (v)
      return v;
    const p = (0, n.getFullPath)(this.opts.uriResolver, m.root.baseId), { es5: E, lines: _ } = this.opts.code, { ownProperties: y } = this.opts, b = new t.CodeGen(this.scope, { es5: E, lines: _, ownProperties: y });
    let S;
    m.$async && (S = b.scopeValue("Error", {
      ref: e.default,
      code: (0, t._)`require("ajv/dist/runtime/validation_error").default`
    }));
    const x = b.scopeName("validate");
    m.validateName = x;
    const M = {
      gen: b,
      allErrors: this.opts.allErrors,
      data: r.default.data,
      parentData: r.default.parentData,
      parentDataProperty: r.default.parentDataProperty,
      dataNames: [r.default.data],
      dataPathArr: [t.nil],
      // TODO can its length be used as dataLevel if nil is removed?
      dataLevel: 0,
      dataTypes: [],
      definedProperties: /* @__PURE__ */ new Set(),
      topSchemaRef: b.scopeValue("schema", this.opts.code.source === !0 ? { ref: m.schema, code: (0, t.stringify)(m.schema) } : { ref: m.schema }),
      validateName: x,
      ValidationError: S,
      schema: m.schema,
      schemaEnv: m,
      rootId: p,
      baseId: m.baseId || p,
      schemaPath: t.nil,
      errSchemaPath: m.schemaPath || (this.opts.jtd ? "" : "#"),
      errorPath: (0, t._)`""`,
      opts: this.opts,
      self: this
    };
    let k;
    try {
      this._compilations.add(m), (0, s.validateFunctionCode)(M), b.optimize(this.opts.code.optimize);
      const $ = b.toString();
      k = `${b.scopeRefs(r.default.scope)}return ${$}`, this.opts.code.process && (k = this.opts.code.process(k, m));
      const T = new Function(`${r.default.self}`, `${r.default.scope}`, k)(this, this.scope.get());
      if (this.scope.value(x, { ref: T }), T.errors = null, T.schema = m.schema, T.schemaEnv = m, m.$async && (T.$async = !0), this.opts.code.source === !0 && (T.source = { validateName: x, validateCode: $, scopeValues: b._values }), this.opts.unevaluated) {
        const { props: I, items: N } = M;
        T.evaluated = {
          props: I instanceof t.Name ? void 0 : I,
          items: N instanceof t.Name ? void 0 : N,
          dynamicProps: I instanceof t.Name,
          dynamicItems: N instanceof t.Name
        }, T.source && (T.source.evaluated = (0, t.stringify)(T.evaluated));
      }
      return m.validate = T, m;
    } catch ($) {
      throw delete m.validate, delete m.validateName, k && this.logger.error("Error compiling schema, function code:", k), $;
    } finally {
      this._compilations.delete(m);
    }
  }
  je.compileSchema = o;
  function c(m, v, p) {
    var E;
    p = (0, n.resolveUrl)(this.opts.uriResolver, v, p);
    const _ = m.refs[p];
    if (_)
      return _;
    let y = l.call(this, m, p);
    if (y === void 0) {
      const b = (E = m.localRefs) === null || E === void 0 ? void 0 : E[p], { schemaId: S } = this.opts;
      b && (y = new a({ schema: b, schemaId: S, root: m, baseId: v }));
    }
    if (y !== void 0)
      return m.refs[p] = h.call(this, y);
  }
  je.resolveRef = c;
  function h(m) {
    return (0, n.inlineRef)(m.schema, this.opts.inlineRefs) ? m.schema : m.validate ? m : o.call(this, m);
  }
  function f(m) {
    for (const v of this._compilations)
      if (u(v, m))
        return v;
  }
  je.getCompilingSchema = f;
  function u(m, v) {
    return m.schema === v.schema && m.root === v.root && m.baseId === v.baseId;
  }
  function l(m, v) {
    let p;
    for (; typeof (p = this.refs[v]) == "string"; )
      v = p;
    return p || this.schemas[v] || d.call(this, m, v);
  }
  function d(m, v) {
    const p = this.opts.uriResolver.parse(v), E = (0, n._getFullPath)(this.opts.uriResolver, p);
    let _ = (0, n.getFullPath)(this.opts.uriResolver, m.baseId, void 0);
    if (Object.keys(m.schema).length > 0 && E === _)
      return w.call(this, p, m);
    const y = (0, n.normalizeId)(E), b = this.refs[y] || this.schemas[y];
    if (typeof b == "string") {
      const S = d.call(this, m, b);
      return typeof S?.schema != "object" ? void 0 : w.call(this, p, S);
    }
    if (typeof b?.schema == "object") {
      if (b.validate || o.call(this, b), y === (0, n.normalizeId)(v)) {
        const { schema: S } = b, { schemaId: x } = this.opts, M = S[x];
        return M && (_ = (0, n.resolveUrl)(this.opts.uriResolver, _, M)), new a({ schema: S, schemaId: x, root: m, baseId: _ });
      }
      return w.call(this, p, b);
    }
  }
  je.resolveSchema = d;
  const g = /* @__PURE__ */ new Set([
    "properties",
    "patternProperties",
    "enum",
    "dependencies",
    "definitions"
  ]);
  function w(m, { baseId: v, schema: p, root: E }) {
    var _;
    if (((_ = m.fragment) === null || _ === void 0 ? void 0 : _[0]) !== "/")
      return;
    for (const S of m.fragment.slice(1).split("/")) {
      if (typeof p == "boolean")
        return;
      const x = p[(0, i.unescapeFragment)(S)];
      if (x === void 0)
        return;
      p = x;
      const M = typeof p == "object" && p[this.opts.schemaId];
      !g.has(S) && M && (v = (0, n.resolveUrl)(this.opts.uriResolver, v, M));
    }
    let y;
    if (typeof p != "boolean" && p.$ref && !(0, i.schemaHasRulesButRef)(p, this.RULES)) {
      const S = (0, n.resolveUrl)(this.opts.uriResolver, v, p.$ref);
      y = d.call(this, E, S);
    }
    const { schemaId: b } = this.opts;
    if (y = y || new a({ schema: p, schemaId: b, root: E, baseId: v }), y.schema !== y.root.schema)
      return y;
  }
  return je;
}
const S1 = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", M1 = "Meta-schema for $data reference (JSON AnySchema extension proposal)", x1 = "object", k1 = ["$data"], $1 = { $data: { type: "string", anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }] } }, I1 = !1, P1 = {
  $id: S1,
  description: M1,
  type: x1,
  required: k1,
  properties: $1,
  additionalProperties: I1
};
var ki = {}, Ln = { exports: {} }, Da, Ml;
function wm() {
  if (Ml) return Da;
  Ml = 1;
  const t = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu), e = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
  function r(l) {
    let d = "", g = 0, w = 0;
    for (w = 0; w < l.length; w++)
      if (g = l[w].charCodeAt(0), g !== 48) {
        if (!(g >= 48 && g <= 57 || g >= 65 && g <= 70 || g >= 97 && g <= 102))
          return "";
        d += l[w];
        break;
      }
    for (w += 1; w < l.length; w++) {
      if (g = l[w].charCodeAt(0), !(g >= 48 && g <= 57 || g >= 65 && g <= 70 || g >= 97 && g <= 102))
        return "";
      d += l[w];
    }
    return d;
  }
  const n = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
  function i(l) {
    return l.length = 0, !0;
  }
  function s(l, d, g) {
    if (l.length) {
      const w = r(l);
      if (w !== "")
        d.push(w);
      else
        return g.error = !0, !1;
      l.length = 0;
    }
    return !0;
  }
  function a(l) {
    let d = 0;
    const g = { error: !1, address: "", zone: "" }, w = [], m = [];
    let v = !1, p = !1, E = s;
    for (let _ = 0; _ < l.length; _++) {
      const y = l[_];
      if (!(y === "[" || y === "]"))
        if (y === ":") {
          if (v === !0 && (p = !0), !E(m, w, g))
            break;
          if (++d > 7) {
            g.error = !0;
            break;
          }
          _ > 0 && l[_ - 1] === ":" && (v = !0), w.push(":");
          continue;
        } else if (y === "%") {
          if (!E(m, w, g))
            break;
          E = i;
        } else {
          m.push(y);
          continue;
        }
    }
    return m.length && (E === i ? g.zone = m.join("") : p ? w.push(m.join("")) : w.push(r(m))), g.address = w.join(""), g;
  }
  function o(l) {
    if (c(l, ":") < 2)
      return { host: l, isIPV6: !1 };
    const d = a(l);
    if (d.error)
      return { host: l, isIPV6: !1 };
    {
      let g = d.address, w = d.address;
      return d.zone && (g += "%" + d.zone, w += "%25" + d.zone), { host: g, isIPV6: !0, escapedHost: w };
    }
  }
  function c(l, d) {
    let g = 0;
    for (let w = 0; w < l.length; w++)
      l[w] === d && g++;
    return g;
  }
  function h(l) {
    let d = l;
    const g = [];
    let w = -1, m = 0;
    for (; m = d.length; ) {
      if (m === 1) {
        if (d === ".")
          break;
        if (d === "/") {
          g.push("/");
          break;
        } else {
          g.push(d);
          break;
        }
      } else if (m === 2) {
        if (d[0] === ".") {
          if (d[1] === ".")
            break;
          if (d[1] === "/") {
            d = d.slice(2);
            continue;
          }
        } else if (d[0] === "/" && (d[1] === "." || d[1] === "/")) {
          g.push("/");
          break;
        }
      } else if (m === 3 && d === "/..") {
        g.length !== 0 && g.pop(), g.push("/");
        break;
      }
      if (d[0] === ".") {
        if (d[1] === ".") {
          if (d[2] === "/") {
            d = d.slice(3);
            continue;
          }
        } else if (d[1] === "/") {
          d = d.slice(2);
          continue;
        }
      } else if (d[0] === "/" && d[1] === ".") {
        if (d[2] === "/") {
          d = d.slice(2);
          continue;
        } else if (d[2] === "." && d[3] === "/") {
          d = d.slice(3), g.length !== 0 && g.pop();
          continue;
        }
      }
      if ((w = d.indexOf("/", 1)) === -1) {
        g.push(d);
        break;
      } else
        g.push(d.slice(0, w)), d = d.slice(w);
    }
    return g.join("");
  }
  function f(l, d) {
    const g = d !== !0 ? escape : unescape;
    return l.scheme !== void 0 && (l.scheme = g(l.scheme)), l.userinfo !== void 0 && (l.userinfo = g(l.userinfo)), l.host !== void 0 && (l.host = g(l.host)), l.path !== void 0 && (l.path = g(l.path)), l.query !== void 0 && (l.query = g(l.query)), l.fragment !== void 0 && (l.fragment = g(l.fragment)), l;
  }
  function u(l) {
    const d = [];
    if (l.userinfo !== void 0 && (d.push(l.userinfo), d.push("@")), l.host !== void 0) {
      let g = unescape(l.host);
      if (!e(g)) {
        const w = o(g);
        w.isIPV6 === !0 ? g = `[${w.escapedHost}]` : g = l.host;
      }
      d.push(g);
    }
    return (typeof l.port == "number" || typeof l.port == "string") && (d.push(":"), d.push(String(l.port))), d.length ? d.join("") : void 0;
  }
  return Da = {
    nonSimpleDomain: n,
    recomposeAuthority: u,
    normalizeComponentEncoding: f,
    removeDotSegments: h,
    isIPv4: e,
    isUUID: t,
    normalizeIPv6: o,
    stringArrayToHexStripped: r
  }, Da;
}
var ja, xl;
function A1() {
  if (xl) return ja;
  xl = 1;
  const { isUUID: t } = wm(), e = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu, r = (
    /** @type {const} */
    [
      "http",
      "https",
      "ws",
      "wss",
      "urn",
      "urn:uuid"
    ]
  );
  function n(y) {
    return r.indexOf(
      /** @type {*} */
      y
    ) !== -1;
  }
  function i(y) {
    return y.secure === !0 ? !0 : y.secure === !1 ? !1 : y.scheme ? y.scheme.length === 3 && (y.scheme[0] === "w" || y.scheme[0] === "W") && (y.scheme[1] === "s" || y.scheme[1] === "S") && (y.scheme[2] === "s" || y.scheme[2] === "S") : !1;
  }
  function s(y) {
    return y.host || (y.error = y.error || "HTTP URIs must have a host."), y;
  }
  function a(y) {
    const b = String(y.scheme).toLowerCase() === "https";
    return (y.port === (b ? 443 : 80) || y.port === "") && (y.port = void 0), y.path || (y.path = "/"), y;
  }
  function o(y) {
    return y.secure = i(y), y.resourceName = (y.path || "/") + (y.query ? "?" + y.query : ""), y.path = void 0, y.query = void 0, y;
  }
  function c(y) {
    if ((y.port === (i(y) ? 443 : 80) || y.port === "") && (y.port = void 0), typeof y.secure == "boolean" && (y.scheme = y.secure ? "wss" : "ws", y.secure = void 0), y.resourceName) {
      const [b, S] = y.resourceName.split("?");
      y.path = b && b !== "/" ? b : void 0, y.query = S, y.resourceName = void 0;
    }
    return y.fragment = void 0, y;
  }
  function h(y, b) {
    if (!y.path)
      return y.error = "URN can not be parsed", y;
    const S = y.path.match(e);
    if (S) {
      const x = b.scheme || y.scheme || "urn";
      y.nid = S[1].toLowerCase(), y.nss = S[2];
      const M = `${x}:${b.nid || y.nid}`, k = _(M);
      y.path = void 0, k && (y = k.parse(y, b));
    } else
      y.error = y.error || "URN can not be parsed.";
    return y;
  }
  function f(y, b) {
    if (y.nid === void 0)
      throw new Error("URN without nid cannot be serialized");
    const S = b.scheme || y.scheme || "urn", x = y.nid.toLowerCase(), M = `${S}:${b.nid || x}`, k = _(M);
    k && (y = k.serialize(y, b));
    const $ = y, O = y.nss;
    return $.path = `${x || b.nid}:${O}`, b.skipEscape = !0, $;
  }
  function u(y, b) {
    const S = y;
    return S.uuid = S.nss, S.nss = void 0, !b.tolerant && (!S.uuid || !t(S.uuid)) && (S.error = S.error || "UUID is not valid."), S;
  }
  function l(y) {
    const b = y;
    return b.nss = (y.uuid || "").toLowerCase(), b;
  }
  const d = (
    /** @type {SchemeHandler} */
    {
      scheme: "http",
      domainHost: !0,
      parse: s,
      serialize: a
    }
  ), g = (
    /** @type {SchemeHandler} */
    {
      scheme: "https",
      domainHost: d.domainHost,
      parse: s,
      serialize: a
    }
  ), w = (
    /** @type {SchemeHandler} */
    {
      scheme: "ws",
      domainHost: !0,
      parse: o,
      serialize: c
    }
  ), m = (
    /** @type {SchemeHandler} */
    {
      scheme: "wss",
      domainHost: w.domainHost,
      parse: w.parse,
      serialize: w.serialize
    }
  ), E = (
    /** @type {Record<SchemeName, SchemeHandler>} */
    {
      http: d,
      https: g,
      ws: w,
      wss: m,
      urn: (
        /** @type {SchemeHandler} */
        {
          scheme: "urn",
          parse: h,
          serialize: f,
          skipNormalize: !0
        }
      ),
      "urn:uuid": (
        /** @type {SchemeHandler} */
        {
          scheme: "urn:uuid",
          parse: u,
          serialize: l,
          skipNormalize: !0
        }
      )
    }
  );
  Object.setPrototypeOf(E, null);
  function _(y) {
    return y && (E[
      /** @type {SchemeName} */
      y
    ] || E[
      /** @type {SchemeName} */
      y.toLowerCase()
    ]) || void 0;
  }
  return ja = {
    wsIsSecure: i,
    SCHEMES: E,
    isValidSchemeName: n,
    getSchemeHandler: _
  }, ja;
}
var kl;
function N1() {
  if (kl) return Ln.exports;
  kl = 1;
  const { normalizeIPv6: t, removeDotSegments: e, recomposeAuthority: r, normalizeComponentEncoding: n, isIPv4: i, nonSimpleDomain: s } = wm(), { SCHEMES: a, getSchemeHandler: o } = A1();
  function c(m, v) {
    return typeof m == "string" ? m = /** @type {T} */
    l(g(m, v), v) : typeof m == "object" && (m = /** @type {T} */
    g(l(m, v), v)), m;
  }
  function h(m, v, p) {
    const E = p ? Object.assign({ scheme: "null" }, p) : { scheme: "null" }, _ = f(g(m, E), g(v, E), E, !0);
    return E.skipEscape = !0, l(_, E);
  }
  function f(m, v, p, E) {
    const _ = {};
    return E || (m = g(l(m, p), p), v = g(l(v, p), p)), p = p || {}, !p.tolerant && v.scheme ? (_.scheme = v.scheme, _.userinfo = v.userinfo, _.host = v.host, _.port = v.port, _.path = e(v.path || ""), _.query = v.query) : (v.userinfo !== void 0 || v.host !== void 0 || v.port !== void 0 ? (_.userinfo = v.userinfo, _.host = v.host, _.port = v.port, _.path = e(v.path || ""), _.query = v.query) : (v.path ? (v.path[0] === "/" ? _.path = e(v.path) : ((m.userinfo !== void 0 || m.host !== void 0 || m.port !== void 0) && !m.path ? _.path = "/" + v.path : m.path ? _.path = m.path.slice(0, m.path.lastIndexOf("/") + 1) + v.path : _.path = v.path, _.path = e(_.path)), _.query = v.query) : (_.path = m.path, v.query !== void 0 ? _.query = v.query : _.query = m.query), _.userinfo = m.userinfo, _.host = m.host, _.port = m.port), _.scheme = m.scheme), _.fragment = v.fragment, _;
  }
  function u(m, v, p) {
    return typeof m == "string" ? (m = unescape(m), m = l(n(g(m, p), !0), { ...p, skipEscape: !0 })) : typeof m == "object" && (m = l(n(m, !0), { ...p, skipEscape: !0 })), typeof v == "string" ? (v = unescape(v), v = l(n(g(v, p), !0), { ...p, skipEscape: !0 })) : typeof v == "object" && (v = l(n(v, !0), { ...p, skipEscape: !0 })), m.toLowerCase() === v.toLowerCase();
  }
  function l(m, v) {
    const p = {
      host: m.host,
      scheme: m.scheme,
      userinfo: m.userinfo,
      port: m.port,
      path: m.path,
      query: m.query,
      nid: m.nid,
      nss: m.nss,
      uuid: m.uuid,
      fragment: m.fragment,
      reference: m.reference,
      resourceName: m.resourceName,
      secure: m.secure,
      error: ""
    }, E = Object.assign({}, v), _ = [], y = o(E.scheme || p.scheme);
    y && y.serialize && y.serialize(p, E), p.path !== void 0 && (E.skipEscape ? p.path = unescape(p.path) : (p.path = escape(p.path), p.scheme !== void 0 && (p.path = p.path.split("%3A").join(":")))), E.reference !== "suffix" && p.scheme && _.push(p.scheme, ":");
    const b = r(p);
    if (b !== void 0 && (E.reference !== "suffix" && _.push("//"), _.push(b), p.path && p.path[0] !== "/" && _.push("/")), p.path !== void 0) {
      let S = p.path;
      !E.absolutePath && (!y || !y.absolutePath) && (S = e(S)), b === void 0 && S[0] === "/" && S[1] === "/" && (S = "/%2F" + S.slice(2)), _.push(S);
    }
    return p.query !== void 0 && _.push("?", p.query), p.fragment !== void 0 && _.push("#", p.fragment), _.join("");
  }
  const d = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
  function g(m, v) {
    const p = Object.assign({}, v), E = {
      scheme: void 0,
      userinfo: void 0,
      host: "",
      port: void 0,
      path: "",
      query: void 0,
      fragment: void 0
    };
    let _ = !1;
    p.reference === "suffix" && (p.scheme ? m = p.scheme + ":" + m : m = "//" + m);
    const y = m.match(d);
    if (y) {
      if (E.scheme = y[1], E.userinfo = y[3], E.host = y[4], E.port = parseInt(y[5], 10), E.path = y[6] || "", E.query = y[7], E.fragment = y[8], isNaN(E.port) && (E.port = y[5]), E.host)
        if (i(E.host) === !1) {
          const x = t(E.host);
          E.host = x.host.toLowerCase(), _ = x.isIPV6;
        } else
          _ = !0;
      E.scheme === void 0 && E.userinfo === void 0 && E.host === void 0 && E.port === void 0 && E.query === void 0 && !E.path ? E.reference = "same-document" : E.scheme === void 0 ? E.reference = "relative" : E.fragment === void 0 ? E.reference = "absolute" : E.reference = "uri", p.reference && p.reference !== "suffix" && p.reference !== E.reference && (E.error = E.error || "URI is not a " + p.reference + " reference.");
      const b = o(p.scheme || E.scheme);
      if (!p.unicodeSupport && (!b || !b.unicodeSupport) && E.host && (p.domainHost || b && b.domainHost) && _ === !1 && s(E.host))
        try {
          E.host = URL.domainToASCII(E.host.toLowerCase());
        } catch (S) {
          E.error = E.error || "Host's domain name can not be converted to ASCII: " + S;
        }
      (!b || b && !b.skipNormalize) && (m.indexOf("%") !== -1 && (E.scheme !== void 0 && (E.scheme = unescape(E.scheme)), E.host !== void 0 && (E.host = unescape(E.host))), E.path && (E.path = escape(unescape(E.path))), E.fragment && (E.fragment = encodeURI(decodeURIComponent(E.fragment)))), b && b.parse && b.parse(E, p);
    } else
      E.error = E.error || "URI can not be parsed.";
    return E;
  }
  const w = {
    SCHEMES: a,
    normalize: c,
    resolve: h,
    resolveComponent: f,
    equal: u,
    serialize: l,
    parse: g
  };
  return Ln.exports = w, Ln.exports.default = w, Ln.exports.fastUri = w, Ln.exports;
}
var $l;
function O1() {
  if ($l) return ki;
  $l = 1, Object.defineProperty(ki, "__esModule", { value: !0 });
  const t = N1();
  return t.code = 'require("ajv/dist/runtime/uri").default', ki.default = t, ki;
}
var Il;
function _m() {
  return Il || (Il = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = void 0;
    var e = ci();
    Object.defineProperty(t, "KeywordCxt", { enumerable: !0, get: function() {
      return e.KeywordCxt;
    } });
    var r = kt();
    Object.defineProperty(t, "_", { enumerable: !0, get: function() {
      return r._;
    } }), Object.defineProperty(t, "str", { enumerable: !0, get: function() {
      return r.str;
    } }), Object.defineProperty(t, "stringify", { enumerable: !0, get: function() {
      return r.stringify;
    } }), Object.defineProperty(t, "nil", { enumerable: !0, get: function() {
      return r.nil;
    } }), Object.defineProperty(t, "Name", { enumerable: !0, get: function() {
      return r.Name;
    } }), Object.defineProperty(t, "CodeGen", { enumerable: !0, get: function() {
      return r.CodeGen;
    } });
    const n = da(), i = hi(), s = pm(), a = ma(), o = kt(), c = fa(), h = Ys(), f = Rt(), u = P1, l = O1(), d = (R, D) => new RegExp(R, D);
    d.code = "new RegExp";
    const g = ["removeAdditional", "useDefaults", "coerceTypes"], w = /* @__PURE__ */ new Set([
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
    ]), m = {
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
    }, v = {
      ignoreKeywordsWithRef: "",
      jsPropertySyntax: "",
      unicode: '"minLength"/"maxLength" account for unicode characters by default.'
    }, p = 200;
    function E(R) {
      var D, G, L, A, P, U, K, J, et, rt, z, B, X, Y, nt, vt, xt, re, ne, ie, Ct, te, se, rr, nr;
      const fr = R.strict, qr = (D = R.code) === null || D === void 0 ? void 0 : D.optimize, Ur = qr === !0 || qr === void 0 ? 1 : qr || 0, cn = (L = (G = R.code) === null || G === void 0 ? void 0 : G.regExp) !== null && L !== void 0 ? L : d, Dn = (A = R.uriResolver) !== null && A !== void 0 ? A : l.default;
      return {
        strictSchema: (U = (P = R.strictSchema) !== null && P !== void 0 ? P : fr) !== null && U !== void 0 ? U : !0,
        strictNumbers: (J = (K = R.strictNumbers) !== null && K !== void 0 ? K : fr) !== null && J !== void 0 ? J : !0,
        strictTypes: (rt = (et = R.strictTypes) !== null && et !== void 0 ? et : fr) !== null && rt !== void 0 ? rt : "log",
        strictTuples: (B = (z = R.strictTuples) !== null && z !== void 0 ? z : fr) !== null && B !== void 0 ? B : "log",
        strictRequired: (Y = (X = R.strictRequired) !== null && X !== void 0 ? X : fr) !== null && Y !== void 0 ? Y : !1,
        code: R.code ? { ...R.code, optimize: Ur, regExp: cn } : { optimize: Ur, regExp: cn },
        loopRequired: (nt = R.loopRequired) !== null && nt !== void 0 ? nt : p,
        loopEnum: (vt = R.loopEnum) !== null && vt !== void 0 ? vt : p,
        meta: (xt = R.meta) !== null && xt !== void 0 ? xt : !0,
        messages: (re = R.messages) !== null && re !== void 0 ? re : !0,
        inlineRefs: (ne = R.inlineRefs) !== null && ne !== void 0 ? ne : !0,
        schemaId: (ie = R.schemaId) !== null && ie !== void 0 ? ie : "$id",
        addUsedSchema: (Ct = R.addUsedSchema) !== null && Ct !== void 0 ? Ct : !0,
        validateSchema: (te = R.validateSchema) !== null && te !== void 0 ? te : !0,
        validateFormats: (se = R.validateFormats) !== null && se !== void 0 ? se : !0,
        unicodeRegExp: (rr = R.unicodeRegExp) !== null && rr !== void 0 ? rr : !0,
        int32range: (nr = R.int32range) !== null && nr !== void 0 ? nr : !0,
        uriResolver: Dn
      };
    }
    class _ {
      constructor(D = {}) {
        this.schemas = {}, this.refs = {}, this.formats = {}, this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), D = this.opts = { ...D, ...E(D) };
        const { es5: G, lines: L } = this.opts.code;
        this.scope = new o.ValueScope({ scope: {}, prefixes: w, es5: G, lines: L }), this.logger = O(D.logger);
        const A = D.validateFormats;
        D.validateFormats = !1, this.RULES = (0, s.getRules)(), y.call(this, m, D, "NOT SUPPORTED"), y.call(this, v, D, "DEPRECATED", "warn"), this._metaOpts = k.call(this), D.formats && x.call(this), this._addVocabularies(), this._addDefaultMetaSchema(), D.keywords && M.call(this, D.keywords), typeof D.meta == "object" && this.addMetaSchema(D.meta), S.call(this), D.validateFormats = A;
      }
      _addVocabularies() {
        this.addKeyword("$async");
      }
      _addDefaultMetaSchema() {
        const { $data: D, meta: G, schemaId: L } = this.opts;
        let A = u;
        L === "id" && (A = { ...u }, A.id = A.$id, delete A.$id), G && D && this.addMetaSchema(A, A[L], !1);
      }
      defaultMeta() {
        const { meta: D, schemaId: G } = this.opts;
        return this.opts.defaultMeta = typeof D == "object" ? D[G] || D : void 0;
      }
      validate(D, G) {
        let L;
        if (typeof D == "string") {
          if (L = this.getSchema(D), !L)
            throw new Error(`no schema with key or ref "${D}"`);
        } else
          L = this.compile(D);
        const A = L(G);
        return "$async" in L || (this.errors = L.errors), A;
      }
      compile(D, G) {
        const L = this._addSchema(D, G);
        return L.validate || this._compileSchemaEnv(L);
      }
      compileAsync(D, G) {
        if (typeof this.opts.loadSchema != "function")
          throw new Error("options.loadSchema should be a function");
        const { loadSchema: L } = this.opts;
        return A.call(this, D, G);
        async function A(rt, z) {
          await P.call(this, rt.$schema);
          const B = this._addSchema(rt, z);
          return B.validate || U.call(this, B);
        }
        async function P(rt) {
          rt && !this.getSchema(rt) && await A.call(this, { $ref: rt }, !0);
        }
        async function U(rt) {
          try {
            return this._compileSchemaEnv(rt);
          } catch (z) {
            if (!(z instanceof i.default))
              throw z;
            return K.call(this, z), await J.call(this, z.missingSchema), U.call(this, rt);
          }
        }
        function K({ missingSchema: rt, missingRef: z }) {
          if (this.refs[rt])
            throw new Error(`AnySchema ${rt} is loaded but ${z} cannot be resolved`);
        }
        async function J(rt) {
          const z = await et.call(this, rt);
          this.refs[rt] || await P.call(this, z.$schema), this.refs[rt] || this.addSchema(z, rt, G);
        }
        async function et(rt) {
          const z = this._loading[rt];
          if (z)
            return z;
          try {
            return await (this._loading[rt] = L(rt));
          } finally {
            delete this._loading[rt];
          }
        }
      }
      // Adds schema to the instance
      addSchema(D, G, L, A = this.opts.validateSchema) {
        if (Array.isArray(D)) {
          for (const U of D)
            this.addSchema(U, void 0, L, A);
          return this;
        }
        let P;
        if (typeof D == "object") {
          const { schemaId: U } = this.opts;
          if (P = D[U], P !== void 0 && typeof P != "string")
            throw new Error(`schema ${U} must be string`);
        }
        return G = (0, c.normalizeId)(G || P), this._checkUnique(G), this.schemas[G] = this._addSchema(D, L, G, A, !0), this;
      }
      // Add schema that will be used to validate other schemas
      // options in META_IGNORE_OPTIONS are alway set to false
      addMetaSchema(D, G, L = this.opts.validateSchema) {
        return this.addSchema(D, G, !0, L), this;
      }
      //  Validate schema against its meta-schema
      validateSchema(D, G) {
        if (typeof D == "boolean")
          return !0;
        let L;
        if (L = D.$schema, L !== void 0 && typeof L != "string")
          throw new Error("$schema must be a string");
        if (L = L || this.opts.defaultMeta || this.defaultMeta(), !L)
          return this.logger.warn("meta-schema not available"), this.errors = null, !0;
        const A = this.validate(L, D);
        if (!A && G) {
          const P = "schema is invalid: " + this.errorsText();
          if (this.opts.validateSchema === "log")
            this.logger.error(P);
          else
            throw new Error(P);
        }
        return A;
      }
      // Get compiled schema by `key` or `ref`.
      // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
      getSchema(D) {
        let G;
        for (; typeof (G = b.call(this, D)) == "string"; )
          D = G;
        if (G === void 0) {
          const { schemaId: L } = this.opts, A = new a.SchemaEnv({ schema: {}, schemaId: L });
          if (G = a.resolveSchema.call(this, A, D), !G)
            return;
          this.refs[D] = G;
        }
        return G.validate || this._compileSchemaEnv(G);
      }
      // Remove cached schema(s).
      // If no parameter is passed all schemas but meta-schemas are removed.
      // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
      // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
      removeSchema(D) {
        if (D instanceof RegExp)
          return this._removeAllSchemas(this.schemas, D), this._removeAllSchemas(this.refs, D), this;
        switch (typeof D) {
          case "undefined":
            return this._removeAllSchemas(this.schemas), this._removeAllSchemas(this.refs), this._cache.clear(), this;
          case "string": {
            const G = b.call(this, D);
            return typeof G == "object" && this._cache.delete(G.schema), delete this.schemas[D], delete this.refs[D], this;
          }
          case "object": {
            const G = D;
            this._cache.delete(G);
            let L = D[this.opts.schemaId];
            return L && (L = (0, c.normalizeId)(L), delete this.schemas[L], delete this.refs[L]), this;
          }
          default:
            throw new Error("ajv.removeSchema: invalid parameter");
        }
      }
      // add "vocabulary" - a collection of keywords
      addVocabulary(D) {
        for (const G of D)
          this.addKeyword(G);
        return this;
      }
      addKeyword(D, G) {
        let L;
        if (typeof D == "string")
          L = D, typeof G == "object" && (this.logger.warn("these parameters are deprecated, see docs for addKeyword"), G.keyword = L);
        else if (typeof D == "object" && G === void 0) {
          if (G = D, L = G.keyword, Array.isArray(L) && !L.length)
            throw new Error("addKeywords: keyword must be string or non-empty array");
        } else
          throw new Error("invalid addKeywords parameters");
        if (I.call(this, L, G), !G)
          return (0, f.eachItem)(L, (P) => N.call(this, P)), this;
        C.call(this, G);
        const A = {
          ...G,
          type: (0, h.getJSONTypes)(G.type),
          schemaType: (0, h.getJSONTypes)(G.schemaType)
        };
        return (0, f.eachItem)(L, A.type.length === 0 ? (P) => N.call(this, P, A) : (P) => A.type.forEach((U) => N.call(this, P, A, U))), this;
      }
      getKeyword(D) {
        const G = this.RULES.all[D];
        return typeof G == "object" ? G.definition : !!G;
      }
      // Remove keyword
      removeKeyword(D) {
        const { RULES: G } = this;
        delete G.keywords[D], delete G.all[D];
        for (const L of G.rules) {
          const A = L.rules.findIndex((P) => P.keyword === D);
          A >= 0 && L.rules.splice(A, 1);
        }
        return this;
      }
      // Add format
      addFormat(D, G) {
        return typeof G == "string" && (G = new RegExp(G)), this.formats[D] = G, this;
      }
      errorsText(D = this.errors, { separator: G = ", ", dataVar: L = "data" } = {}) {
        return !D || D.length === 0 ? "No errors" : D.map((A) => `${L}${A.instancePath} ${A.message}`).reduce((A, P) => A + G + P);
      }
      $dataMetaSchema(D, G) {
        const L = this.RULES.all;
        D = JSON.parse(JSON.stringify(D));
        for (const A of G) {
          const P = A.split("/").slice(1);
          let U = D;
          for (const K of P)
            U = U[K];
          for (const K in L) {
            const J = L[K];
            if (typeof J != "object")
              continue;
            const { $data: et } = J.definition, rt = U[K];
            et && rt && (U[K] = q(rt));
          }
        }
        return D;
      }
      _removeAllSchemas(D, G) {
        for (const L in D) {
          const A = D[L];
          (!G || G.test(L)) && (typeof A == "string" ? delete D[L] : A && !A.meta && (this._cache.delete(A.schema), delete D[L]));
        }
      }
      _addSchema(D, G, L, A = this.opts.validateSchema, P = this.opts.addUsedSchema) {
        let U;
        const { schemaId: K } = this.opts;
        if (typeof D == "object")
          U = D[K];
        else {
          if (this.opts.jtd)
            throw new Error("schema must be object");
          if (typeof D != "boolean")
            throw new Error("schema must be object or boolean");
        }
        let J = this._cache.get(D);
        if (J !== void 0)
          return J;
        L = (0, c.normalizeId)(U || L);
        const et = c.getSchemaRefs.call(this, D, L);
        return J = new a.SchemaEnv({ schema: D, schemaId: K, meta: G, baseId: L, localRefs: et }), this._cache.set(J.schema, J), P && !L.startsWith("#") && (L && this._checkUnique(L), this.refs[L] = J), A && this.validateSchema(D, !0), J;
      }
      _checkUnique(D) {
        if (this.schemas[D] || this.refs[D])
          throw new Error(`schema with key or id "${D}" already exists`);
      }
      _compileSchemaEnv(D) {
        if (D.meta ? this._compileMetaSchema(D) : a.compileSchema.call(this, D), !D.validate)
          throw new Error("ajv implementation error");
        return D.validate;
      }
      _compileMetaSchema(D) {
        const G = this.opts;
        this.opts = this._metaOpts;
        try {
          a.compileSchema.call(this, D);
        } finally {
          this.opts = G;
        }
      }
    }
    _.ValidationError = n.default, _.MissingRefError = i.default, t.default = _;
    function y(R, D, G, L = "error") {
      for (const A in R) {
        const P = A;
        P in D && this.logger[L](`${G}: option ${A}. ${R[P]}`);
      }
    }
    function b(R) {
      return R = (0, c.normalizeId)(R), this.schemas[R] || this.refs[R];
    }
    function S() {
      const R = this.opts.schemas;
      if (R)
        if (Array.isArray(R))
          this.addSchema(R);
        else
          for (const D in R)
            this.addSchema(R[D], D);
    }
    function x() {
      for (const R in this.opts.formats) {
        const D = this.opts.formats[R];
        D && this.addFormat(R, D);
      }
    }
    function M(R) {
      if (Array.isArray(R)) {
        this.addVocabulary(R);
        return;
      }
      this.logger.warn("keywords option as map is deprecated, pass array");
      for (const D in R) {
        const G = R[D];
        G.keyword || (G.keyword = D), this.addKeyword(G);
      }
    }
    function k() {
      const R = { ...this.opts };
      for (const D of g)
        delete R[D];
      return R;
    }
    const $ = { log() {
    }, warn() {
    }, error() {
    } };
    function O(R) {
      if (R === !1)
        return $;
      if (R === void 0)
        return console;
      if (R.log && R.warn && R.error)
        return R;
      throw new Error("logger must implement log, warn and error methods");
    }
    const T = /^[a-z_$][a-z0-9_$:-]*$/i;
    function I(R, D) {
      const { RULES: G } = this;
      if ((0, f.eachItem)(R, (L) => {
        if (G.keywords[L])
          throw new Error(`Keyword ${L} is already defined`);
        if (!T.test(L))
          throw new Error(`Keyword ${L} has invalid name`);
      }), !!D && D.$data && !("code" in D || "validate" in D))
        throw new Error('$data keyword must have "code" or "validate" function');
    }
    function N(R, D, G) {
      var L;
      const A = D?.post;
      if (G && A)
        throw new Error('keyword with "post" flag cannot have "type"');
      const { RULES: P } = this;
      let U = A ? P.post : P.rules.find(({ type: J }) => J === G);
      if (U || (U = { type: G, rules: [] }, P.rules.push(U)), P.keywords[R] = !0, !D)
        return;
      const K = {
        keyword: R,
        definition: {
          ...D,
          type: (0, h.getJSONTypes)(D.type),
          schemaType: (0, h.getJSONTypes)(D.schemaType)
        }
      };
      D.before ? j.call(this, U, K, D.before) : U.rules.push(K), P.all[R] = K, (L = D.implements) === null || L === void 0 || L.forEach((J) => this.addKeyword(J));
    }
    function j(R, D, G) {
      const L = R.rules.findIndex((A) => A.keyword === G);
      L >= 0 ? R.rules.splice(L, 0, D) : (R.rules.push(D), this.logger.warn(`rule ${G} is not defined`));
    }
    function C(R) {
      let { metaSchema: D } = R;
      D !== void 0 && (R.$data && this.opts.$data && (D = q(D)), R.validateSchema = this.compile(D, !0));
    }
    const F = {
      $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
    };
    function q(R) {
      return { anyOf: [R, F] };
    }
  })($a)), $a;
}
var $i = {}, Ii = {}, Pi = {}, Pl;
function R1() {
  if (Pl) return Pi;
  Pl = 1, Object.defineProperty(Pi, "__esModule", { value: !0 });
  const t = {
    keyword: "id",
    code() {
      throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
    }
  };
  return Pi.default = t, Pi;
}
var $r = {}, Al;
function _h() {
  if (Al) return $r;
  Al = 1, Object.defineProperty($r, "__esModule", { value: !0 }), $r.callRef = $r.getValidate = void 0;
  const t = hi(), e = Qe(), r = kt(), n = Ye(), i = ma(), s = Rt(), a = {
    keyword: "$ref",
    schemaType: "string",
    code(h) {
      const { gen: f, schema: u, it: l } = h, { baseId: d, schemaEnv: g, validateName: w, opts: m, self: v } = l, { root: p } = g;
      if ((u === "#" || u === "#/") && d === p.baseId)
        return _();
      const E = i.resolveRef.call(v, p, d, u);
      if (E === void 0)
        throw new t.default(l.opts.uriResolver, d, u);
      if (E instanceof i.SchemaEnv)
        return y(E);
      return b(E);
      function _() {
        if (g === p)
          return c(h, w, g, g.$async);
        const S = f.scopeValue("root", { ref: p });
        return c(h, (0, r._)`${S}.validate`, p, p.$async);
      }
      function y(S) {
        const x = o(h, S);
        c(h, x, S, S.$async);
      }
      function b(S) {
        const x = f.scopeValue("schema", m.code.source === !0 ? { ref: S, code: (0, r.stringify)(S) } : { ref: S }), M = f.name("valid"), k = h.subschema({
          schema: S,
          dataTypes: [],
          schemaPath: r.nil,
          topSchemaRef: x,
          errSchemaPath: u
        }, M);
        h.mergeEvaluated(k), h.ok(M);
      }
    }
  };
  function o(h, f) {
    const { gen: u } = h;
    return f.validate ? u.scopeValue("validate", { ref: f.validate }) : (0, r._)`${u.scopeValue("wrapper", { ref: f })}.validate`;
  }
  $r.getValidate = o;
  function c(h, f, u, l) {
    const { gen: d, it: g } = h, { allErrors: w, schemaEnv: m, opts: v } = g, p = v.passContext ? n.default.this : r.nil;
    l ? E() : _();
    function E() {
      if (!m.$async)
        throw new Error("async schema referenced by sync schema");
      const S = d.let("valid");
      d.try(() => {
        d.code((0, r._)`await ${(0, e.callValidateCode)(h, f, p)}`), b(f), w || d.assign(S, !0);
      }, (x) => {
        d.if((0, r._)`!(${x} instanceof ${g.ValidationError})`, () => d.throw(x)), y(x), w || d.assign(S, !1);
      }), h.ok(S);
    }
    function _() {
      h.result((0, e.callValidateCode)(h, f, p), () => b(f), () => y(f));
    }
    function y(S) {
      const x = (0, r._)`${S}.errors`;
      d.assign(n.default.vErrors, (0, r._)`${n.default.vErrors} === null ? ${x} : ${n.default.vErrors}.concat(${x})`), d.assign(n.default.errors, (0, r._)`${n.default.vErrors}.length`);
    }
    function b(S) {
      var x;
      if (!g.opts.unevaluated)
        return;
      const M = (x = u?.validate) === null || x === void 0 ? void 0 : x.evaluated;
      if (g.props !== !0)
        if (M && !M.dynamicProps)
          M.props !== void 0 && (g.props = s.mergeEvaluated.props(d, M.props, g.props));
        else {
          const k = d.var("props", (0, r._)`${S}.evaluated.props`);
          g.props = s.mergeEvaluated.props(d, k, g.props, r.Name);
        }
      if (g.items !== !0)
        if (M && !M.dynamicItems)
          M.items !== void 0 && (g.items = s.mergeEvaluated.items(d, M.items, g.items));
        else {
          const k = d.var("items", (0, r._)`${S}.evaluated.items`);
          g.items = s.mergeEvaluated.items(d, k, g.items, r.Name);
        }
    }
  }
  return $r.callRef = c, $r.default = a, $r;
}
var Nl;
function vm() {
  if (Nl) return Ii;
  Nl = 1, Object.defineProperty(Ii, "__esModule", { value: !0 });
  const t = R1(), e = _h(), r = [
    "$schema",
    "$id",
    "$defs",
    "$vocabulary",
    { keyword: "$comment" },
    "definitions",
    t.default,
    e.default
  ];
  return Ii.default = r, Ii;
}
var Ai = {}, Ni = {}, Ol;
function D1() {
  if (Ol) return Ni;
  Ol = 1, Object.defineProperty(Ni, "__esModule", { value: !0 });
  const t = kt(), e = t.operators, r = {
    maximum: { okStr: "<=", ok: e.LTE, fail: e.GT },
    minimum: { okStr: ">=", ok: e.GTE, fail: e.LT },
    exclusiveMaximum: { okStr: "<", ok: e.LT, fail: e.GTE },
    exclusiveMinimum: { okStr: ">", ok: e.GT, fail: e.LTE }
  }, n = {
    message: ({ keyword: s, schemaCode: a }) => (0, t.str)`must be ${r[s].okStr} ${a}`,
    params: ({ keyword: s, schemaCode: a }) => (0, t._)`{comparison: ${r[s].okStr}, limit: ${a}}`
  }, i = {
    keyword: Object.keys(r),
    type: "number",
    schemaType: "number",
    $data: !0,
    error: n,
    code(s) {
      const { keyword: a, data: o, schemaCode: c } = s;
      s.fail$data((0, t._)`${o} ${r[a].fail} ${c} || isNaN(${o})`);
    }
  };
  return Ni.default = i, Ni;
}
var Oi = {}, Rl;
function j1() {
  if (Rl) return Oi;
  Rl = 1, Object.defineProperty(Oi, "__esModule", { value: !0 });
  const t = kt(), r = {
    keyword: "multipleOf",
    type: "number",
    schemaType: "number",
    $data: !0,
    error: {
      message: ({ schemaCode: n }) => (0, t.str)`must be multiple of ${n}`,
      params: ({ schemaCode: n }) => (0, t._)`{multipleOf: ${n}}`
    },
    code(n) {
      const { gen: i, data: s, schemaCode: a, it: o } = n, c = o.opts.multipleOfPrecision, h = i.let("res"), f = c ? (0, t._)`Math.abs(Math.round(${h}) - ${h}) > 1e-${c}` : (0, t._)`${h} !== parseInt(${h})`;
      n.fail$data((0, t._)`(${a} === 0 || (${h} = ${s}/${a}, ${f}))`);
    }
  };
  return Oi.default = r, Oi;
}
var Ri = {}, Di = {}, Dl;
function T1() {
  if (Dl) return Di;
  Dl = 1, Object.defineProperty(Di, "__esModule", { value: !0 });
  function t(e) {
    const r = e.length;
    let n = 0, i = 0, s;
    for (; i < r; )
      n++, s = e.charCodeAt(i++), s >= 55296 && s <= 56319 && i < r && (s = e.charCodeAt(i), (s & 64512) === 56320 && i++);
    return n;
  }
  return Di.default = t, t.code = 'require("ajv/dist/runtime/ucs2length").default', Di;
}
var jl;
function C1() {
  if (jl) return Ri;
  jl = 1, Object.defineProperty(Ri, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), r = T1(), i = {
    keyword: ["maxLength", "minLength"],
    type: "string",
    schemaType: "number",
    $data: !0,
    error: {
      message({ keyword: s, schemaCode: a }) {
        const o = s === "maxLength" ? "more" : "fewer";
        return (0, t.str)`must NOT have ${o} than ${a} characters`;
      },
      params: ({ schemaCode: s }) => (0, t._)`{limit: ${s}}`
    },
    code(s) {
      const { keyword: a, data: o, schemaCode: c, it: h } = s, f = a === "maxLength" ? t.operators.GT : t.operators.LT, u = h.opts.unicode === !1 ? (0, t._)`${o}.length` : (0, t._)`${(0, e.useFunc)(s.gen, r.default)}(${o})`;
      s.fail$data((0, t._)`${u} ${f} ${c}`);
    }
  };
  return Ri.default = i, Ri;
}
var ji = {}, Tl;
function L1() {
  if (Tl) return ji;
  Tl = 1, Object.defineProperty(ji, "__esModule", { value: !0 });
  const t = Qe(), e = kt(), n = {
    keyword: "pattern",
    type: "string",
    schemaType: "string",
    $data: !0,
    error: {
      message: ({ schemaCode: i }) => (0, e.str)`must match pattern "${i}"`,
      params: ({ schemaCode: i }) => (0, e._)`{pattern: ${i}}`
    },
    code(i) {
      const { data: s, $data: a, schema: o, schemaCode: c, it: h } = i, f = h.opts.unicodeRegExp ? "u" : "", u = a ? (0, e._)`(new RegExp(${c}, ${f}))` : (0, t.usePattern)(i, o);
      i.fail$data((0, e._)`!${u}.test(${s})`);
    }
  };
  return ji.default = n, ji;
}
var Ti = {}, Cl;
function F1() {
  if (Cl) return Ti;
  Cl = 1, Object.defineProperty(Ti, "__esModule", { value: !0 });
  const t = kt(), r = {
    keyword: ["maxProperties", "minProperties"],
    type: "object",
    schemaType: "number",
    $data: !0,
    error: {
      message({ keyword: n, schemaCode: i }) {
        const s = n === "maxProperties" ? "more" : "fewer";
        return (0, t.str)`must NOT have ${s} than ${i} properties`;
      },
      params: ({ schemaCode: n }) => (0, t._)`{limit: ${n}}`
    },
    code(n) {
      const { keyword: i, data: s, schemaCode: a } = n, o = i === "maxProperties" ? t.operators.GT : t.operators.LT;
      n.fail$data((0, t._)`Object.keys(${s}).length ${o} ${a}`);
    }
  };
  return Ti.default = r, Ti;
}
var Ci = {}, Ll;
function G1() {
  if (Ll) return Ci;
  Ll = 1, Object.defineProperty(Ci, "__esModule", { value: !0 });
  const t = Qe(), e = kt(), r = Rt(), i = {
    keyword: "required",
    type: "object",
    schemaType: "array",
    $data: !0,
    error: {
      message: ({ params: { missingProperty: s } }) => (0, e.str)`must have required property '${s}'`,
      params: ({ params: { missingProperty: s } }) => (0, e._)`{missingProperty: ${s}}`
    },
    code(s) {
      const { gen: a, schema: o, schemaCode: c, data: h, $data: f, it: u } = s, { opts: l } = u;
      if (!f && o.length === 0)
        return;
      const d = o.length >= l.loopRequired;
      if (u.allErrors ? g() : w(), l.strictRequired) {
        const p = s.parentSchema.properties, { definedProperties: E } = s.it;
        for (const _ of o)
          if (p?.[_] === void 0 && !E.has(_)) {
            const y = u.schemaEnv.baseId + u.errSchemaPath, b = `required property "${_}" is not defined at "${y}" (strictRequired)`;
            (0, r.checkStrictMode)(u, b, u.opts.strictRequired);
          }
      }
      function g() {
        if (d || f)
          s.block$data(e.nil, m);
        else
          for (const p of o)
            (0, t.checkReportMissingProp)(s, p);
      }
      function w() {
        const p = a.let("missing");
        if (d || f) {
          const E = a.let("valid", !0);
          s.block$data(E, () => v(p, E)), s.ok(E);
        } else
          a.if((0, t.checkMissingProp)(s, o, p)), (0, t.reportMissingProp)(s, p), a.else();
      }
      function m() {
        a.forOf("prop", c, (p) => {
          s.setParams({ missingProperty: p }), a.if((0, t.noPropertyInData)(a, h, p, l.ownProperties), () => s.error());
        });
      }
      function v(p, E) {
        s.setParams({ missingProperty: p }), a.forOf(p, c, () => {
          a.assign(E, (0, t.propertyInData)(a, h, p, l.ownProperties)), a.if((0, e.not)(E), () => {
            s.error(), a.break();
          });
        }, e.nil);
      }
    }
  };
  return Ci.default = i, Ci;
}
var Li = {}, Fl;
function z1() {
  if (Fl) return Li;
  Fl = 1, Object.defineProperty(Li, "__esModule", { value: !0 });
  const t = kt(), r = {
    keyword: ["maxItems", "minItems"],
    type: "array",
    schemaType: "number",
    $data: !0,
    error: {
      message({ keyword: n, schemaCode: i }) {
        const s = n === "maxItems" ? "more" : "fewer";
        return (0, t.str)`must NOT have ${s} than ${i} items`;
      },
      params: ({ schemaCode: n }) => (0, t._)`{limit: ${n}}`
    },
    code(n) {
      const { keyword: i, data: s, schemaCode: a } = n, o = i === "maxItems" ? t.operators.GT : t.operators.LT;
      n.fail$data((0, t._)`${s}.length ${o} ${a}`);
    }
  };
  return Li.default = r, Li;
}
var Fi = {}, Gi = {}, Gl;
function vh() {
  if (Gl) return Gi;
  Gl = 1, Object.defineProperty(Gi, "__esModule", { value: !0 });
  const t = gm();
  return t.code = 'require("ajv/dist/runtime/equal").default', Gi.default = t, Gi;
}
var zl;
function q1() {
  if (zl) return Fi;
  zl = 1, Object.defineProperty(Fi, "__esModule", { value: !0 });
  const t = Ys(), e = kt(), r = Rt(), n = vh(), s = {
    keyword: "uniqueItems",
    type: "array",
    schemaType: "boolean",
    $data: !0,
    error: {
      message: ({ params: { i: a, j: o } }) => (0, e.str)`must NOT have duplicate items (items ## ${o} and ${a} are identical)`,
      params: ({ params: { i: a, j: o } }) => (0, e._)`{i: ${a}, j: ${o}}`
    },
    code(a) {
      const { gen: o, data: c, $data: h, schema: f, parentSchema: u, schemaCode: l, it: d } = a;
      if (!h && !f)
        return;
      const g = o.let("valid"), w = u.items ? (0, t.getSchemaTypes)(u.items) : [];
      a.block$data(g, m, (0, e._)`${l} === false`), a.ok(g);
      function m() {
        const _ = o.let("i", (0, e._)`${c}.length`), y = o.let("j");
        a.setParams({ i: _, j: y }), o.assign(g, !0), o.if((0, e._)`${_} > 1`, () => (v() ? p : E)(_, y));
      }
      function v() {
        return w.length > 0 && !w.some((_) => _ === "object" || _ === "array");
      }
      function p(_, y) {
        const b = o.name("item"), S = (0, t.checkDataTypes)(w, b, d.opts.strictNumbers, t.DataType.Wrong), x = o.const("indices", (0, e._)`{}`);
        o.for((0, e._)`;${_}--;`, () => {
          o.let(b, (0, e._)`${c}[${_}]`), o.if(S, (0, e._)`continue`), w.length > 1 && o.if((0, e._)`typeof ${b} == "string"`, (0, e._)`${b} += "_"`), o.if((0, e._)`typeof ${x}[${b}] == "number"`, () => {
            o.assign(y, (0, e._)`${x}[${b}]`), a.error(), o.assign(g, !1).break();
          }).code((0, e._)`${x}[${b}] = ${_}`);
        });
      }
      function E(_, y) {
        const b = (0, r.useFunc)(o, n.default), S = o.name("outer");
        o.label(S).for((0, e._)`;${_}--;`, () => o.for((0, e._)`${y} = ${_}; ${y}--;`, () => o.if((0, e._)`${b}(${c}[${_}], ${c}[${y}])`, () => {
          a.error(), o.assign(g, !1).break(S);
        })));
      }
    }
  };
  return Fi.default = s, Fi;
}
var zi = {}, ql;
function U1() {
  if (ql) return zi;
  ql = 1, Object.defineProperty(zi, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), r = vh(), i = {
    keyword: "const",
    $data: !0,
    error: {
      message: "must be equal to constant",
      params: ({ schemaCode: s }) => (0, t._)`{allowedValue: ${s}}`
    },
    code(s) {
      const { gen: a, data: o, $data: c, schemaCode: h, schema: f } = s;
      c || f && typeof f == "object" ? s.fail$data((0, t._)`!${(0, e.useFunc)(a, r.default)}(${o}, ${h})`) : s.fail((0, t._)`${f} !== ${o}`);
    }
  };
  return zi.default = i, zi;
}
var qi = {}, Ul;
function B1() {
  if (Ul) return qi;
  Ul = 1, Object.defineProperty(qi, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), r = vh(), i = {
    keyword: "enum",
    schemaType: "array",
    $data: !0,
    error: {
      message: "must be equal to one of the allowed values",
      params: ({ schemaCode: s }) => (0, t._)`{allowedValues: ${s}}`
    },
    code(s) {
      const { gen: a, data: o, $data: c, schema: h, schemaCode: f, it: u } = s;
      if (!c && h.length === 0)
        throw new Error("enum must have non-empty array");
      const l = h.length >= u.opts.loopEnum;
      let d;
      const g = () => d ?? (d = (0, e.useFunc)(a, r.default));
      let w;
      if (l || c)
        w = a.let("valid"), s.block$data(w, m);
      else {
        if (!Array.isArray(h))
          throw new Error("ajv implementation error");
        const p = a.const("vSchema", f);
        w = (0, t.or)(...h.map((E, _) => v(p, _)));
      }
      s.pass(w);
      function m() {
        a.assign(w, !1), a.forOf("v", f, (p) => a.if((0, t._)`${g()}(${o}, ${p})`, () => a.assign(w, !0).break()));
      }
      function v(p, E) {
        const _ = h[E];
        return typeof _ == "object" && _ !== null ? (0, t._)`${g()}(${o}, ${p}[${E}])` : (0, t._)`${o} === ${_}`;
      }
    }
  };
  return qi.default = i, qi;
}
var Bl;
function Em() {
  if (Bl) return Ai;
  Bl = 1, Object.defineProperty(Ai, "__esModule", { value: !0 });
  const t = D1(), e = j1(), r = C1(), n = L1(), i = F1(), s = G1(), a = z1(), o = q1(), c = U1(), h = B1(), f = [
    // number
    t.default,
    e.default,
    // string
    r.default,
    n.default,
    // object
    i.default,
    s.default,
    // array
    a.default,
    o.default,
    // any
    { keyword: "type", schemaType: ["string", "array"] },
    { keyword: "nullable", schemaType: "boolean" },
    c.default,
    h.default
  ];
  return Ai.default = f, Ai;
}
var Ui = {}, hn = {}, Zl;
function bm() {
  if (Zl) return hn;
  Zl = 1, Object.defineProperty(hn, "__esModule", { value: !0 }), hn.validateAdditionalItems = void 0;
  const t = kt(), e = Rt(), n = {
    keyword: "additionalItems",
    type: "array",
    schemaType: ["boolean", "object"],
    before: "uniqueItems",
    error: {
      message: ({ params: { len: s } }) => (0, t.str)`must NOT have more than ${s} items`,
      params: ({ params: { len: s } }) => (0, t._)`{limit: ${s}}`
    },
    code(s) {
      const { parentSchema: a, it: o } = s, { items: c } = a;
      if (!Array.isArray(c)) {
        (0, e.checkStrictMode)(o, '"additionalItems" is ignored when "items" is not an array of schemas');
        return;
      }
      i(s, c);
    }
  };
  function i(s, a) {
    const { gen: o, schema: c, data: h, keyword: f, it: u } = s;
    u.items = !0;
    const l = o.const("len", (0, t._)`${h}.length`);
    if (c === !1)
      s.setParams({ len: a.length }), s.pass((0, t._)`${l} <= ${a.length}`);
    else if (typeof c == "object" && !(0, e.alwaysValidSchema)(u, c)) {
      const g = o.var("valid", (0, t._)`${l} <= ${a.length}`);
      o.if((0, t.not)(g), () => d(g)), s.ok(g);
    }
    function d(g) {
      o.forRange("i", a.length, l, (w) => {
        s.subschema({ keyword: f, dataProp: w, dataPropType: e.Type.Num }, g), u.allErrors || o.if((0, t.not)(g), () => o.break());
      });
    }
  }
  return hn.validateAdditionalItems = i, hn.default = n, hn;
}
var Bi = {}, ln = {}, Vl;
function Sm() {
  if (Vl) return ln;
  Vl = 1, Object.defineProperty(ln, "__esModule", { value: !0 }), ln.validateTuple = void 0;
  const t = kt(), e = Rt(), r = Qe(), n = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "array", "boolean"],
    before: "uniqueItems",
    code(s) {
      const { schema: a, it: o } = s;
      if (Array.isArray(a))
        return i(s, "additionalItems", a);
      o.items = !0, !(0, e.alwaysValidSchema)(o, a) && s.ok((0, r.validateArray)(s));
    }
  };
  function i(s, a, o = s.schema) {
    const { gen: c, parentSchema: h, data: f, keyword: u, it: l } = s;
    w(h), l.opts.unevaluated && o.length && l.items !== !0 && (l.items = e.mergeEvaluated.items(c, o.length, l.items));
    const d = c.name("valid"), g = c.const("len", (0, t._)`${f}.length`);
    o.forEach((m, v) => {
      (0, e.alwaysValidSchema)(l, m) || (c.if((0, t._)`${g} > ${v}`, () => s.subschema({
        keyword: u,
        schemaProp: v,
        dataProp: v
      }, d)), s.ok(d));
    });
    function w(m) {
      const { opts: v, errSchemaPath: p } = l, E = o.length, _ = E === m.minItems && (E === m.maxItems || m[a] === !1);
      if (v.strictTuples && !_) {
        const y = `"${u}" is ${E}-tuple, but minItems or maxItems/${a} are not specified or different at path "${p}"`;
        (0, e.checkStrictMode)(l, y, v.strictTuples);
      }
    }
  }
  return ln.validateTuple = i, ln.default = n, ln;
}
var Hl;
function Z1() {
  if (Hl) return Bi;
  Hl = 1, Object.defineProperty(Bi, "__esModule", { value: !0 });
  const t = Sm(), e = {
    keyword: "prefixItems",
    type: "array",
    schemaType: ["array"],
    before: "uniqueItems",
    code: (r) => (0, t.validateTuple)(r, "items")
  };
  return Bi.default = e, Bi;
}
var Zi = {}, Kl;
function V1() {
  if (Kl) return Zi;
  Kl = 1, Object.defineProperty(Zi, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), r = Qe(), n = bm(), s = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    error: {
      message: ({ params: { len: a } }) => (0, t.str)`must NOT have more than ${a} items`,
      params: ({ params: { len: a } }) => (0, t._)`{limit: ${a}}`
    },
    code(a) {
      const { schema: o, parentSchema: c, it: h } = a, { prefixItems: f } = c;
      h.items = !0, !(0, e.alwaysValidSchema)(h, o) && (f ? (0, n.validateAdditionalItems)(a, f) : a.ok((0, r.validateArray)(a)));
    }
  };
  return Zi.default = s, Zi;
}
var Vi = {}, Xl;
function H1() {
  if (Xl) return Vi;
  Xl = 1, Object.defineProperty(Vi, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), n = {
    keyword: "contains",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    trackErrors: !0,
    error: {
      message: ({ params: { min: i, max: s } }) => s === void 0 ? (0, t.str)`must contain at least ${i} valid item(s)` : (0, t.str)`must contain at least ${i} and no more than ${s} valid item(s)`,
      params: ({ params: { min: i, max: s } }) => s === void 0 ? (0, t._)`{minContains: ${i}}` : (0, t._)`{minContains: ${i}, maxContains: ${s}}`
    },
    code(i) {
      const { gen: s, schema: a, parentSchema: o, data: c, it: h } = i;
      let f, u;
      const { minContains: l, maxContains: d } = o;
      h.opts.next ? (f = l === void 0 ? 1 : l, u = d) : f = 1;
      const g = s.const("len", (0, t._)`${c}.length`);
      if (i.setParams({ min: f, max: u }), u === void 0 && f === 0) {
        (0, e.checkStrictMode)(h, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
        return;
      }
      if (u !== void 0 && f > u) {
        (0, e.checkStrictMode)(h, '"minContains" > "maxContains" is always invalid'), i.fail();
        return;
      }
      if ((0, e.alwaysValidSchema)(h, a)) {
        let E = (0, t._)`${g} >= ${f}`;
        u !== void 0 && (E = (0, t._)`${E} && ${g} <= ${u}`), i.pass(E);
        return;
      }
      h.items = !0;
      const w = s.name("valid");
      u === void 0 && f === 1 ? v(w, () => s.if(w, () => s.break())) : f === 0 ? (s.let(w, !0), u !== void 0 && s.if((0, t._)`${c}.length > 0`, m)) : (s.let(w, !1), m()), i.result(w, () => i.reset());
      function m() {
        const E = s.name("_valid"), _ = s.let("count", 0);
        v(E, () => s.if(E, () => p(_)));
      }
      function v(E, _) {
        s.forRange("i", 0, g, (y) => {
          i.subschema({
            keyword: "contains",
            dataProp: y,
            dataPropType: e.Type.Num,
            compositeRule: !0
          }, E), _();
        });
      }
      function p(E) {
        s.code((0, t._)`${E}++`), u === void 0 ? s.if((0, t._)`${E} >= ${f}`, () => s.assign(w, !0).break()) : (s.if((0, t._)`${E} > ${u}`, () => s.assign(w, !1).break()), f === 1 ? s.assign(w, !0) : s.if((0, t._)`${E} >= ${f}`, () => s.assign(w, !0)));
      }
    }
  };
  return Vi.default = n, Vi;
}
var Ta = {}, Wl;
function Eh() {
  return Wl || (Wl = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.validateSchemaDeps = t.validatePropertyDeps = t.error = void 0;
    const e = kt(), r = Rt(), n = Qe();
    t.error = {
      message: ({ params: { property: c, depsCount: h, deps: f } }) => {
        const u = h === 1 ? "property" : "properties";
        return (0, e.str)`must have ${u} ${f} when property ${c} is present`;
      },
      params: ({ params: { property: c, depsCount: h, deps: f, missingProperty: u } }) => (0, e._)`{property: ${c},
    missingProperty: ${u},
    depsCount: ${h},
    deps: ${f}}`
      // TODO change to reference
    };
    const i = {
      keyword: "dependencies",
      type: "object",
      schemaType: "object",
      error: t.error,
      code(c) {
        const [h, f] = s(c);
        a(c, h), o(c, f);
      }
    };
    function s({ schema: c }) {
      const h = {}, f = {};
      for (const u in c) {
        if (u === "__proto__")
          continue;
        const l = Array.isArray(c[u]) ? h : f;
        l[u] = c[u];
      }
      return [h, f];
    }
    function a(c, h = c.schema) {
      const { gen: f, data: u, it: l } = c;
      if (Object.keys(h).length === 0)
        return;
      const d = f.let("missing");
      for (const g in h) {
        const w = h[g];
        if (w.length === 0)
          continue;
        const m = (0, n.propertyInData)(f, u, g, l.opts.ownProperties);
        c.setParams({
          property: g,
          depsCount: w.length,
          deps: w.join(", ")
        }), l.allErrors ? f.if(m, () => {
          for (const v of w)
            (0, n.checkReportMissingProp)(c, v);
        }) : (f.if((0, e._)`${m} && (${(0, n.checkMissingProp)(c, w, d)})`), (0, n.reportMissingProp)(c, d), f.else());
      }
    }
    t.validatePropertyDeps = a;
    function o(c, h = c.schema) {
      const { gen: f, data: u, keyword: l, it: d } = c, g = f.name("valid");
      for (const w in h)
        (0, r.alwaysValidSchema)(d, h[w]) || (f.if(
          (0, n.propertyInData)(f, u, w, d.opts.ownProperties),
          () => {
            const m = c.subschema({ keyword: l, schemaProp: w }, g);
            c.mergeValidEvaluated(m, g);
          },
          () => f.var(g, !0)
          // TODO var
        ), c.ok(g));
    }
    t.validateSchemaDeps = o, t.default = i;
  })(Ta)), Ta;
}
var Hi = {}, Jl;
function K1() {
  if (Jl) return Hi;
  Jl = 1, Object.defineProperty(Hi, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), n = {
    keyword: "propertyNames",
    type: "object",
    schemaType: ["object", "boolean"],
    error: {
      message: "property name must be valid",
      params: ({ params: i }) => (0, t._)`{propertyName: ${i.propertyName}}`
    },
    code(i) {
      const { gen: s, schema: a, data: o, it: c } = i;
      if ((0, e.alwaysValidSchema)(c, a))
        return;
      const h = s.name("valid");
      s.forIn("key", o, (f) => {
        i.setParams({ propertyName: f }), i.subschema({
          keyword: "propertyNames",
          data: f,
          dataTypes: ["string"],
          propertyName: f,
          compositeRule: !0
        }, h), s.if((0, t.not)(h), () => {
          i.error(!0), c.allErrors || s.break();
        });
      }), i.ok(h);
    }
  };
  return Hi.default = n, Hi;
}
var Ki = {}, Yl;
function Mm() {
  if (Yl) return Ki;
  Yl = 1, Object.defineProperty(Ki, "__esModule", { value: !0 });
  const t = Qe(), e = kt(), r = Ye(), n = Rt(), s = {
    keyword: "additionalProperties",
    type: ["object"],
    schemaType: ["boolean", "object"],
    allowUndefined: !0,
    trackErrors: !0,
    error: {
      message: "must NOT have additional properties",
      params: ({ params: a }) => (0, e._)`{additionalProperty: ${a.additionalProperty}}`
    },
    code(a) {
      const { gen: o, schema: c, parentSchema: h, data: f, errsCount: u, it: l } = a;
      if (!u)
        throw new Error("ajv implementation error");
      const { allErrors: d, opts: g } = l;
      if (l.props = !0, g.removeAdditional !== "all" && (0, n.alwaysValidSchema)(l, c))
        return;
      const w = (0, t.allSchemaProperties)(h.properties), m = (0, t.allSchemaProperties)(h.patternProperties);
      v(), a.ok((0, e._)`${u} === ${r.default.errors}`);
      function v() {
        o.forIn("key", f, (b) => {
          !w.length && !m.length ? _(b) : o.if(p(b), () => _(b));
        });
      }
      function p(b) {
        let S;
        if (w.length > 8) {
          const x = (0, n.schemaRefOrVal)(l, h.properties, "properties");
          S = (0, t.isOwnProperty)(o, x, b);
        } else w.length ? S = (0, e.or)(...w.map((x) => (0, e._)`${b} === ${x}`)) : S = e.nil;
        return m.length && (S = (0, e.or)(S, ...m.map((x) => (0, e._)`${(0, t.usePattern)(a, x)}.test(${b})`))), (0, e.not)(S);
      }
      function E(b) {
        o.code((0, e._)`delete ${f}[${b}]`);
      }
      function _(b) {
        if (g.removeAdditional === "all" || g.removeAdditional && c === !1) {
          E(b);
          return;
        }
        if (c === !1) {
          a.setParams({ additionalProperty: b }), a.error(), d || o.break();
          return;
        }
        if (typeof c == "object" && !(0, n.alwaysValidSchema)(l, c)) {
          const S = o.name("valid");
          g.removeAdditional === "failing" ? (y(b, S, !1), o.if((0, e.not)(S), () => {
            a.reset(), E(b);
          })) : (y(b, S), d || o.if((0, e.not)(S), () => o.break()));
        }
      }
      function y(b, S, x) {
        const M = {
          keyword: "additionalProperties",
          dataProp: b,
          dataPropType: n.Type.Str
        };
        x === !1 && Object.assign(M, {
          compositeRule: !0,
          createErrors: !1,
          allErrors: !1
        }), a.subschema(M, S);
      }
    }
  };
  return Ki.default = s, Ki;
}
var Xi = {}, Ql;
function X1() {
  if (Ql) return Xi;
  Ql = 1, Object.defineProperty(Xi, "__esModule", { value: !0 });
  const t = ci(), e = Qe(), r = Rt(), n = Mm(), i = {
    keyword: "properties",
    type: "object",
    schemaType: "object",
    code(s) {
      const { gen: a, schema: o, parentSchema: c, data: h, it: f } = s;
      f.opts.removeAdditional === "all" && c.additionalProperties === void 0 && n.default.code(new t.KeywordCxt(f, n.default, "additionalProperties"));
      const u = (0, e.allSchemaProperties)(o);
      for (const m of u)
        f.definedProperties.add(m);
      f.opts.unevaluated && u.length && f.props !== !0 && (f.props = r.mergeEvaluated.props(a, (0, r.toHash)(u), f.props));
      const l = u.filter((m) => !(0, r.alwaysValidSchema)(f, o[m]));
      if (l.length === 0)
        return;
      const d = a.name("valid");
      for (const m of l)
        g(m) ? w(m) : (a.if((0, e.propertyInData)(a, h, m, f.opts.ownProperties)), w(m), f.allErrors || a.else().var(d, !0), a.endIf()), s.it.definedProperties.add(m), s.ok(d);
      function g(m) {
        return f.opts.useDefaults && !f.compositeRule && o[m].default !== void 0;
      }
      function w(m) {
        s.subschema({
          keyword: "properties",
          schemaProp: m,
          dataProp: m
        }, d);
      }
    }
  };
  return Xi.default = i, Xi;
}
var Wi = {}, tu;
function W1() {
  if (tu) return Wi;
  tu = 1, Object.defineProperty(Wi, "__esModule", { value: !0 });
  const t = Qe(), e = kt(), r = Rt(), n = Rt(), i = {
    keyword: "patternProperties",
    type: "object",
    schemaType: "object",
    code(s) {
      const { gen: a, schema: o, data: c, parentSchema: h, it: f } = s, { opts: u } = f, l = (0, t.allSchemaProperties)(o), d = l.filter((_) => (0, r.alwaysValidSchema)(f, o[_]));
      if (l.length === 0 || d.length === l.length && (!f.opts.unevaluated || f.props === !0))
        return;
      const g = u.strictSchema && !u.allowMatchingProperties && h.properties, w = a.name("valid");
      f.props !== !0 && !(f.props instanceof e.Name) && (f.props = (0, n.evaluatedPropsToName)(a, f.props));
      const { props: m } = f;
      v();
      function v() {
        for (const _ of l)
          g && p(_), f.allErrors ? E(_) : (a.var(w, !0), E(_), a.if(w));
      }
      function p(_) {
        for (const y in g)
          new RegExp(_).test(y) && (0, r.checkStrictMode)(f, `property ${y} matches pattern ${_} (use allowMatchingProperties)`);
      }
      function E(_) {
        a.forIn("key", c, (y) => {
          a.if((0, e._)`${(0, t.usePattern)(s, _)}.test(${y})`, () => {
            const b = d.includes(_);
            b || s.subschema({
              keyword: "patternProperties",
              schemaProp: _,
              dataProp: y,
              dataPropType: n.Type.Str
            }, w), f.opts.unevaluated && m !== !0 ? a.assign((0, e._)`${m}[${y}]`, !0) : !b && !f.allErrors && a.if((0, e.not)(w), () => a.break());
          });
        });
      }
    }
  };
  return Wi.default = i, Wi;
}
var Ji = {}, eu;
function J1() {
  if (eu) return Ji;
  eu = 1, Object.defineProperty(Ji, "__esModule", { value: !0 });
  const t = Rt(), e = {
    keyword: "not",
    schemaType: ["object", "boolean"],
    trackErrors: !0,
    code(r) {
      const { gen: n, schema: i, it: s } = r;
      if ((0, t.alwaysValidSchema)(s, i)) {
        r.fail();
        return;
      }
      const a = n.name("valid");
      r.subschema({
        keyword: "not",
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }, a), r.failResult(a, () => r.reset(), () => r.error());
    },
    error: { message: "must NOT be valid" }
  };
  return Ji.default = e, Ji;
}
var Yi = {}, ru;
function Y1() {
  if (ru) return Yi;
  ru = 1, Object.defineProperty(Yi, "__esModule", { value: !0 });
  const e = {
    keyword: "anyOf",
    schemaType: "array",
    trackErrors: !0,
    code: Qe().validateUnion,
    error: { message: "must match a schema in anyOf" }
  };
  return Yi.default = e, Yi;
}
var Qi = {}, nu;
function Q1() {
  if (nu) return Qi;
  nu = 1, Object.defineProperty(Qi, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), n = {
    keyword: "oneOf",
    schemaType: "array",
    trackErrors: !0,
    error: {
      message: "must match exactly one schema in oneOf",
      params: ({ params: i }) => (0, t._)`{passingSchemas: ${i.passing}}`
    },
    code(i) {
      const { gen: s, schema: a, parentSchema: o, it: c } = i;
      if (!Array.isArray(a))
        throw new Error("ajv implementation error");
      if (c.opts.discriminator && o.discriminator)
        return;
      const h = a, f = s.let("valid", !1), u = s.let("passing", null), l = s.name("_valid");
      i.setParams({ passing: u }), s.block(d), i.result(f, () => i.reset(), () => i.error(!0));
      function d() {
        h.forEach((g, w) => {
          let m;
          (0, e.alwaysValidSchema)(c, g) ? s.var(l, !0) : m = i.subschema({
            keyword: "oneOf",
            schemaProp: w,
            compositeRule: !0
          }, l), w > 0 && s.if((0, t._)`${l} && ${f}`).assign(f, !1).assign(u, (0, t._)`[${u}, ${w}]`).else(), s.if(l, () => {
            s.assign(f, !0), s.assign(u, w), m && i.mergeEvaluated(m, t.Name);
          });
        });
      }
    }
  };
  return Qi.default = n, Qi;
}
var ts = {}, iu;
function ty() {
  if (iu) return ts;
  iu = 1, Object.defineProperty(ts, "__esModule", { value: !0 });
  const t = Rt(), e = {
    keyword: "allOf",
    schemaType: "array",
    code(r) {
      const { gen: n, schema: i, it: s } = r;
      if (!Array.isArray(i))
        throw new Error("ajv implementation error");
      const a = n.name("valid");
      i.forEach((o, c) => {
        if ((0, t.alwaysValidSchema)(s, o))
          return;
        const h = r.subschema({ keyword: "allOf", schemaProp: c }, a);
        r.ok(a), r.mergeEvaluated(h);
      });
    }
  };
  return ts.default = e, ts;
}
var es = {}, su;
function ey() {
  if (su) return es;
  su = 1, Object.defineProperty(es, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), n = {
    keyword: "if",
    schemaType: ["object", "boolean"],
    trackErrors: !0,
    error: {
      message: ({ params: s }) => (0, t.str)`must match "${s.ifClause}" schema`,
      params: ({ params: s }) => (0, t._)`{failingKeyword: ${s.ifClause}}`
    },
    code(s) {
      const { gen: a, parentSchema: o, it: c } = s;
      o.then === void 0 && o.else === void 0 && (0, e.checkStrictMode)(c, '"if" without "then" and "else" is ignored');
      const h = i(c, "then"), f = i(c, "else");
      if (!h && !f)
        return;
      const u = a.let("valid", !0), l = a.name("_valid");
      if (d(), s.reset(), h && f) {
        const w = a.let("ifClause");
        s.setParams({ ifClause: w }), a.if(l, g("then", w), g("else", w));
      } else h ? a.if(l, g("then")) : a.if((0, t.not)(l), g("else"));
      s.pass(u, () => s.error(!0));
      function d() {
        const w = s.subschema({
          keyword: "if",
          compositeRule: !0,
          createErrors: !1,
          allErrors: !1
        }, l);
        s.mergeEvaluated(w);
      }
      function g(w, m) {
        return () => {
          const v = s.subschema({ keyword: w }, l);
          a.assign(u, l), s.mergeValidEvaluated(v, u), m ? a.assign(m, (0, t._)`${w}`) : s.setParams({ ifClause: w });
        };
      }
    }
  };
  function i(s, a) {
    const o = s.schema[a];
    return o !== void 0 && !(0, e.alwaysValidSchema)(s, o);
  }
  return es.default = n, es;
}
var rs = {}, au;
function ry() {
  if (au) return rs;
  au = 1, Object.defineProperty(rs, "__esModule", { value: !0 });
  const t = Rt(), e = {
    keyword: ["then", "else"],
    schemaType: ["object", "boolean"],
    code({ keyword: r, parentSchema: n, it: i }) {
      n.if === void 0 && (0, t.checkStrictMode)(i, `"${r}" without "if" is ignored`);
    }
  };
  return rs.default = e, rs;
}
var ou;
function xm() {
  if (ou) return Ui;
  ou = 1, Object.defineProperty(Ui, "__esModule", { value: !0 });
  const t = bm(), e = Z1(), r = Sm(), n = V1(), i = H1(), s = Eh(), a = K1(), o = Mm(), c = X1(), h = W1(), f = J1(), u = Y1(), l = Q1(), d = ty(), g = ey(), w = ry();
  function m(v = !1) {
    const p = [
      // any
      f.default,
      u.default,
      l.default,
      d.default,
      g.default,
      w.default,
      // object
      a.default,
      o.default,
      s.default,
      c.default,
      h.default
    ];
    return v ? p.push(e.default, n.default) : p.push(t.default, r.default), p.push(i.default), p;
  }
  return Ui.default = m, Ui;
}
var ns = {}, un = {}, cu;
function km() {
  if (cu) return un;
  cu = 1, Object.defineProperty(un, "__esModule", { value: !0 }), un.dynamicAnchor = void 0;
  const t = kt(), e = Ye(), r = ma(), n = _h(), i = {
    keyword: "$dynamicAnchor",
    schemaType: "string",
    code: (o) => s(o, o.schema)
  };
  function s(o, c) {
    const { gen: h, it: f } = o;
    f.schemaEnv.root.dynamicAnchors[c] = !0;
    const u = (0, t._)`${e.default.dynamicAnchors}${(0, t.getProperty)(c)}`, l = f.errSchemaPath === "#" ? f.validateName : a(o);
    h.if((0, t._)`!${u}`, () => h.assign(u, l));
  }
  un.dynamicAnchor = s;
  function a(o) {
    const { schemaEnv: c, schema: h, self: f } = o.it, { root: u, baseId: l, localRefs: d, meta: g } = c.root, { schemaId: w } = f.opts, m = new r.SchemaEnv({ schema: h, schemaId: w, root: u, baseId: l, localRefs: d, meta: g });
    return r.compileSchema.call(f, m), (0, n.getValidate)(o, m);
  }
  return un.default = i, un;
}
var fn = {}, hu;
function $m() {
  if (hu) return fn;
  hu = 1, Object.defineProperty(fn, "__esModule", { value: !0 }), fn.dynamicRef = void 0;
  const t = kt(), e = Ye(), r = _h(), n = {
    keyword: "$dynamicRef",
    schemaType: "string",
    code: (s) => i(s, s.schema)
  };
  function i(s, a) {
    const { gen: o, keyword: c, it: h } = s;
    if (a[0] !== "#")
      throw new Error(`"${c}" only supports hash fragment reference`);
    const f = a.slice(1);
    if (h.allErrors)
      u();
    else {
      const d = o.let("valid", !1);
      u(d), s.ok(d);
    }
    function u(d) {
      if (h.schemaEnv.root.dynamicAnchors[f]) {
        const g = o.let("_v", (0, t._)`${e.default.dynamicAnchors}${(0, t.getProperty)(f)}`);
        o.if(g, l(g, d), l(h.validateName, d));
      } else
        l(h.validateName, d)();
    }
    function l(d, g) {
      return g ? () => o.block(() => {
        (0, r.callRef)(s, d), o.let(g, !0);
      }) : () => (0, r.callRef)(s, d);
    }
  }
  return fn.dynamicRef = i, fn.default = n, fn;
}
var is = {}, lu;
function ny() {
  if (lu) return is;
  lu = 1, Object.defineProperty(is, "__esModule", { value: !0 });
  const t = km(), e = Rt(), r = {
    keyword: "$recursiveAnchor",
    schemaType: "boolean",
    code(n) {
      n.schema ? (0, t.dynamicAnchor)(n, "") : (0, e.checkStrictMode)(n.it, "$recursiveAnchor: false is ignored");
    }
  };
  return is.default = r, is;
}
var ss = {}, uu;
function iy() {
  if (uu) return ss;
  uu = 1, Object.defineProperty(ss, "__esModule", { value: !0 });
  const t = $m(), e = {
    keyword: "$recursiveRef",
    schemaType: "string",
    code: (r) => (0, t.dynamicRef)(r, r.schema)
  };
  return ss.default = e, ss;
}
var fu;
function sy() {
  if (fu) return ns;
  fu = 1, Object.defineProperty(ns, "__esModule", { value: !0 });
  const t = km(), e = $m(), r = ny(), n = iy(), i = [t.default, e.default, r.default, n.default];
  return ns.default = i, ns;
}
var as = {}, os = {}, du;
function ay() {
  if (du) return os;
  du = 1, Object.defineProperty(os, "__esModule", { value: !0 });
  const t = Eh(), e = {
    keyword: "dependentRequired",
    type: "object",
    schemaType: "object",
    error: t.error,
    code: (r) => (0, t.validatePropertyDeps)(r)
  };
  return os.default = e, os;
}
var cs = {}, mu;
function oy() {
  if (mu) return cs;
  mu = 1, Object.defineProperty(cs, "__esModule", { value: !0 });
  const t = Eh(), e = {
    keyword: "dependentSchemas",
    type: "object",
    schemaType: "object",
    code: (r) => (0, t.validateSchemaDeps)(r)
  };
  return cs.default = e, cs;
}
var hs = {}, pu;
function cy() {
  if (pu) return hs;
  pu = 1, Object.defineProperty(hs, "__esModule", { value: !0 });
  const t = Rt(), e = {
    keyword: ["maxContains", "minContains"],
    type: "array",
    schemaType: "number",
    code({ keyword: r, parentSchema: n, it: i }) {
      n.contains === void 0 && (0, t.checkStrictMode)(i, `"${r}" without "contains" is ignored`);
    }
  };
  return hs.default = e, hs;
}
var yu;
function hy() {
  if (yu) return as;
  yu = 1, Object.defineProperty(as, "__esModule", { value: !0 });
  const t = ay(), e = oy(), r = cy(), n = [t.default, e.default, r.default];
  return as.default = n, as;
}
var ls = {}, us = {}, gu;
function ly() {
  if (gu) return us;
  gu = 1, Object.defineProperty(us, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), r = Ye(), i = {
    keyword: "unevaluatedProperties",
    type: "object",
    schemaType: ["boolean", "object"],
    trackErrors: !0,
    error: {
      message: "must NOT have unevaluated properties",
      params: ({ params: s }) => (0, t._)`{unevaluatedProperty: ${s.unevaluatedProperty}}`
    },
    code(s) {
      const { gen: a, schema: o, data: c, errsCount: h, it: f } = s;
      if (!h)
        throw new Error("ajv implementation error");
      const { allErrors: u, props: l } = f;
      l instanceof t.Name ? a.if((0, t._)`${l} !== true`, () => a.forIn("key", c, (m) => a.if(g(l, m), () => d(m)))) : l !== !0 && a.forIn("key", c, (m) => l === void 0 ? d(m) : a.if(w(l, m), () => d(m))), f.props = !0, s.ok((0, t._)`${h} === ${r.default.errors}`);
      function d(m) {
        if (o === !1) {
          s.setParams({ unevaluatedProperty: m }), s.error(), u || a.break();
          return;
        }
        if (!(0, e.alwaysValidSchema)(f, o)) {
          const v = a.name("valid");
          s.subschema({
            keyword: "unevaluatedProperties",
            dataProp: m,
            dataPropType: e.Type.Str
          }, v), u || a.if((0, t.not)(v), () => a.break());
        }
      }
      function g(m, v) {
        return (0, t._)`!${m} || !${m}[${v}]`;
      }
      function w(m, v) {
        const p = [];
        for (const E in m)
          m[E] === !0 && p.push((0, t._)`${v} !== ${E}`);
        return (0, t.and)(...p);
      }
    }
  };
  return us.default = i, us;
}
var fs = {}, wu;
function uy() {
  if (wu) return fs;
  wu = 1, Object.defineProperty(fs, "__esModule", { value: !0 });
  const t = kt(), e = Rt(), n = {
    keyword: "unevaluatedItems",
    type: "array",
    schemaType: ["boolean", "object"],
    error: {
      message: ({ params: { len: i } }) => (0, t.str)`must NOT have more than ${i} items`,
      params: ({ params: { len: i } }) => (0, t._)`{limit: ${i}}`
    },
    code(i) {
      const { gen: s, schema: a, data: o, it: c } = i, h = c.items || 0;
      if (h === !0)
        return;
      const f = s.const("len", (0, t._)`${o}.length`);
      if (a === !1)
        i.setParams({ len: h }), i.fail((0, t._)`${f} > ${h}`);
      else if (typeof a == "object" && !(0, e.alwaysValidSchema)(c, a)) {
        const l = s.var("valid", (0, t._)`${f} <= ${h}`);
        s.if((0, t.not)(l), () => u(l, h)), i.ok(l);
      }
      c.items = !0;
      function u(l, d) {
        s.forRange("i", d, f, (g) => {
          i.subschema({ keyword: "unevaluatedItems", dataProp: g, dataPropType: e.Type.Num }, l), c.allErrors || s.if((0, t.not)(l), () => s.break());
        });
      }
    }
  };
  return fs.default = n, fs;
}
var _u;
function fy() {
  if (_u) return ls;
  _u = 1, Object.defineProperty(ls, "__esModule", { value: !0 });
  const t = ly(), e = uy(), r = [t.default, e.default];
  return ls.default = r, ls;
}
var ds = {}, ms = {}, vu;
function dy() {
  if (vu) return ms;
  vu = 1, Object.defineProperty(ms, "__esModule", { value: !0 });
  const t = kt(), r = {
    keyword: "format",
    type: ["number", "string"],
    schemaType: "string",
    $data: !0,
    error: {
      message: ({ schemaCode: n }) => (0, t.str)`must match format "${n}"`,
      params: ({ schemaCode: n }) => (0, t._)`{format: ${n}}`
    },
    code(n, i) {
      const { gen: s, data: a, $data: o, schema: c, schemaCode: h, it: f } = n, { opts: u, errSchemaPath: l, schemaEnv: d, self: g } = f;
      if (!u.validateFormats)
        return;
      o ? w() : m();
      function w() {
        const v = s.scopeValue("formats", {
          ref: g.formats,
          code: u.code.formats
        }), p = s.const("fDef", (0, t._)`${v}[${h}]`), E = s.let("fType"), _ = s.let("format");
        s.if((0, t._)`typeof ${p} == "object" && !(${p} instanceof RegExp)`, () => s.assign(E, (0, t._)`${p}.type || "string"`).assign(_, (0, t._)`${p}.validate`), () => s.assign(E, (0, t._)`"string"`).assign(_, p)), n.fail$data((0, t.or)(y(), b()));
        function y() {
          return u.strictSchema === !1 ? t.nil : (0, t._)`${h} && !${_}`;
        }
        function b() {
          const S = d.$async ? (0, t._)`(${p}.async ? await ${_}(${a}) : ${_}(${a}))` : (0, t._)`${_}(${a})`, x = (0, t._)`(typeof ${_} == "function" ? ${S} : ${_}.test(${a}))`;
          return (0, t._)`${_} && ${_} !== true && ${E} === ${i} && !${x}`;
        }
      }
      function m() {
        const v = g.formats[c];
        if (!v) {
          y();
          return;
        }
        if (v === !0)
          return;
        const [p, E, _] = b(v);
        p === i && n.pass(S());
        function y() {
          if (u.strictSchema === !1) {
            g.logger.warn(x());
            return;
          }
          throw new Error(x());
          function x() {
            return `unknown format "${c}" ignored in schema at path "${l}"`;
          }
        }
        function b(x) {
          const M = x instanceof RegExp ? (0, t.regexpCode)(x) : u.code.formats ? (0, t._)`${u.code.formats}${(0, t.getProperty)(c)}` : void 0, k = s.scopeValue("formats", { key: c, ref: x, code: M });
          return typeof x == "object" && !(x instanceof RegExp) ? [x.type || "string", x.validate, (0, t._)`${k}.validate`] : ["string", x, k];
        }
        function S() {
          if (typeof v == "object" && !(v instanceof RegExp) && v.async) {
            if (!d.$async)
              throw new Error("async format in sync schema");
            return (0, t._)`await ${_}(${a})`;
          }
          return typeof E == "function" ? (0, t._)`${_}(${a})` : (0, t._)`${_}.test(${a})`;
        }
      }
    }
  };
  return ms.default = r, ms;
}
var Eu;
function Im() {
  if (Eu) return ds;
  Eu = 1, Object.defineProperty(ds, "__esModule", { value: !0 });
  const e = [dy().default];
  return ds.default = e, ds;
}
var Hr = {}, bu;
function Pm() {
  return bu || (bu = 1, Object.defineProperty(Hr, "__esModule", { value: !0 }), Hr.contentVocabulary = Hr.metadataVocabulary = void 0, Hr.metadataVocabulary = [
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples"
  ], Hr.contentVocabulary = [
    "contentMediaType",
    "contentEncoding",
    "contentSchema"
  ]), Hr;
}
var Su;
function my() {
  if (Su) return $i;
  Su = 1, Object.defineProperty($i, "__esModule", { value: !0 });
  const t = vm(), e = Em(), r = xm(), n = sy(), i = hy(), s = fy(), a = Im(), o = Pm(), c = [
    n.default,
    t.default,
    e.default,
    (0, r.default)(!0),
    a.default,
    o.metadataVocabulary,
    o.contentVocabulary,
    i.default,
    s.default
  ];
  return $i.default = c, $i;
}
var ps = {}, Fn = {}, Mu;
function py() {
  if (Mu) return Fn;
  Mu = 1, Object.defineProperty(Fn, "__esModule", { value: !0 }), Fn.DiscrError = void 0;
  var t;
  return (function(e) {
    e.Tag = "tag", e.Mapping = "mapping";
  })(t || (Fn.DiscrError = t = {})), Fn;
}
var xu;
function Am() {
  if (xu) return ps;
  xu = 1, Object.defineProperty(ps, "__esModule", { value: !0 });
  const t = kt(), e = py(), r = ma(), n = hi(), i = Rt(), a = {
    keyword: "discriminator",
    type: "object",
    schemaType: "object",
    error: {
      message: ({ params: { discrError: o, tagName: c } }) => o === e.DiscrError.Tag ? `tag "${c}" must be string` : `value of tag "${c}" must be in oneOf`,
      params: ({ params: { discrError: o, tag: c, tagName: h } }) => (0, t._)`{error: ${o}, tag: ${h}, tagValue: ${c}}`
    },
    code(o) {
      const { gen: c, data: h, schema: f, parentSchema: u, it: l } = o, { oneOf: d } = u;
      if (!l.opts.discriminator)
        throw new Error("discriminator: requires discriminator option");
      const g = f.propertyName;
      if (typeof g != "string")
        throw new Error("discriminator: requires propertyName");
      if (f.mapping)
        throw new Error("discriminator: mapping is not supported");
      if (!d)
        throw new Error("discriminator: requires oneOf keyword");
      const w = c.let("valid", !1), m = c.const("tag", (0, t._)`${h}${(0, t.getProperty)(g)}`);
      c.if((0, t._)`typeof ${m} == "string"`, () => v(), () => o.error(!1, { discrError: e.DiscrError.Tag, tag: m, tagName: g })), o.ok(w);
      function v() {
        const _ = E();
        c.if(!1);
        for (const y in _)
          c.elseIf((0, t._)`${m} === ${y}`), c.assign(w, p(_[y]));
        c.else(), o.error(!1, { discrError: e.DiscrError.Mapping, tag: m, tagName: g }), c.endIf();
      }
      function p(_) {
        const y = c.name("valid"), b = o.subschema({ keyword: "oneOf", schemaProp: _ }, y);
        return o.mergeEvaluated(b, t.Name), y;
      }
      function E() {
        var _;
        const y = {}, b = x(u);
        let S = !0;
        for (let $ = 0; $ < d.length; $++) {
          let O = d[$];
          if (O?.$ref && !(0, i.schemaHasRulesButRef)(O, l.self.RULES)) {
            const I = O.$ref;
            if (O = r.resolveRef.call(l.self, l.schemaEnv.root, l.baseId, I), O instanceof r.SchemaEnv && (O = O.schema), O === void 0)
              throw new n.default(l.opts.uriResolver, l.baseId, I);
          }
          const T = (_ = O?.properties) === null || _ === void 0 ? void 0 : _[g];
          if (typeof T != "object")
            throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${g}"`);
          S = S && (b || x(O)), M(T, $);
        }
        if (!S)
          throw new Error(`discriminator: "${g}" must be required`);
        return y;
        function x({ required: $ }) {
          return Array.isArray($) && $.includes(g);
        }
        function M($, O) {
          if ($.const)
            k($.const, O);
          else if ($.enum)
            for (const T of $.enum)
              k(T, O);
          else
            throw new Error(`discriminator: "properties/${g}" must have "const" or "enum"`);
        }
        function k($, O) {
          if (typeof $ != "string" || $ in y)
            throw new Error(`discriminator: "${g}" values must be unique strings`);
          y[$] = O;
        }
      }
    }
  };
  return ps.default = a, ps;
}
var ys = {};
const yy = "https://json-schema.org/draft/2020-12/schema", gy = "https://json-schema.org/draft/2020-12/schema", wy = { "https://json-schema.org/draft/2020-12/vocab/core": !0, "https://json-schema.org/draft/2020-12/vocab/applicator": !0, "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0, "https://json-schema.org/draft/2020-12/vocab/validation": !0, "https://json-schema.org/draft/2020-12/vocab/meta-data": !0, "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0, "https://json-schema.org/draft/2020-12/vocab/content": !0 }, _y = "meta", vy = "Core and Validation specifications meta-schema", Ey = [{ $ref: "meta/core" }, { $ref: "meta/applicator" }, { $ref: "meta/unevaluated" }, { $ref: "meta/validation" }, { $ref: "meta/meta-data" }, { $ref: "meta/format-annotation" }, { $ref: "meta/content" }], by = ["object", "boolean"], Sy = "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.", My = { definitions: { $comment: '"definitions" has been replaced by "$defs".', type: "object", additionalProperties: { $dynamicRef: "#meta" }, deprecated: !0, default: {} }, dependencies: { $comment: '"dependencies" has been split and replaced by "dependentSchemas" and "dependentRequired" in order to serve their differing semantics.', type: "object", additionalProperties: { anyOf: [{ $dynamicRef: "#meta" }, { $ref: "meta/validation#/$defs/stringArray" }] }, deprecated: !0, default: {} }, $recursiveAnchor: { $comment: '"$recursiveAnchor" has been replaced by "$dynamicAnchor".', $ref: "meta/core#/$defs/anchorString", deprecated: !0 }, $recursiveRef: { $comment: '"$recursiveRef" has been replaced by "$dynamicRef".', $ref: "meta/core#/$defs/uriReferenceString", deprecated: !0 } }, xy = {
  $schema: yy,
  $id: gy,
  $vocabulary: wy,
  $dynamicAnchor: _y,
  title: vy,
  allOf: Ey,
  type: by,
  $comment: Sy,
  properties: My
}, ky = "https://json-schema.org/draft/2020-12/schema", $y = "https://json-schema.org/draft/2020-12/meta/applicator", Iy = { "https://json-schema.org/draft/2020-12/vocab/applicator": !0 }, Py = "meta", Ay = "Applicator vocabulary meta-schema", Ny = ["object", "boolean"], Oy = { prefixItems: { $ref: "#/$defs/schemaArray" }, items: { $dynamicRef: "#meta" }, contains: { $dynamicRef: "#meta" }, additionalProperties: { $dynamicRef: "#meta" }, properties: { type: "object", additionalProperties: { $dynamicRef: "#meta" }, default: {} }, patternProperties: { type: "object", additionalProperties: { $dynamicRef: "#meta" }, propertyNames: { format: "regex" }, default: {} }, dependentSchemas: { type: "object", additionalProperties: { $dynamicRef: "#meta" }, default: {} }, propertyNames: { $dynamicRef: "#meta" }, if: { $dynamicRef: "#meta" }, then: { $dynamicRef: "#meta" }, else: { $dynamicRef: "#meta" }, allOf: { $ref: "#/$defs/schemaArray" }, anyOf: { $ref: "#/$defs/schemaArray" }, oneOf: { $ref: "#/$defs/schemaArray" }, not: { $dynamicRef: "#meta" } }, Ry = { schemaArray: { type: "array", minItems: 1, items: { $dynamicRef: "#meta" } } }, Dy = {
  $schema: ky,
  $id: $y,
  $vocabulary: Iy,
  $dynamicAnchor: Py,
  title: Ay,
  type: Ny,
  properties: Oy,
  $defs: Ry
}, jy = "https://json-schema.org/draft/2020-12/schema", Ty = "https://json-schema.org/draft/2020-12/meta/unevaluated", Cy = { "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0 }, Ly = "meta", Fy = "Unevaluated applicator vocabulary meta-schema", Gy = ["object", "boolean"], zy = { unevaluatedItems: { $dynamicRef: "#meta" }, unevaluatedProperties: { $dynamicRef: "#meta" } }, qy = {
  $schema: jy,
  $id: Ty,
  $vocabulary: Cy,
  $dynamicAnchor: Ly,
  title: Fy,
  type: Gy,
  properties: zy
}, Uy = "https://json-schema.org/draft/2020-12/schema", By = "https://json-schema.org/draft/2020-12/meta/content", Zy = { "https://json-schema.org/draft/2020-12/vocab/content": !0 }, Vy = "meta", Hy = "Content vocabulary meta-schema", Ky = ["object", "boolean"], Xy = { contentEncoding: { type: "string" }, contentMediaType: { type: "string" }, contentSchema: { $dynamicRef: "#meta" } }, Wy = {
  $schema: Uy,
  $id: By,
  $vocabulary: Zy,
  $dynamicAnchor: Vy,
  title: Hy,
  type: Ky,
  properties: Xy
}, Jy = "https://json-schema.org/draft/2020-12/schema", Yy = "https://json-schema.org/draft/2020-12/meta/core", Qy = { "https://json-schema.org/draft/2020-12/vocab/core": !0 }, tg = "meta", eg = "Core vocabulary meta-schema", rg = ["object", "boolean"], ng = { $id: { $ref: "#/$defs/uriReferenceString", $comment: "Non-empty fragments not allowed.", pattern: "^[^#]*#?$" }, $schema: { $ref: "#/$defs/uriString" }, $ref: { $ref: "#/$defs/uriReferenceString" }, $anchor: { $ref: "#/$defs/anchorString" }, $dynamicRef: { $ref: "#/$defs/uriReferenceString" }, $dynamicAnchor: { $ref: "#/$defs/anchorString" }, $vocabulary: { type: "object", propertyNames: { $ref: "#/$defs/uriString" }, additionalProperties: { type: "boolean" } }, $comment: { type: "string" }, $defs: { type: "object", additionalProperties: { $dynamicRef: "#meta" } } }, ig = { anchorString: { type: "string", pattern: "^[A-Za-z_][-A-Za-z0-9._]*$" }, uriString: { type: "string", format: "uri" }, uriReferenceString: { type: "string", format: "uri-reference" } }, sg = {
  $schema: Jy,
  $id: Yy,
  $vocabulary: Qy,
  $dynamicAnchor: tg,
  title: eg,
  type: rg,
  properties: ng,
  $defs: ig
}, ag = "https://json-schema.org/draft/2020-12/schema", og = "https://json-schema.org/draft/2020-12/meta/format-annotation", cg = { "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0 }, hg = "meta", lg = "Format vocabulary meta-schema for annotation results", ug = ["object", "boolean"], fg = { format: { type: "string" } }, dg = {
  $schema: ag,
  $id: og,
  $vocabulary: cg,
  $dynamicAnchor: hg,
  title: lg,
  type: ug,
  properties: fg
}, mg = "https://json-schema.org/draft/2020-12/schema", pg = "https://json-schema.org/draft/2020-12/meta/meta-data", yg = { "https://json-schema.org/draft/2020-12/vocab/meta-data": !0 }, gg = "meta", wg = "Meta-data vocabulary meta-schema", _g = ["object", "boolean"], vg = { title: { type: "string" }, description: { type: "string" }, default: !0, deprecated: { type: "boolean", default: !1 }, readOnly: { type: "boolean", default: !1 }, writeOnly: { type: "boolean", default: !1 }, examples: { type: "array", items: !0 } }, Eg = {
  $schema: mg,
  $id: pg,
  $vocabulary: yg,
  $dynamicAnchor: gg,
  title: wg,
  type: _g,
  properties: vg
}, bg = "https://json-schema.org/draft/2020-12/schema", Sg = "https://json-schema.org/draft/2020-12/meta/validation", Mg = { "https://json-schema.org/draft/2020-12/vocab/validation": !0 }, xg = "meta", kg = "Validation vocabulary meta-schema", $g = ["object", "boolean"], Ig = { type: { anyOf: [{ $ref: "#/$defs/simpleTypes" }, { type: "array", items: { $ref: "#/$defs/simpleTypes" }, minItems: 1, uniqueItems: !0 }] }, const: !0, enum: { type: "array", items: !0 }, multipleOf: { type: "number", exclusiveMinimum: 0 }, maximum: { type: "number" }, exclusiveMaximum: { type: "number" }, minimum: { type: "number" }, exclusiveMinimum: { type: "number" }, maxLength: { $ref: "#/$defs/nonNegativeInteger" }, minLength: { $ref: "#/$defs/nonNegativeIntegerDefault0" }, pattern: { type: "string", format: "regex" }, maxItems: { $ref: "#/$defs/nonNegativeInteger" }, minItems: { $ref: "#/$defs/nonNegativeIntegerDefault0" }, uniqueItems: { type: "boolean", default: !1 }, maxContains: { $ref: "#/$defs/nonNegativeInteger" }, minContains: { $ref: "#/$defs/nonNegativeInteger", default: 1 }, maxProperties: { $ref: "#/$defs/nonNegativeInteger" }, minProperties: { $ref: "#/$defs/nonNegativeIntegerDefault0" }, required: { $ref: "#/$defs/stringArray" }, dependentRequired: { type: "object", additionalProperties: { $ref: "#/$defs/stringArray" } } }, Pg = { nonNegativeInteger: { type: "integer", minimum: 0 }, nonNegativeIntegerDefault0: { $ref: "#/$defs/nonNegativeInteger", default: 0 }, simpleTypes: { enum: ["array", "boolean", "integer", "null", "number", "object", "string"] }, stringArray: { type: "array", items: { type: "string" }, uniqueItems: !0, default: [] } }, Ag = {
  $schema: bg,
  $id: Sg,
  $vocabulary: Mg,
  $dynamicAnchor: xg,
  title: kg,
  type: $g,
  properties: Ig,
  $defs: Pg
};
var ku;
function Ng() {
  if (ku) return ys;
  ku = 1, Object.defineProperty(ys, "__esModule", { value: !0 });
  const t = xy, e = Dy, r = qy, n = Wy, i = sg, s = dg, a = Eg, o = Ag, c = ["/properties"];
  function h(f) {
    return [
      t,
      e,
      r,
      n,
      i,
      u(this, s),
      a,
      u(this, o)
    ].forEach((l) => this.addMetaSchema(l, void 0, !1)), this;
    function u(l, d) {
      return f ? l.$dataMetaSchema(d, c) : d;
    }
  }
  return ys.default = h, ys;
}
var $u;
function Og() {
  return $u || ($u = 1, (function(t, e) {
    Object.defineProperty(e, "__esModule", { value: !0 }), e.MissingRefError = e.ValidationError = e.CodeGen = e.Name = e.nil = e.stringify = e.str = e._ = e.KeywordCxt = e.Ajv2020 = void 0;
    const r = _m(), n = my(), i = Am(), s = Ng(), a = "https://json-schema.org/draft/2020-12/schema";
    class o extends r.default {
      constructor(d = {}) {
        super({
          ...d,
          dynamicRef: !0,
          next: !0,
          unevaluated: !0
        });
      }
      _addVocabularies() {
        super._addVocabularies(), n.default.forEach((d) => this.addVocabulary(d)), this.opts.discriminator && this.addKeyword(i.default);
      }
      _addDefaultMetaSchema() {
        super._addDefaultMetaSchema();
        const { $data: d, meta: g } = this.opts;
        g && (s.default.call(this, d), this.refs["http://json-schema.org/schema"] = a);
      }
      defaultMeta() {
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(a) ? a : void 0);
      }
    }
    e.Ajv2020 = o, t.exports = e = o, t.exports.Ajv2020 = o, Object.defineProperty(e, "__esModule", { value: !0 }), e.default = o;
    var c = ci();
    Object.defineProperty(e, "KeywordCxt", { enumerable: !0, get: function() {
      return c.KeywordCxt;
    } });
    var h = kt();
    Object.defineProperty(e, "_", { enumerable: !0, get: function() {
      return h._;
    } }), Object.defineProperty(e, "str", { enumerable: !0, get: function() {
      return h.str;
    } }), Object.defineProperty(e, "stringify", { enumerable: !0, get: function() {
      return h.stringify;
    } }), Object.defineProperty(e, "nil", { enumerable: !0, get: function() {
      return h.nil;
    } }), Object.defineProperty(e, "Name", { enumerable: !0, get: function() {
      return h.Name;
    } }), Object.defineProperty(e, "CodeGen", { enumerable: !0, get: function() {
      return h.CodeGen;
    } });
    var f = da();
    Object.defineProperty(e, "ValidationError", { enumerable: !0, get: function() {
      return f.default;
    } });
    var u = hi();
    Object.defineProperty(e, "MissingRefError", { enumerable: !0, get: function() {
      return u.default;
    } });
  })(bi, bi.exports)), bi.exports;
}
var Rg = Og(), gs = { exports: {} }, Ca = {}, Iu;
function Dg() {
  return Iu || (Iu = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.formatNames = t.fastFormats = t.fullFormats = void 0;
    function e($, O) {
      return { validate: $, compare: O };
    }
    t.fullFormats = {
      // date: http://tools.ietf.org/html/rfc3339#section-5.6
      date: e(s, a),
      // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
      time: e(c(!0), h),
      "date-time": e(l(!0), d),
      "iso-time": e(c(), f),
      "iso-date-time": e(l(), g),
      // duration: https://tools.ietf.org/html/rfc3339#appendix-A
      duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
      uri: v,
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
      regex: k,
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
      byte: E,
      // signed 32 bit integer
      int32: { type: "number", validate: b },
      // signed 64 bit integer
      int64: { type: "number", validate: S },
      // C-type float
      float: { type: "number", validate: x },
      // C-type double
      double: { type: "number", validate: x },
      // hint to the UI to hide input strings
      password: !0,
      // unchecked string payload
      binary: !0
    }, t.fastFormats = {
      ...t.fullFormats,
      date: e(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, a),
      time: e(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, h),
      "date-time": e(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, d),
      "iso-time": e(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, f),
      "iso-date-time": e(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, g),
      // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
      uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
      "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
      // email (sources from jsen validator):
      // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
      // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
      email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
    }, t.formatNames = Object.keys(t.fullFormats);
    function r($) {
      return $ % 4 === 0 && ($ % 100 !== 0 || $ % 400 === 0);
    }
    const n = /^(\d\d\d\d)-(\d\d)-(\d\d)$/, i = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    function s($) {
      const O = n.exec($);
      if (!O)
        return !1;
      const T = +O[1], I = +O[2], N = +O[3];
      return I >= 1 && I <= 12 && N >= 1 && N <= (I === 2 && r(T) ? 29 : i[I]);
    }
    function a($, O) {
      if ($ && O)
        return $ > O ? 1 : $ < O ? -1 : 0;
    }
    const o = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
    function c($) {
      return function(T) {
        const I = o.exec(T);
        if (!I)
          return !1;
        const N = +I[1], j = +I[2], C = +I[3], F = I[4], q = I[5] === "-" ? -1 : 1, R = +(I[6] || 0), D = +(I[7] || 0);
        if (R > 23 || D > 59 || $ && !F)
          return !1;
        if (N <= 23 && j <= 59 && C < 60)
          return !0;
        const G = j - D * q, L = N - R * q - (G < 0 ? 1 : 0);
        return (L === 23 || L === -1) && (G === 59 || G === -1) && C < 61;
      };
    }
    function h($, O) {
      if (!($ && O))
        return;
      const T = (/* @__PURE__ */ new Date("2020-01-01T" + $)).valueOf(), I = (/* @__PURE__ */ new Date("2020-01-01T" + O)).valueOf();
      if (T && I)
        return T - I;
    }
    function f($, O) {
      if (!($ && O))
        return;
      const T = o.exec($), I = o.exec(O);
      if (T && I)
        return $ = T[1] + T[2] + T[3], O = I[1] + I[2] + I[3], $ > O ? 1 : $ < O ? -1 : 0;
    }
    const u = /t|\s/i;
    function l($) {
      const O = c($);
      return function(I) {
        const N = I.split(u);
        return N.length === 2 && s(N[0]) && O(N[1]);
      };
    }
    function d($, O) {
      if (!($ && O))
        return;
      const T = new Date($).valueOf(), I = new Date(O).valueOf();
      if (T && I)
        return T - I;
    }
    function g($, O) {
      if (!($ && O))
        return;
      const [T, I] = $.split(u), [N, j] = O.split(u), C = a(T, N);
      if (C !== void 0)
        return C || h(I, j);
    }
    const w = /\/|:/, m = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
    function v($) {
      return w.test($) && m.test($);
    }
    const p = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
    function E($) {
      return p.lastIndex = 0, p.test($);
    }
    const _ = -2147483648, y = 2 ** 31 - 1;
    function b($) {
      return Number.isInteger($) && $ <= y && $ >= _;
    }
    function S($) {
      return Number.isInteger($);
    }
    function x() {
      return !0;
    }
    const M = /[^\\]\\Z/;
    function k($) {
      if (M.test($))
        return !1;
      try {
        return new RegExp($), !0;
      } catch {
        return !1;
      }
    }
  })(Ca)), Ca;
}
var La = {}, ws = { exports: {} }, _s = {}, Pu;
function jg() {
  if (Pu) return _s;
  Pu = 1, Object.defineProperty(_s, "__esModule", { value: !0 });
  const t = vm(), e = Em(), r = xm(), n = Im(), i = Pm(), s = [
    t.default,
    e.default,
    (0, r.default)(),
    n.default,
    i.metadataVocabulary,
    i.contentVocabulary
  ];
  return _s.default = s, _s;
}
const Tg = "http://json-schema.org/draft-07/schema#", Cg = "http://json-schema.org/draft-07/schema#", Lg = "Core schema meta-schema", Fg = { schemaArray: { type: "array", minItems: 1, items: { $ref: "#" } }, nonNegativeInteger: { type: "integer", minimum: 0 }, nonNegativeIntegerDefault0: { allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }] }, simpleTypes: { enum: ["array", "boolean", "integer", "null", "number", "object", "string"] }, stringArray: { type: "array", items: { type: "string" }, uniqueItems: !0, default: [] } }, Gg = ["object", "boolean"], zg = { $id: { type: "string", format: "uri-reference" }, $schema: { type: "string", format: "uri" }, $ref: { type: "string", format: "uri-reference" }, $comment: { type: "string" }, title: { type: "string" }, description: { type: "string" }, default: !0, readOnly: { type: "boolean", default: !1 }, examples: { type: "array", items: !0 }, multipleOf: { type: "number", exclusiveMinimum: 0 }, maximum: { type: "number" }, exclusiveMaximum: { type: "number" }, minimum: { type: "number" }, exclusiveMinimum: { type: "number" }, maxLength: { $ref: "#/definitions/nonNegativeInteger" }, minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" }, pattern: { type: "string", format: "regex" }, additionalItems: { $ref: "#" }, items: { anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }], default: !0 }, maxItems: { $ref: "#/definitions/nonNegativeInteger" }, minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" }, uniqueItems: { type: "boolean", default: !1 }, contains: { $ref: "#" }, maxProperties: { $ref: "#/definitions/nonNegativeInteger" }, minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" }, required: { $ref: "#/definitions/stringArray" }, additionalProperties: { $ref: "#" }, definitions: { type: "object", additionalProperties: { $ref: "#" }, default: {} }, properties: { type: "object", additionalProperties: { $ref: "#" }, default: {} }, patternProperties: { type: "object", additionalProperties: { $ref: "#" }, propertyNames: { format: "regex" }, default: {} }, dependencies: { type: "object", additionalProperties: { anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }] } }, propertyNames: { $ref: "#" }, const: !0, enum: { type: "array", items: !0, minItems: 1, uniqueItems: !0 }, type: { anyOf: [{ $ref: "#/definitions/simpleTypes" }, { type: "array", items: { $ref: "#/definitions/simpleTypes" }, minItems: 1, uniqueItems: !0 }] }, format: { type: "string" }, contentMediaType: { type: "string" }, contentEncoding: { type: "string" }, if: { $ref: "#" }, then: { $ref: "#" }, else: { $ref: "#" }, allOf: { $ref: "#/definitions/schemaArray" }, anyOf: { $ref: "#/definitions/schemaArray" }, oneOf: { $ref: "#/definitions/schemaArray" }, not: { $ref: "#" } }, qg = {
  $schema: Tg,
  $id: Cg,
  title: Lg,
  definitions: Fg,
  type: Gg,
  properties: zg,
  default: !0
};
var Au;
function Ug() {
  return Au || (Au = 1, (function(t, e) {
    Object.defineProperty(e, "__esModule", { value: !0 }), e.MissingRefError = e.ValidationError = e.CodeGen = e.Name = e.nil = e.stringify = e.str = e._ = e.KeywordCxt = e.Ajv = void 0;
    const r = _m(), n = jg(), i = Am(), s = qg, a = ["/properties"], o = "http://json-schema.org/draft-07/schema";
    class c extends r.default {
      _addVocabularies() {
        super._addVocabularies(), n.default.forEach((g) => this.addVocabulary(g)), this.opts.discriminator && this.addKeyword(i.default);
      }
      _addDefaultMetaSchema() {
        if (super._addDefaultMetaSchema(), !this.opts.meta)
          return;
        const g = this.opts.$data ? this.$dataMetaSchema(s, a) : s;
        this.addMetaSchema(g, o, !1), this.refs["http://json-schema.org/schema"] = o;
      }
      defaultMeta() {
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(o) ? o : void 0);
      }
    }
    e.Ajv = c, t.exports = e = c, t.exports.Ajv = c, Object.defineProperty(e, "__esModule", { value: !0 }), e.default = c;
    var h = ci();
    Object.defineProperty(e, "KeywordCxt", { enumerable: !0, get: function() {
      return h.KeywordCxt;
    } });
    var f = kt();
    Object.defineProperty(e, "_", { enumerable: !0, get: function() {
      return f._;
    } }), Object.defineProperty(e, "str", { enumerable: !0, get: function() {
      return f.str;
    } }), Object.defineProperty(e, "stringify", { enumerable: !0, get: function() {
      return f.stringify;
    } }), Object.defineProperty(e, "nil", { enumerable: !0, get: function() {
      return f.nil;
    } }), Object.defineProperty(e, "Name", { enumerable: !0, get: function() {
      return f.Name;
    } }), Object.defineProperty(e, "CodeGen", { enumerable: !0, get: function() {
      return f.CodeGen;
    } });
    var u = da();
    Object.defineProperty(e, "ValidationError", { enumerable: !0, get: function() {
      return u.default;
    } });
    var l = hi();
    Object.defineProperty(e, "MissingRefError", { enumerable: !0, get: function() {
      return l.default;
    } });
  })(ws, ws.exports)), ws.exports;
}
var Nu;
function Bg() {
  return Nu || (Nu = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.formatLimitDefinition = void 0;
    const e = Ug(), r = kt(), n = r.operators, i = {
      formatMaximum: { okStr: "<=", ok: n.LTE, fail: n.GT },
      formatMinimum: { okStr: ">=", ok: n.GTE, fail: n.LT },
      formatExclusiveMaximum: { okStr: "<", ok: n.LT, fail: n.GTE },
      formatExclusiveMinimum: { okStr: ">", ok: n.GT, fail: n.LTE }
    }, s = {
      message: ({ keyword: o, schemaCode: c }) => (0, r.str)`should be ${i[o].okStr} ${c}`,
      params: ({ keyword: o, schemaCode: c }) => (0, r._)`{comparison: ${i[o].okStr}, limit: ${c}}`
    };
    t.formatLimitDefinition = {
      keyword: Object.keys(i),
      type: "string",
      schemaType: "string",
      $data: !0,
      error: s,
      code(o) {
        const { gen: c, data: h, schemaCode: f, keyword: u, it: l } = o, { opts: d, self: g } = l;
        if (!d.validateFormats)
          return;
        const w = new e.KeywordCxt(l, g.RULES.all.format.definition, "format");
        w.$data ? m() : v();
        function m() {
          const E = c.scopeValue("formats", {
            ref: g.formats,
            code: d.code.formats
          }), _ = c.const("fmt", (0, r._)`${E}[${w.schemaCode}]`);
          o.fail$data((0, r.or)((0, r._)`typeof ${_} != "object"`, (0, r._)`${_} instanceof RegExp`, (0, r._)`typeof ${_}.compare != "function"`, p(_)));
        }
        function v() {
          const E = w.schema, _ = g.formats[E];
          if (!_ || _ === !0)
            return;
          if (typeof _ != "object" || _ instanceof RegExp || typeof _.compare != "function")
            throw new Error(`"${u}": format "${E}" does not define "compare" function`);
          const y = c.scopeValue("formats", {
            key: E,
            ref: _,
            code: d.code.formats ? (0, r._)`${d.code.formats}${(0, r.getProperty)(E)}` : void 0
          });
          o.fail$data(p(y));
        }
        function p(E) {
          return (0, r._)`${E}.compare(${h}, ${f}) ${i[u].fail} 0`;
        }
      },
      dependencies: ["format"]
    };
    const a = (o) => (o.addKeyword(t.formatLimitDefinition), o);
    t.default = a;
  })(La)), La;
}
var Ou;
function Zg() {
  return Ou || (Ou = 1, (function(t, e) {
    Object.defineProperty(e, "__esModule", { value: !0 });
    const r = Dg(), n = Bg(), i = kt(), s = new i.Name("fullFormats"), a = new i.Name("fastFormats"), o = (h, f = { keywords: !0 }) => {
      if (Array.isArray(f))
        return c(h, f, r.fullFormats, s), h;
      const [u, l] = f.mode === "fast" ? [r.fastFormats, a] : [r.fullFormats, s], d = f.formats || r.formatNames;
      return c(h, d, u, l), f.keywords && (0, n.default)(h), h;
    };
    o.get = (h, f = "full") => {
      const l = (f === "fast" ? r.fastFormats : r.fullFormats)[h];
      if (!l)
        throw new Error(`Unknown format "${h}"`);
      return l;
    };
    function c(h, f, u, l) {
      var d, g;
      (d = (g = h.opts.code).formats) !== null && d !== void 0 || (g.formats = (0, i._)`require("ajv-formats/dist/formats").${l}`);
      for (const w of f)
        h.addFormat(w, u[w]);
    }
    t.exports = e = o, Object.defineProperty(e, "__esModule", { value: !0 }), e.default = o;
  })(gs, gs.exports)), gs.exports;
}
var Vg = Zg();
const Hg = /* @__PURE__ */ an(Vg), Kg = (t, e, r, n) => {
  if (r === "length" || r === "prototype" || r === "arguments" || r === "caller")
    return;
  const i = Object.getOwnPropertyDescriptor(t, r), s = Object.getOwnPropertyDescriptor(e, r);
  !Xg(i, s) && n || Object.defineProperty(t, r, s);
}, Xg = function(t, e) {
  return t === void 0 || t.configurable || t.writable === e.writable && t.enumerable === e.enumerable && t.configurable === e.configurable && (t.writable || t.value === e.value);
}, Wg = (t, e) => {
  const r = Object.getPrototypeOf(e);
  r !== Object.getPrototypeOf(t) && Object.setPrototypeOf(t, r);
}, Jg = (t, e) => `/* Wrapped ${t}*/
${e}`, Yg = Object.getOwnPropertyDescriptor(Function.prototype, "toString"), Qg = Object.getOwnPropertyDescriptor(Function.prototype.toString, "name"), tw = (t, e, r) => {
  const n = r === "" ? "" : `with ${r.trim()}() `, i = Jg.bind(null, n, e.toString());
  Object.defineProperty(i, "name", Qg);
  const { writable: s, enumerable: a, configurable: o } = Yg;
  Object.defineProperty(t, "toString", { value: i, writable: s, enumerable: a, configurable: o });
};
function ew(t, e, { ignoreNonConfigurable: r = !1 } = {}) {
  const { name: n } = t;
  for (const i of Reflect.ownKeys(e))
    Kg(t, e, i, r);
  return Wg(t, e), tw(t, e, n), t;
}
const Ru = (t, e = {}) => {
  if (typeof t != "function")
    throw new TypeError(`Expected the first argument to be a function, got \`${typeof t}\``);
  const {
    wait: r = 0,
    maxWait: n = Number.POSITIVE_INFINITY,
    before: i = !1,
    after: s = !0
  } = e;
  if (r < 0 || n < 0)
    throw new RangeError("`wait` and `maxWait` must not be negative.");
  if (!i && !s)
    throw new Error("Both `before` and `after` are false, function wouldn't be called.");
  let a, o, c;
  const h = function(...f) {
    const u = this, l = () => {
      a = void 0, o && (clearTimeout(o), o = void 0), s && (c = t.apply(u, f));
    }, d = () => {
      o = void 0, a && (clearTimeout(a), a = void 0), s && (c = t.apply(u, f));
    }, g = i && !a;
    return clearTimeout(a), a = setTimeout(l, r), n > 0 && n !== Number.POSITIVE_INFINITY && !o && (o = setTimeout(d, n)), g && (c = t.apply(u, f)), c;
  };
  return ew(h, t), h.cancel = () => {
    a && (clearTimeout(a), a = void 0), o && (clearTimeout(o), o = void 0);
  }, h;
};
var vs = { exports: {} }, Fa, Du;
function pa() {
  if (Du) return Fa;
  Du = 1;
  const t = "2.0.0", e = 256, r = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
  9007199254740991, n = 16, i = e - 6;
  return Fa = {
    MAX_LENGTH: e,
    MAX_SAFE_COMPONENT_LENGTH: n,
    MAX_SAFE_BUILD_LENGTH: i,
    MAX_SAFE_INTEGER: r,
    RELEASE_TYPES: [
      "major",
      "premajor",
      "minor",
      "preminor",
      "patch",
      "prepatch",
      "prerelease"
    ],
    SEMVER_SPEC_VERSION: t,
    FLAG_INCLUDE_PRERELEASE: 1,
    FLAG_LOOSE: 2
  }, Fa;
}
var Ga, ju;
function ya() {
  return ju || (ju = 1, Ga = typeof process == "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...e) => console.error("SEMVER", ...e) : () => {
  }), Ga;
}
var Tu;
function li() {
  return Tu || (Tu = 1, (function(t, e) {
    const {
      MAX_SAFE_COMPONENT_LENGTH: r,
      MAX_SAFE_BUILD_LENGTH: n,
      MAX_LENGTH: i
    } = pa(), s = ya();
    e = t.exports = {};
    const a = e.re = [], o = e.safeRe = [], c = e.src = [], h = e.safeSrc = [], f = e.t = {};
    let u = 0;
    const l = "[a-zA-Z0-9-]", d = [
      ["\\s", 1],
      ["\\d", i],
      [l, n]
    ], g = (m) => {
      for (const [v, p] of d)
        m = m.split(`${v}*`).join(`${v}{0,${p}}`).split(`${v}+`).join(`${v}{1,${p}}`);
      return m;
    }, w = (m, v, p) => {
      const E = g(v), _ = u++;
      s(m, _, v), f[m] = _, c[_] = v, h[_] = E, a[_] = new RegExp(v, p ? "g" : void 0), o[_] = new RegExp(E, p ? "g" : void 0);
    };
    w("NUMERICIDENTIFIER", "0|[1-9]\\d*"), w("NUMERICIDENTIFIERLOOSE", "\\d+"), w("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${l}*`), w("MAINVERSION", `(${c[f.NUMERICIDENTIFIER]})\\.(${c[f.NUMERICIDENTIFIER]})\\.(${c[f.NUMERICIDENTIFIER]})`), w("MAINVERSIONLOOSE", `(${c[f.NUMERICIDENTIFIERLOOSE]})\\.(${c[f.NUMERICIDENTIFIERLOOSE]})\\.(${c[f.NUMERICIDENTIFIERLOOSE]})`), w("PRERELEASEIDENTIFIER", `(?:${c[f.NONNUMERICIDENTIFIER]}|${c[f.NUMERICIDENTIFIER]})`), w("PRERELEASEIDENTIFIERLOOSE", `(?:${c[f.NONNUMERICIDENTIFIER]}|${c[f.NUMERICIDENTIFIERLOOSE]})`), w("PRERELEASE", `(?:-(${c[f.PRERELEASEIDENTIFIER]}(?:\\.${c[f.PRERELEASEIDENTIFIER]})*))`), w("PRERELEASELOOSE", `(?:-?(${c[f.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${c[f.PRERELEASEIDENTIFIERLOOSE]})*))`), w("BUILDIDENTIFIER", `${l}+`), w("BUILD", `(?:\\+(${c[f.BUILDIDENTIFIER]}(?:\\.${c[f.BUILDIDENTIFIER]})*))`), w("FULLPLAIN", `v?${c[f.MAINVERSION]}${c[f.PRERELEASE]}?${c[f.BUILD]}?`), w("FULL", `^${c[f.FULLPLAIN]}$`), w("LOOSEPLAIN", `[v=\\s]*${c[f.MAINVERSIONLOOSE]}${c[f.PRERELEASELOOSE]}?${c[f.BUILD]}?`), w("LOOSE", `^${c[f.LOOSEPLAIN]}$`), w("GTLT", "((?:<|>)?=?)"), w("XRANGEIDENTIFIERLOOSE", `${c[f.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`), w("XRANGEIDENTIFIER", `${c[f.NUMERICIDENTIFIER]}|x|X|\\*`), w("XRANGEPLAIN", `[v=\\s]*(${c[f.XRANGEIDENTIFIER]})(?:\\.(${c[f.XRANGEIDENTIFIER]})(?:\\.(${c[f.XRANGEIDENTIFIER]})(?:${c[f.PRERELEASE]})?${c[f.BUILD]}?)?)?`), w("XRANGEPLAINLOOSE", `[v=\\s]*(${c[f.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[f.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[f.XRANGEIDENTIFIERLOOSE]})(?:${c[f.PRERELEASELOOSE]})?${c[f.BUILD]}?)?)?`), w("XRANGE", `^${c[f.GTLT]}\\s*${c[f.XRANGEPLAIN]}$`), w("XRANGELOOSE", `^${c[f.GTLT]}\\s*${c[f.XRANGEPLAINLOOSE]}$`), w("COERCEPLAIN", `(^|[^\\d])(\\d{1,${r}})(?:\\.(\\d{1,${r}}))?(?:\\.(\\d{1,${r}}))?`), w("COERCE", `${c[f.COERCEPLAIN]}(?:$|[^\\d])`), w("COERCEFULL", c[f.COERCEPLAIN] + `(?:${c[f.PRERELEASE]})?(?:${c[f.BUILD]})?(?:$|[^\\d])`), w("COERCERTL", c[f.COERCE], !0), w("COERCERTLFULL", c[f.COERCEFULL], !0), w("LONETILDE", "(?:~>?)"), w("TILDETRIM", `(\\s*)${c[f.LONETILDE]}\\s+`, !0), e.tildeTrimReplace = "$1~", w("TILDE", `^${c[f.LONETILDE]}${c[f.XRANGEPLAIN]}$`), w("TILDELOOSE", `^${c[f.LONETILDE]}${c[f.XRANGEPLAINLOOSE]}$`), w("LONECARET", "(?:\\^)"), w("CARETTRIM", `(\\s*)${c[f.LONECARET]}\\s+`, !0), e.caretTrimReplace = "$1^", w("CARET", `^${c[f.LONECARET]}${c[f.XRANGEPLAIN]}$`), w("CARETLOOSE", `^${c[f.LONECARET]}${c[f.XRANGEPLAINLOOSE]}$`), w("COMPARATORLOOSE", `^${c[f.GTLT]}\\s*(${c[f.LOOSEPLAIN]})$|^$`), w("COMPARATOR", `^${c[f.GTLT]}\\s*(${c[f.FULLPLAIN]})$|^$`), w("COMPARATORTRIM", `(\\s*)${c[f.GTLT]}\\s*(${c[f.LOOSEPLAIN]}|${c[f.XRANGEPLAIN]})`, !0), e.comparatorTrimReplace = "$1$2$3", w("HYPHENRANGE", `^\\s*(${c[f.XRANGEPLAIN]})\\s+-\\s+(${c[f.XRANGEPLAIN]})\\s*$`), w("HYPHENRANGELOOSE", `^\\s*(${c[f.XRANGEPLAINLOOSE]})\\s+-\\s+(${c[f.XRANGEPLAINLOOSE]})\\s*$`), w("STAR", "(<|>)?=?\\s*\\*"), w("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$"), w("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  })(vs, vs.exports)), vs.exports;
}
var za, Cu;
function bh() {
  if (Cu) return za;
  Cu = 1;
  const t = Object.freeze({ loose: !0 }), e = Object.freeze({});
  return za = (n) => n ? typeof n != "object" ? t : n : e, za;
}
var qa, Lu;
function Nm() {
  if (Lu) return qa;
  Lu = 1;
  const t = /^[0-9]+$/, e = (n, i) => {
    if (typeof n == "number" && typeof i == "number")
      return n === i ? 0 : n < i ? -1 : 1;
    const s = t.test(n), a = t.test(i);
    return s && a && (n = +n, i = +i), n === i ? 0 : s && !a ? -1 : a && !s ? 1 : n < i ? -1 : 1;
  };
  return qa = {
    compareIdentifiers: e,
    rcompareIdentifiers: (n, i) => e(i, n)
  }, qa;
}
var Ua, Fu;
function ke() {
  if (Fu) return Ua;
  Fu = 1;
  const t = ya(), { MAX_LENGTH: e, MAX_SAFE_INTEGER: r } = pa(), { safeRe: n, t: i } = li(), s = bh(), { compareIdentifiers: a } = Nm();
  class o {
    constructor(h, f) {
      if (f = s(f), h instanceof o) {
        if (h.loose === !!f.loose && h.includePrerelease === !!f.includePrerelease)
          return h;
        h = h.version;
      } else if (typeof h != "string")
        throw new TypeError(`Invalid version. Must be a string. Got type "${typeof h}".`);
      if (h.length > e)
        throw new TypeError(
          `version is longer than ${e} characters`
        );
      t("SemVer", h, f), this.options = f, this.loose = !!f.loose, this.includePrerelease = !!f.includePrerelease;
      const u = h.trim().match(f.loose ? n[i.LOOSE] : n[i.FULL]);
      if (!u)
        throw new TypeError(`Invalid Version: ${h}`);
      if (this.raw = h, this.major = +u[1], this.minor = +u[2], this.patch = +u[3], this.major > r || this.major < 0)
        throw new TypeError("Invalid major version");
      if (this.minor > r || this.minor < 0)
        throw new TypeError("Invalid minor version");
      if (this.patch > r || this.patch < 0)
        throw new TypeError("Invalid patch version");
      u[4] ? this.prerelease = u[4].split(".").map((l) => {
        if (/^[0-9]+$/.test(l)) {
          const d = +l;
          if (d >= 0 && d < r)
            return d;
        }
        return l;
      }) : this.prerelease = [], this.build = u[5] ? u[5].split(".") : [], this.format();
    }
    format() {
      return this.version = `${this.major}.${this.minor}.${this.patch}`, this.prerelease.length && (this.version += `-${this.prerelease.join(".")}`), this.version;
    }
    toString() {
      return this.version;
    }
    compare(h) {
      if (t("SemVer.compare", this.version, this.options, h), !(h instanceof o)) {
        if (typeof h == "string" && h === this.version)
          return 0;
        h = new o(h, this.options);
      }
      return h.version === this.version ? 0 : this.compareMain(h) || this.comparePre(h);
    }
    compareMain(h) {
      return h instanceof o || (h = new o(h, this.options)), this.major < h.major ? -1 : this.major > h.major ? 1 : this.minor < h.minor ? -1 : this.minor > h.minor ? 1 : this.patch < h.patch ? -1 : this.patch > h.patch ? 1 : 0;
    }
    comparePre(h) {
      if (h instanceof o || (h = new o(h, this.options)), this.prerelease.length && !h.prerelease.length)
        return -1;
      if (!this.prerelease.length && h.prerelease.length)
        return 1;
      if (!this.prerelease.length && !h.prerelease.length)
        return 0;
      let f = 0;
      do {
        const u = this.prerelease[f], l = h.prerelease[f];
        if (t("prerelease compare", f, u, l), u === void 0 && l === void 0)
          return 0;
        if (l === void 0)
          return 1;
        if (u === void 0)
          return -1;
        if (u === l)
          continue;
        return a(u, l);
      } while (++f);
    }
    compareBuild(h) {
      h instanceof o || (h = new o(h, this.options));
      let f = 0;
      do {
        const u = this.build[f], l = h.build[f];
        if (t("build compare", f, u, l), u === void 0 && l === void 0)
          return 0;
        if (l === void 0)
          return 1;
        if (u === void 0)
          return -1;
        if (u === l)
          continue;
        return a(u, l);
      } while (++f);
    }
    // preminor will bump the version up to the next minor release, and immediately
    // down to pre-release. premajor and prepatch work the same way.
    inc(h, f, u) {
      if (h.startsWith("pre")) {
        if (!f && u === !1)
          throw new Error("invalid increment argument: identifier is empty");
        if (f) {
          const l = `-${f}`.match(this.options.loose ? n[i.PRERELEASELOOSE] : n[i.PRERELEASE]);
          if (!l || l[1] !== f)
            throw new Error(`invalid identifier: ${f}`);
        }
      }
      switch (h) {
        case "premajor":
          this.prerelease.length = 0, this.patch = 0, this.minor = 0, this.major++, this.inc("pre", f, u);
          break;
        case "preminor":
          this.prerelease.length = 0, this.patch = 0, this.minor++, this.inc("pre", f, u);
          break;
        case "prepatch":
          this.prerelease.length = 0, this.inc("patch", f, u), this.inc("pre", f, u);
          break;
        // If the input is a non-prerelease version, this acts the same as
        // prepatch.
        case "prerelease":
          this.prerelease.length === 0 && this.inc("patch", f, u), this.inc("pre", f, u);
          break;
        case "release":
          if (this.prerelease.length === 0)
            throw new Error(`version ${this.raw} is not a prerelease`);
          this.prerelease.length = 0;
          break;
        case "major":
          (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) && this.major++, this.minor = 0, this.patch = 0, this.prerelease = [];
          break;
        case "minor":
          (this.patch !== 0 || this.prerelease.length === 0) && this.minor++, this.patch = 0, this.prerelease = [];
          break;
        case "patch":
          this.prerelease.length === 0 && this.patch++, this.prerelease = [];
          break;
        // This probably shouldn't be used publicly.
        // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
        case "pre": {
          const l = Number(u) ? 1 : 0;
          if (this.prerelease.length === 0)
            this.prerelease = [l];
          else {
            let d = this.prerelease.length;
            for (; --d >= 0; )
              typeof this.prerelease[d] == "number" && (this.prerelease[d]++, d = -2);
            if (d === -1) {
              if (f === this.prerelease.join(".") && u === !1)
                throw new Error("invalid increment argument: identifier already exists");
              this.prerelease.push(l);
            }
          }
          if (f) {
            let d = [f, l];
            u === !1 && (d = [f]), a(this.prerelease[0], f) === 0 ? isNaN(this.prerelease[1]) && (this.prerelease = d) : this.prerelease = d;
          }
          break;
        }
        default:
          throw new Error(`invalid increment argument: ${h}`);
      }
      return this.raw = this.format(), this.build.length && (this.raw += `+${this.build.join(".")}`), this;
    }
  }
  return Ua = o, Ua;
}
var Ba, Gu;
function Nn() {
  if (Gu) return Ba;
  Gu = 1;
  const t = ke();
  return Ba = (r, n, i = !1) => {
    if (r instanceof t)
      return r;
    try {
      return new t(r, n);
    } catch (s) {
      if (!i)
        return null;
      throw s;
    }
  }, Ba;
}
var Za, zu;
function rw() {
  if (zu) return Za;
  zu = 1;
  const t = Nn();
  return Za = (r, n) => {
    const i = t(r, n);
    return i ? i.version : null;
  }, Za;
}
var Va, qu;
function nw() {
  if (qu) return Va;
  qu = 1;
  const t = Nn();
  return Va = (r, n) => {
    const i = t(r.trim().replace(/^[=v]+/, ""), n);
    return i ? i.version : null;
  }, Va;
}
var Ha, Uu;
function iw() {
  if (Uu) return Ha;
  Uu = 1;
  const t = ke();
  return Ha = (r, n, i, s, a) => {
    typeof i == "string" && (a = s, s = i, i = void 0);
    try {
      return new t(
        r instanceof t ? r.version : r,
        i
      ).inc(n, s, a).version;
    } catch {
      return null;
    }
  }, Ha;
}
var Ka, Bu;
function sw() {
  if (Bu) return Ka;
  Bu = 1;
  const t = Nn();
  return Ka = (r, n) => {
    const i = t(r, null, !0), s = t(n, null, !0), a = i.compare(s);
    if (a === 0)
      return null;
    const o = a > 0, c = o ? i : s, h = o ? s : i, f = !!c.prerelease.length;
    if (!!h.prerelease.length && !f) {
      if (!h.patch && !h.minor)
        return "major";
      if (h.compareMain(c) === 0)
        return h.minor && !h.patch ? "minor" : "patch";
    }
    const l = f ? "pre" : "";
    return i.major !== s.major ? l + "major" : i.minor !== s.minor ? l + "minor" : i.patch !== s.patch ? l + "patch" : "prerelease";
  }, Ka;
}
var Xa, Zu;
function aw() {
  if (Zu) return Xa;
  Zu = 1;
  const t = ke();
  return Xa = (r, n) => new t(r, n).major, Xa;
}
var Wa, Vu;
function ow() {
  if (Vu) return Wa;
  Vu = 1;
  const t = ke();
  return Wa = (r, n) => new t(r, n).minor, Wa;
}
var Ja, Hu;
function cw() {
  if (Hu) return Ja;
  Hu = 1;
  const t = ke();
  return Ja = (r, n) => new t(r, n).patch, Ja;
}
var Ya, Ku;
function hw() {
  if (Ku) return Ya;
  Ku = 1;
  const t = Nn();
  return Ya = (r, n) => {
    const i = t(r, n);
    return i && i.prerelease.length ? i.prerelease : null;
  }, Ya;
}
var Qa, Xu;
function tr() {
  if (Xu) return Qa;
  Xu = 1;
  const t = ke();
  return Qa = (r, n, i) => new t(r, i).compare(new t(n, i)), Qa;
}
var to, Wu;
function lw() {
  if (Wu) return to;
  Wu = 1;
  const t = tr();
  return to = (r, n, i) => t(n, r, i), to;
}
var eo, Ju;
function uw() {
  if (Ju) return eo;
  Ju = 1;
  const t = tr();
  return eo = (r, n) => t(r, n, !0), eo;
}
var ro, Yu;
function Sh() {
  if (Yu) return ro;
  Yu = 1;
  const t = ke();
  return ro = (r, n, i) => {
    const s = new t(r, i), a = new t(n, i);
    return s.compare(a) || s.compareBuild(a);
  }, ro;
}
var no, Qu;
function fw() {
  if (Qu) return no;
  Qu = 1;
  const t = Sh();
  return no = (r, n) => r.sort((i, s) => t(i, s, n)), no;
}
var io, tf;
function dw() {
  if (tf) return io;
  tf = 1;
  const t = Sh();
  return io = (r, n) => r.sort((i, s) => t(s, i, n)), io;
}
var so, ef;
function ga() {
  if (ef) return so;
  ef = 1;
  const t = tr();
  return so = (r, n, i) => t(r, n, i) > 0, so;
}
var ao, rf;
function Mh() {
  if (rf) return ao;
  rf = 1;
  const t = tr();
  return ao = (r, n, i) => t(r, n, i) < 0, ao;
}
var oo, nf;
function Om() {
  if (nf) return oo;
  nf = 1;
  const t = tr();
  return oo = (r, n, i) => t(r, n, i) === 0, oo;
}
var co, sf;
function Rm() {
  if (sf) return co;
  sf = 1;
  const t = tr();
  return co = (r, n, i) => t(r, n, i) !== 0, co;
}
var ho, af;
function xh() {
  if (af) return ho;
  af = 1;
  const t = tr();
  return ho = (r, n, i) => t(r, n, i) >= 0, ho;
}
var lo, of;
function kh() {
  if (of) return lo;
  of = 1;
  const t = tr();
  return lo = (r, n, i) => t(r, n, i) <= 0, lo;
}
var uo, cf;
function Dm() {
  if (cf) return uo;
  cf = 1;
  const t = Om(), e = Rm(), r = ga(), n = xh(), i = Mh(), s = kh();
  return uo = (o, c, h, f) => {
    switch (c) {
      case "===":
        return typeof o == "object" && (o = o.version), typeof h == "object" && (h = h.version), o === h;
      case "!==":
        return typeof o == "object" && (o = o.version), typeof h == "object" && (h = h.version), o !== h;
      case "":
      case "=":
      case "==":
        return t(o, h, f);
      case "!=":
        return e(o, h, f);
      case ">":
        return r(o, h, f);
      case ">=":
        return n(o, h, f);
      case "<":
        return i(o, h, f);
      case "<=":
        return s(o, h, f);
      default:
        throw new TypeError(`Invalid operator: ${c}`);
    }
  }, uo;
}
var fo, hf;
function mw() {
  if (hf) return fo;
  hf = 1;
  const t = ke(), e = Nn(), { safeRe: r, t: n } = li();
  return fo = (s, a) => {
    if (s instanceof t)
      return s;
    if (typeof s == "number" && (s = String(s)), typeof s != "string")
      return null;
    a = a || {};
    let o = null;
    if (!a.rtl)
      o = s.match(a.includePrerelease ? r[n.COERCEFULL] : r[n.COERCE]);
    else {
      const d = a.includePrerelease ? r[n.COERCERTLFULL] : r[n.COERCERTL];
      let g;
      for (; (g = d.exec(s)) && (!o || o.index + o[0].length !== s.length); )
        (!o || g.index + g[0].length !== o.index + o[0].length) && (o = g), d.lastIndex = g.index + g[1].length + g[2].length;
      d.lastIndex = -1;
    }
    if (o === null)
      return null;
    const c = o[2], h = o[3] || "0", f = o[4] || "0", u = a.includePrerelease && o[5] ? `-${o[5]}` : "", l = a.includePrerelease && o[6] ? `+${o[6]}` : "";
    return e(`${c}.${h}.${f}${u}${l}`, a);
  }, fo;
}
var mo, lf;
function pw() {
  if (lf) return mo;
  lf = 1;
  class t {
    constructor() {
      this.max = 1e3, this.map = /* @__PURE__ */ new Map();
    }
    get(r) {
      const n = this.map.get(r);
      if (n !== void 0)
        return this.map.delete(r), this.map.set(r, n), n;
    }
    delete(r) {
      return this.map.delete(r);
    }
    set(r, n) {
      if (!this.delete(r) && n !== void 0) {
        if (this.map.size >= this.max) {
          const s = this.map.keys().next().value;
          this.delete(s);
        }
        this.map.set(r, n);
      }
      return this;
    }
  }
  return mo = t, mo;
}
var po, uf;
function er() {
  if (uf) return po;
  uf = 1;
  const t = /\s+/g;
  class e {
    constructor(N, j) {
      if (j = i(j), N instanceof e)
        return N.loose === !!j.loose && N.includePrerelease === !!j.includePrerelease ? N : new e(N.raw, j);
      if (N instanceof s)
        return this.raw = N.value, this.set = [[N]], this.formatted = void 0, this;
      if (this.options = j, this.loose = !!j.loose, this.includePrerelease = !!j.includePrerelease, this.raw = N.trim().replace(t, " "), this.set = this.raw.split("||").map((C) => this.parseRange(C.trim())).filter((C) => C.length), !this.set.length)
        throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
      if (this.set.length > 1) {
        const C = this.set[0];
        if (this.set = this.set.filter((F) => !w(F[0])), this.set.length === 0)
          this.set = [C];
        else if (this.set.length > 1) {
          for (const F of this.set)
            if (F.length === 1 && m(F[0])) {
              this.set = [F];
              break;
            }
        }
      }
      this.formatted = void 0;
    }
    get range() {
      if (this.formatted === void 0) {
        this.formatted = "";
        for (let N = 0; N < this.set.length; N++) {
          N > 0 && (this.formatted += "||");
          const j = this.set[N];
          for (let C = 0; C < j.length; C++)
            C > 0 && (this.formatted += " "), this.formatted += j[C].toString().trim();
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
    parseRange(N) {
      const C = ((this.options.includePrerelease && d) | (this.options.loose && g)) + ":" + N, F = n.get(C);
      if (F)
        return F;
      const q = this.options.loose, R = q ? c[h.HYPHENRANGELOOSE] : c[h.HYPHENRANGE];
      N = N.replace(R, O(this.options.includePrerelease)), a("hyphen replace", N), N = N.replace(c[h.COMPARATORTRIM], f), a("comparator trim", N), N = N.replace(c[h.TILDETRIM], u), a("tilde trim", N), N = N.replace(c[h.CARETTRIM], l), a("caret trim", N);
      let D = N.split(" ").map((P) => p(P, this.options)).join(" ").split(/\s+/).map((P) => $(P, this.options));
      q && (D = D.filter((P) => (a("loose invalid filter", P, this.options), !!P.match(c[h.COMPARATORLOOSE])))), a("range list", D);
      const G = /* @__PURE__ */ new Map(), L = D.map((P) => new s(P, this.options));
      for (const P of L) {
        if (w(P))
          return [P];
        G.set(P.value, P);
      }
      G.size > 1 && G.has("") && G.delete("");
      const A = [...G.values()];
      return n.set(C, A), A;
    }
    intersects(N, j) {
      if (!(N instanceof e))
        throw new TypeError("a Range is required");
      return this.set.some((C) => v(C, j) && N.set.some((F) => v(F, j) && C.every((q) => F.every((R) => q.intersects(R, j)))));
    }
    // if ANY of the sets match ALL of its comparators, then pass
    test(N) {
      if (!N)
        return !1;
      if (typeof N == "string")
        try {
          N = new o(N, this.options);
        } catch {
          return !1;
        }
      for (let j = 0; j < this.set.length; j++)
        if (T(this.set[j], N, this.options))
          return !0;
      return !1;
    }
  }
  po = e;
  const r = pw(), n = new r(), i = bh(), s = wa(), a = ya(), o = ke(), {
    safeRe: c,
    t: h,
    comparatorTrimReplace: f,
    tildeTrimReplace: u,
    caretTrimReplace: l
  } = li(), { FLAG_INCLUDE_PRERELEASE: d, FLAG_LOOSE: g } = pa(), w = (I) => I.value === "<0.0.0-0", m = (I) => I.value === "", v = (I, N) => {
    let j = !0;
    const C = I.slice();
    let F = C.pop();
    for (; j && C.length; )
      j = C.every((q) => F.intersects(q, N)), F = C.pop();
    return j;
  }, p = (I, N) => (I = I.replace(c[h.BUILD], ""), a("comp", I, N), I = b(I, N), a("caret", I), I = _(I, N), a("tildes", I), I = x(I, N), a("xrange", I), I = k(I, N), a("stars", I), I), E = (I) => !I || I.toLowerCase() === "x" || I === "*", _ = (I, N) => I.trim().split(/\s+/).map((j) => y(j, N)).join(" "), y = (I, N) => {
    const j = N.loose ? c[h.TILDELOOSE] : c[h.TILDE];
    return I.replace(j, (C, F, q, R, D) => {
      a("tilde", I, C, F, q, R, D);
      let G;
      return E(F) ? G = "" : E(q) ? G = `>=${F}.0.0 <${+F + 1}.0.0-0` : E(R) ? G = `>=${F}.${q}.0 <${F}.${+q + 1}.0-0` : D ? (a("replaceTilde pr", D), G = `>=${F}.${q}.${R}-${D} <${F}.${+q + 1}.0-0`) : G = `>=${F}.${q}.${R} <${F}.${+q + 1}.0-0`, a("tilde return", G), G;
    });
  }, b = (I, N) => I.trim().split(/\s+/).map((j) => S(j, N)).join(" "), S = (I, N) => {
    a("caret", I, N);
    const j = N.loose ? c[h.CARETLOOSE] : c[h.CARET], C = N.includePrerelease ? "-0" : "";
    return I.replace(j, (F, q, R, D, G) => {
      a("caret", I, F, q, R, D, G);
      let L;
      return E(q) ? L = "" : E(R) ? L = `>=${q}.0.0${C} <${+q + 1}.0.0-0` : E(D) ? q === "0" ? L = `>=${q}.${R}.0${C} <${q}.${+R + 1}.0-0` : L = `>=${q}.${R}.0${C} <${+q + 1}.0.0-0` : G ? (a("replaceCaret pr", G), q === "0" ? R === "0" ? L = `>=${q}.${R}.${D}-${G} <${q}.${R}.${+D + 1}-0` : L = `>=${q}.${R}.${D}-${G} <${q}.${+R + 1}.0-0` : L = `>=${q}.${R}.${D}-${G} <${+q + 1}.0.0-0`) : (a("no pr"), q === "0" ? R === "0" ? L = `>=${q}.${R}.${D}${C} <${q}.${R}.${+D + 1}-0` : L = `>=${q}.${R}.${D}${C} <${q}.${+R + 1}.0-0` : L = `>=${q}.${R}.${D} <${+q + 1}.0.0-0`), a("caret return", L), L;
    });
  }, x = (I, N) => (a("replaceXRanges", I, N), I.split(/\s+/).map((j) => M(j, N)).join(" ")), M = (I, N) => {
    I = I.trim();
    const j = N.loose ? c[h.XRANGELOOSE] : c[h.XRANGE];
    return I.replace(j, (C, F, q, R, D, G) => {
      a("xRange", I, C, F, q, R, D, G);
      const L = E(q), A = L || E(R), P = A || E(D), U = P;
      return F === "=" && U && (F = ""), G = N.includePrerelease ? "-0" : "", L ? F === ">" || F === "<" ? C = "<0.0.0-0" : C = "*" : F && U ? (A && (R = 0), D = 0, F === ">" ? (F = ">=", A ? (q = +q + 1, R = 0, D = 0) : (R = +R + 1, D = 0)) : F === "<=" && (F = "<", A ? q = +q + 1 : R = +R + 1), F === "<" && (G = "-0"), C = `${F + q}.${R}.${D}${G}`) : A ? C = `>=${q}.0.0${G} <${+q + 1}.0.0-0` : P && (C = `>=${q}.${R}.0${G} <${q}.${+R + 1}.0-0`), a("xRange return", C), C;
    });
  }, k = (I, N) => (a("replaceStars", I, N), I.trim().replace(c[h.STAR], "")), $ = (I, N) => (a("replaceGTE0", I, N), I.trim().replace(c[N.includePrerelease ? h.GTE0PRE : h.GTE0], "")), O = (I) => (N, j, C, F, q, R, D, G, L, A, P, U) => (E(C) ? j = "" : E(F) ? j = `>=${C}.0.0${I ? "-0" : ""}` : E(q) ? j = `>=${C}.${F}.0${I ? "-0" : ""}` : R ? j = `>=${j}` : j = `>=${j}${I ? "-0" : ""}`, E(L) ? G = "" : E(A) ? G = `<${+L + 1}.0.0-0` : E(P) ? G = `<${L}.${+A + 1}.0-0` : U ? G = `<=${L}.${A}.${P}-${U}` : I ? G = `<${L}.${A}.${+P + 1}-0` : G = `<=${G}`, `${j} ${G}`.trim()), T = (I, N, j) => {
    for (let C = 0; C < I.length; C++)
      if (!I[C].test(N))
        return !1;
    if (N.prerelease.length && !j.includePrerelease) {
      for (let C = 0; C < I.length; C++)
        if (a(I[C].semver), I[C].semver !== s.ANY && I[C].semver.prerelease.length > 0) {
          const F = I[C].semver;
          if (F.major === N.major && F.minor === N.minor && F.patch === N.patch)
            return !0;
        }
      return !1;
    }
    return !0;
  };
  return po;
}
var yo, ff;
function wa() {
  if (ff) return yo;
  ff = 1;
  const t = /* @__PURE__ */ Symbol("SemVer ANY");
  class e {
    static get ANY() {
      return t;
    }
    constructor(f, u) {
      if (u = r(u), f instanceof e) {
        if (f.loose === !!u.loose)
          return f;
        f = f.value;
      }
      f = f.trim().split(/\s+/).join(" "), a("comparator", f, u), this.options = u, this.loose = !!u.loose, this.parse(f), this.semver === t ? this.value = "" : this.value = this.operator + this.semver.version, a("comp", this);
    }
    parse(f) {
      const u = this.options.loose ? n[i.COMPARATORLOOSE] : n[i.COMPARATOR], l = f.match(u);
      if (!l)
        throw new TypeError(`Invalid comparator: ${f}`);
      this.operator = l[1] !== void 0 ? l[1] : "", this.operator === "=" && (this.operator = ""), l[2] ? this.semver = new o(l[2], this.options.loose) : this.semver = t;
    }
    toString() {
      return this.value;
    }
    test(f) {
      if (a("Comparator.test", f, this.options.loose), this.semver === t || f === t)
        return !0;
      if (typeof f == "string")
        try {
          f = new o(f, this.options);
        } catch {
          return !1;
        }
      return s(f, this.operator, this.semver, this.options);
    }
    intersects(f, u) {
      if (!(f instanceof e))
        throw new TypeError("a Comparator is required");
      return this.operator === "" ? this.value === "" ? !0 : new c(f.value, u).test(this.value) : f.operator === "" ? f.value === "" ? !0 : new c(this.value, u).test(f.semver) : (u = r(u), u.includePrerelease && (this.value === "<0.0.0-0" || f.value === "<0.0.0-0") || !u.includePrerelease && (this.value.startsWith("<0.0.0") || f.value.startsWith("<0.0.0")) ? !1 : !!(this.operator.startsWith(">") && f.operator.startsWith(">") || this.operator.startsWith("<") && f.operator.startsWith("<") || this.semver.version === f.semver.version && this.operator.includes("=") && f.operator.includes("=") || s(this.semver, "<", f.semver, u) && this.operator.startsWith(">") && f.operator.startsWith("<") || s(this.semver, ">", f.semver, u) && this.operator.startsWith("<") && f.operator.startsWith(">")));
    }
  }
  yo = e;
  const r = bh(), { safeRe: n, t: i } = li(), s = Dm(), a = ya(), o = ke(), c = er();
  return yo;
}
var go, df;
function _a() {
  if (df) return go;
  df = 1;
  const t = er();
  return go = (r, n, i) => {
    try {
      n = new t(n, i);
    } catch {
      return !1;
    }
    return n.test(r);
  }, go;
}
var wo, mf;
function yw() {
  if (mf) return wo;
  mf = 1;
  const t = er();
  return wo = (r, n) => new t(r, n).set.map((i) => i.map((s) => s.value).join(" ").trim().split(" ")), wo;
}
var _o, pf;
function gw() {
  if (pf) return _o;
  pf = 1;
  const t = ke(), e = er();
  return _o = (n, i, s) => {
    let a = null, o = null, c = null;
    try {
      c = new e(i, s);
    } catch {
      return null;
    }
    return n.forEach((h) => {
      c.test(h) && (!a || o.compare(h) === -1) && (a = h, o = new t(a, s));
    }), a;
  }, _o;
}
var vo, yf;
function ww() {
  if (yf) return vo;
  yf = 1;
  const t = ke(), e = er();
  return vo = (n, i, s) => {
    let a = null, o = null, c = null;
    try {
      c = new e(i, s);
    } catch {
      return null;
    }
    return n.forEach((h) => {
      c.test(h) && (!a || o.compare(h) === 1) && (a = h, o = new t(a, s));
    }), a;
  }, vo;
}
var Eo, gf;
function _w() {
  if (gf) return Eo;
  gf = 1;
  const t = ke(), e = er(), r = ga();
  return Eo = (i, s) => {
    i = new e(i, s);
    let a = new t("0.0.0");
    if (i.test(a) || (a = new t("0.0.0-0"), i.test(a)))
      return a;
    a = null;
    for (let o = 0; o < i.set.length; ++o) {
      const c = i.set[o];
      let h = null;
      c.forEach((f) => {
        const u = new t(f.semver.version);
        switch (f.operator) {
          case ">":
            u.prerelease.length === 0 ? u.patch++ : u.prerelease.push(0), u.raw = u.format();
          /* fallthrough */
          case "":
          case ">=":
            (!h || r(u, h)) && (h = u);
            break;
          case "<":
          case "<=":
            break;
          /* istanbul ignore next */
          default:
            throw new Error(`Unexpected operation: ${f.operator}`);
        }
      }), h && (!a || r(a, h)) && (a = h);
    }
    return a && i.test(a) ? a : null;
  }, Eo;
}
var bo, wf;
function vw() {
  if (wf) return bo;
  wf = 1;
  const t = er();
  return bo = (r, n) => {
    try {
      return new t(r, n).range || "*";
    } catch {
      return null;
    }
  }, bo;
}
var So, _f;
function $h() {
  if (_f) return So;
  _f = 1;
  const t = ke(), e = wa(), { ANY: r } = e, n = er(), i = _a(), s = ga(), a = Mh(), o = kh(), c = xh();
  return So = (f, u, l, d) => {
    f = new t(f, d), u = new n(u, d);
    let g, w, m, v, p;
    switch (l) {
      case ">":
        g = s, w = o, m = a, v = ">", p = ">=";
        break;
      case "<":
        g = a, w = c, m = s, v = "<", p = "<=";
        break;
      default:
        throw new TypeError('Must provide a hilo val of "<" or ">"');
    }
    if (i(f, u, d))
      return !1;
    for (let E = 0; E < u.set.length; ++E) {
      const _ = u.set[E];
      let y = null, b = null;
      if (_.forEach((S) => {
        S.semver === r && (S = new e(">=0.0.0")), y = y || S, b = b || S, g(S.semver, y.semver, d) ? y = S : m(S.semver, b.semver, d) && (b = S);
      }), y.operator === v || y.operator === p || (!b.operator || b.operator === v) && w(f, b.semver))
        return !1;
      if (b.operator === p && m(f, b.semver))
        return !1;
    }
    return !0;
  }, So;
}
var Mo, vf;
function Ew() {
  if (vf) return Mo;
  vf = 1;
  const t = $h();
  return Mo = (r, n, i) => t(r, n, ">", i), Mo;
}
var xo, Ef;
function bw() {
  if (Ef) return xo;
  Ef = 1;
  const t = $h();
  return xo = (r, n, i) => t(r, n, "<", i), xo;
}
var ko, bf;
function Sw() {
  if (bf) return ko;
  bf = 1;
  const t = er();
  return ko = (r, n, i) => (r = new t(r, i), n = new t(n, i), r.intersects(n, i)), ko;
}
var $o, Sf;
function Mw() {
  if (Sf) return $o;
  Sf = 1;
  const t = _a(), e = tr();
  return $o = (r, n, i) => {
    const s = [];
    let a = null, o = null;
    const c = r.sort((l, d) => e(l, d, i));
    for (const l of c)
      t(l, n, i) ? (o = l, a || (a = l)) : (o && s.push([a, o]), o = null, a = null);
    a && s.push([a, null]);
    const h = [];
    for (const [l, d] of s)
      l === d ? h.push(l) : !d && l === c[0] ? h.push("*") : d ? l === c[0] ? h.push(`<=${d}`) : h.push(`${l} - ${d}`) : h.push(`>=${l}`);
    const f = h.join(" || "), u = typeof n.raw == "string" ? n.raw : String(n);
    return f.length < u.length ? f : n;
  }, $o;
}
var Io, Mf;
function xw() {
  if (Mf) return Io;
  Mf = 1;
  const t = er(), e = wa(), { ANY: r } = e, n = _a(), i = tr(), s = (u, l, d = {}) => {
    if (u === l)
      return !0;
    u = new t(u, d), l = new t(l, d);
    let g = !1;
    t: for (const w of u.set) {
      for (const m of l.set) {
        const v = c(w, m, d);
        if (g = g || v !== null, v)
          continue t;
      }
      if (g)
        return !1;
    }
    return !0;
  }, a = [new e(">=0.0.0-0")], o = [new e(">=0.0.0")], c = (u, l, d) => {
    if (u === l)
      return !0;
    if (u.length === 1 && u[0].semver === r) {
      if (l.length === 1 && l[0].semver === r)
        return !0;
      d.includePrerelease ? u = a : u = o;
    }
    if (l.length === 1 && l[0].semver === r) {
      if (d.includePrerelease)
        return !0;
      l = o;
    }
    const g = /* @__PURE__ */ new Set();
    let w, m;
    for (const x of u)
      x.operator === ">" || x.operator === ">=" ? w = h(w, x, d) : x.operator === "<" || x.operator === "<=" ? m = f(m, x, d) : g.add(x.semver);
    if (g.size > 1)
      return null;
    let v;
    if (w && m) {
      if (v = i(w.semver, m.semver, d), v > 0)
        return null;
      if (v === 0 && (w.operator !== ">=" || m.operator !== "<="))
        return null;
    }
    for (const x of g) {
      if (w && !n(x, String(w), d) || m && !n(x, String(m), d))
        return null;
      for (const M of l)
        if (!n(x, String(M), d))
          return !1;
      return !0;
    }
    let p, E, _, y, b = m && !d.includePrerelease && m.semver.prerelease.length ? m.semver : !1, S = w && !d.includePrerelease && w.semver.prerelease.length ? w.semver : !1;
    b && b.prerelease.length === 1 && m.operator === "<" && b.prerelease[0] === 0 && (b = !1);
    for (const x of l) {
      if (y = y || x.operator === ">" || x.operator === ">=", _ = _ || x.operator === "<" || x.operator === "<=", w) {
        if (S && x.semver.prerelease && x.semver.prerelease.length && x.semver.major === S.major && x.semver.minor === S.minor && x.semver.patch === S.patch && (S = !1), x.operator === ">" || x.operator === ">=") {
          if (p = h(w, x, d), p === x && p !== w)
            return !1;
        } else if (w.operator === ">=" && !n(w.semver, String(x), d))
          return !1;
      }
      if (m) {
        if (b && x.semver.prerelease && x.semver.prerelease.length && x.semver.major === b.major && x.semver.minor === b.minor && x.semver.patch === b.patch && (b = !1), x.operator === "<" || x.operator === "<=") {
          if (E = f(m, x, d), E === x && E !== m)
            return !1;
        } else if (m.operator === "<=" && !n(m.semver, String(x), d))
          return !1;
      }
      if (!x.operator && (m || w) && v !== 0)
        return !1;
    }
    return !(w && _ && !m && v !== 0 || m && y && !w && v !== 0 || S || b);
  }, h = (u, l, d) => {
    if (!u)
      return l;
    const g = i(u.semver, l.semver, d);
    return g > 0 ? u : g < 0 || l.operator === ">" && u.operator === ">=" ? l : u;
  }, f = (u, l, d) => {
    if (!u)
      return l;
    const g = i(u.semver, l.semver, d);
    return g < 0 ? u : g > 0 || l.operator === "<" && u.operator === "<=" ? l : u;
  };
  return Io = s, Io;
}
var Po, xf;
function kw() {
  if (xf) return Po;
  xf = 1;
  const t = li(), e = pa(), r = ke(), n = Nm(), i = Nn(), s = rw(), a = nw(), o = iw(), c = sw(), h = aw(), f = ow(), u = cw(), l = hw(), d = tr(), g = lw(), w = uw(), m = Sh(), v = fw(), p = dw(), E = ga(), _ = Mh(), y = Om(), b = Rm(), S = xh(), x = kh(), M = Dm(), k = mw(), $ = wa(), O = er(), T = _a(), I = yw(), N = gw(), j = ww(), C = _w(), F = vw(), q = $h(), R = Ew(), D = bw(), G = Sw(), L = Mw(), A = xw();
  return Po = {
    parse: i,
    valid: s,
    clean: a,
    inc: o,
    diff: c,
    major: h,
    minor: f,
    patch: u,
    prerelease: l,
    compare: d,
    rcompare: g,
    compareLoose: w,
    compareBuild: m,
    sort: v,
    rsort: p,
    gt: E,
    lt: _,
    eq: y,
    neq: b,
    gte: S,
    lte: x,
    cmp: M,
    coerce: k,
    Comparator: $,
    Range: O,
    satisfies: T,
    toComparators: I,
    maxSatisfying: N,
    minSatisfying: j,
    minVersion: C,
    validRange: F,
    outside: q,
    gtr: R,
    ltr: D,
    intersects: G,
    simplifyRange: L,
    subset: A,
    SemVer: r,
    re: t.re,
    src: t.src,
    tokens: t.t,
    SEMVER_SPEC_VERSION: e.SEMVER_SPEC_VERSION,
    RELEASE_TYPES: e.RELEASE_TYPES,
    compareIdentifiers: n.compareIdentifiers,
    rcompareIdentifiers: n.rcompareIdentifiers
  }, Po;
}
var $w = kw();
const dn = /* @__PURE__ */ an($w), Iw = Object.prototype.toString, Pw = "[object Uint8Array]", Aw = "[object ArrayBuffer]";
function jm(t, e, r) {
  return t ? t.constructor === e ? !0 : Iw.call(t) === r : !1;
}
function Tm(t) {
  return jm(t, Uint8Array, Pw);
}
function Nw(t) {
  return jm(t, ArrayBuffer, Aw);
}
function Ow(t) {
  return Tm(t) || Nw(t);
}
function Rw(t) {
  if (!Tm(t))
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof t}\``);
}
function Dw(t) {
  if (!Ow(t))
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof t}\``);
}
function Ao(t, e) {
  if (t.length === 0)
    return new Uint8Array(0);
  e ??= t.reduce((i, s) => i + s.length, 0);
  const r = new Uint8Array(e);
  let n = 0;
  for (const i of t)
    Rw(i), r.set(i, n), n += i.length;
  return r;
}
const kf = {
  utf8: new globalThis.TextDecoder("utf8")
};
function Es(t, e = "utf8") {
  return Dw(t), kf[e] ??= new globalThis.TextDecoder(e), kf[e].decode(t);
}
function jw(t) {
  if (typeof t != "string")
    throw new TypeError(`Expected \`string\`, got \`${typeof t}\``);
}
const Tw = new globalThis.TextEncoder();
function No(t) {
  return jw(t), Tw.encode(t);
}
Array.from({ length: 256 }, (t, e) => e.toString(16).padStart(2, "0"));
const $f = "aes-256-cbc", Cm = /* @__PURE__ */ new Set([
  "aes-256-cbc",
  "aes-256-gcm",
  "aes-256-ctr"
]), Cw = (t) => typeof t == "string" && Cm.has(t), gr = () => /* @__PURE__ */ Object.create(null), If = (t) => t !== void 0, Oo = (t, e) => {
  const r = /* @__PURE__ */ new Set([
    "undefined",
    "symbol",
    "function"
  ]), n = typeof e;
  if (r.has(n))
    throw new TypeError(`Setting a value of type \`${n}\` for key \`${t}\` is not allowed as it's not supported by JSON`);
}, Rr = "__internal__", Ro = `${Rr}.migrations.version`;
class Lw {
  path;
  events;
  #n;
  #i;
  #s;
  #t;
  #e = {};
  #a = !1;
  #o;
  #c;
  #r;
  constructor(e = {}) {
    const r = this.#h(e);
    this.#t = r, this.#l(r), this.#f(r), this.#d(r), this.events = new EventTarget(), this.#i = r.encryptionKey, this.#s = r.encryptionAlgorithm ?? $f, this.path = this.#m(r), this.#p(r), r.watch && this._watch();
  }
  get(e, r) {
    if (this.#t.accessPropertiesByDotNotation)
      return this._get(e, r);
    const { store: n } = this;
    return e in n ? n[e] : r;
  }
  set(e, r) {
    if (typeof e != "string" && typeof e != "object")
      throw new TypeError(`Expected \`key\` to be of type \`string\` or \`object\`, got ${typeof e}`);
    if (typeof e != "object" && r === void 0)
      throw new TypeError("Use `delete()` to clear values");
    if (this._containsReservedKey(e))
      throw new TypeError(`Please don't use the ${Rr} key, as it's used to manage this module internal operations.`);
    const { store: n } = this, i = (s, a) => {
      if (Oo(s, a), this.#t.accessPropertiesByDotNotation)
        vi(n, s, a);
      else {
        if (s === "__proto__" || s === "constructor" || s === "prototype")
          return;
        n[s] = a;
      }
    };
    if (typeof e == "object") {
      const s = e;
      for (const [a, o] of Object.entries(s))
        i(a, o);
    } else
      i(e, r);
    this.store = n;
  }
  has(e) {
    return this.#t.accessPropertiesByDotNotation ? Ma(this.store, e) : e in this.store;
  }
  appendToArray(e, r) {
    Oo(e, r);
    const n = this.#t.accessPropertiesByDotNotation ? this._get(e, []) : e in this.store ? this.store[e] : [];
    if (!Array.isArray(n))
      throw new TypeError(`The key \`${e}\` is already set to a non-array value`);
    this.set(e, [...n, r]);
  }
  /**
      Reset items to their default values, as defined by the `defaults` or `schema` option.
  
      @see `clear()` to reset all items.
  
      @param keys - The keys of the items to reset.
      */
  reset(...e) {
    for (const r of e)
      If(this.#e[r]) && this.set(r, this.#e[r]);
  }
  delete(e) {
    const { store: r } = this;
    this.#t.accessPropertiesByDotNotation ? Qp(r, e) : delete r[e], this.store = r;
  }
  /**
      Delete all items.
  
      This resets known items to their default values, if defined by the `defaults` or `schema` option.
      */
  clear() {
    const e = gr();
    for (const r of Object.keys(this.#e))
      If(this.#e[r]) && (Oo(r, this.#e[r]), this.#t.accessPropertiesByDotNotation ? vi(e, r, this.#e[r]) : e[r] = this.#e[r]);
    this.store = e;
  }
  onDidChange(e, r) {
    if (typeof e != "string")
      throw new TypeError(`Expected \`key\` to be of type \`string\`, got ${typeof e}`);
    if (typeof r != "function")
      throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof r}`);
    return this._handleValueChange(() => this.get(e), r);
  }
  /**
      Watches the whole config object, calling `callback` on any changes.
  
      @param callback - A callback function that is called on any changes. When a `key` is first set `oldValue` will be `undefined`, and when a key is deleted `newValue` will be `undefined`.
      @returns A function, that when called, will unsubscribe.
      */
  onDidAnyChange(e) {
    if (typeof e != "function")
      throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof e}`);
    return this._handleStoreChange(e);
  }
  get size() {
    return Object.keys(this.store).filter((r) => !this._isReservedKeyPath(r)).length;
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
    try {
      const e = $t.readFileSync(this.path, this.#i ? null : "utf8"), r = this._decryptData(e);
      return ((i) => {
        const s = this._deserialize(i);
        return this.#a || this._validate(s), Object.assign(gr(), s);
      })(r);
    } catch (e) {
      if (e?.code === "ENOENT")
        return this._ensureDirectory(), gr();
      if (this.#t.clearInvalidConfig) {
        const r = e;
        if (r.name === "SyntaxError" || r.message?.startsWith("Config schema violation:") || r.message === "Failed to decrypt config data.")
          return gr();
      }
      throw e;
    }
  }
  set store(e) {
    if (this._ensureDirectory(), !Ma(e, Rr))
      try {
        const r = $t.readFileSync(this.path, this.#i ? null : "utf8"), n = this._decryptData(r), i = this._deserialize(n);
        Ma(i, Rr) && vi(e, Rr, Yh(i, Rr));
      } catch {
      }
    this.#a || this._validate(e), this._write(e), this.events.dispatchEvent(new Event("change"));
  }
  *[Symbol.iterator]() {
    for (const [e, r] of Object.entries(this.store))
      this._isReservedKeyPath(e) || (yield [e, r]);
  }
  /**
  Close the file watcher if one exists. This is useful in tests to prevent the process from hanging.
  */
  _closeWatcher() {
    this.#o && (this.#o.close(), this.#o = void 0), this.#c && ($t.unwatchFile(this.path), this.#c = !1), this.#r = void 0;
  }
  _decryptData(e) {
    const r = this.#i;
    if (!r)
      return typeof e == "string" ? e : Es(e);
    const n = this.#s, i = n === "aes-256-gcm" ? 16 : 0, s = ":".codePointAt(0), a = typeof e == "string" ? e.codePointAt(16) : e[16];
    if (!(s !== void 0 && a === s)) {
      if (n === "aes-256-cbc")
        return typeof e == "string" ? e : Es(e);
      throw new Error("Failed to decrypt config data.");
    }
    const c = (d) => {
      if (i === 0)
        return { ciphertext: d };
      const g = d.length - i;
      if (g < 0)
        throw new Error("Invalid authentication tag length.");
      return {
        ciphertext: d.slice(0, g),
        authenticationTag: d.slice(g)
      };
    }, h = e.slice(0, 16), f = e.slice(17), u = typeof f == "string" ? No(f) : f, l = (d) => {
      const { ciphertext: g, authenticationTag: w } = c(u), m = Tn.pbkdf2Sync(r, d, 1e4, 32, "sha512"), v = Tn.createDecipheriv(n, m, h);
      return w && v.setAuthTag(w), Es(Ao([v.update(g), v.final()]));
    };
    try {
      return l(h);
    } catch {
      try {
        return l(h.toString());
      } catch {
      }
    }
    if (n === "aes-256-cbc")
      return typeof e == "string" ? e : Es(e);
    throw new Error("Failed to decrypt config data.");
  }
  _handleStoreChange(e) {
    let r = this.store;
    const n = () => {
      const i = r, s = this.store;
      Wh(s, i) || (r = s, e.call(this, s, i));
    };
    return this.events.addEventListener("change", n), () => {
      this.events.removeEventListener("change", n);
    };
  }
  _handleValueChange(e, r) {
    let n = e();
    const i = () => {
      const s = n, a = e();
      Wh(a, s) || (n = a, r.call(this, a, s));
    };
    return this.events.addEventListener("change", i), () => {
      this.events.removeEventListener("change", i);
    };
  }
  _deserialize = (e) => JSON.parse(e);
  _serialize = (e) => JSON.stringify(e, void 0, "	");
  _validate(e) {
    if (!this.#n || this.#n(e) || !this.#n.errors)
      return;
    const n = this.#n.errors.map(({ instancePath: i, message: s = "" }) => `\`${i.slice(1)}\` ${s}`);
    throw new Error("Config schema violation: " + n.join("; "));
  }
  _ensureDirectory() {
    $t.mkdirSync(At.dirname(this.path), { recursive: !0 });
  }
  _write(e) {
    let r = this._serialize(e);
    const n = this.#i;
    if (n) {
      const i = Tn.randomBytes(16), s = Tn.pbkdf2Sync(n, i, 1e4, 32, "sha512"), a = Tn.createCipheriv(this.#s, s, i), o = Ao([a.update(No(r)), a.final()]), c = [i, No(":"), o];
      this.#s === "aes-256-gcm" && c.push(a.getAuthTag()), r = Ao(c);
    }
    if (Xt.env.SNAP)
      $t.writeFileSync(this.path, r, { mode: this.#t.configFileMode });
    else
      try {
        mm(this.path, r, { mode: this.#t.configFileMode });
      } catch (i) {
        if (i?.code === "EXDEV") {
          $t.writeFileSync(this.path, r, { mode: this.#t.configFileMode });
          return;
        }
        throw i;
      }
  }
  _watch() {
    if (this._ensureDirectory(), $t.existsSync(this.path) || this._write(gr()), Xt.platform === "win32" || Xt.platform === "darwin") {
      this.#r ??= Ru(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 100 });
      const e = At.dirname(this.path), r = At.basename(this.path);
      this.#o = $t.watch(e, { persistent: !1, encoding: "utf8" }, (n, i) => {
        i && i !== r || typeof this.#r == "function" && this.#r();
      });
    } else
      this.#r ??= Ru(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 1e3 }), $t.watchFile(this.path, { persistent: !1 }, (e, r) => {
        typeof this.#r == "function" && this.#r();
      }), this.#c = !0;
  }
  _migrate(e, r, n) {
    let i = this._get(Ro, "0.0.0");
    const s = Object.keys(e).filter((o) => this._shouldPerformMigration(o, i, r));
    let a = structuredClone(this.store);
    for (const o of s)
      try {
        n && n(this, {
          fromVersion: i,
          toVersion: o,
          finalVersion: r,
          versions: s
        });
        const c = e[o];
        c?.(this), this._set(Ro, o), i = o, a = structuredClone(this.store);
      } catch (c) {
        this.store = a;
        const h = c instanceof Error ? c.message : String(c);
        throw new Error(`Something went wrong during the migration! Changes applied to the store until this failed migration will be restored. ${h}`);
      }
    (this._isVersionInRangeFormat(i) || !dn.eq(i, r)) && this._set(Ro, r);
  }
  _containsReservedKey(e) {
    return typeof e == "string" ? this._isReservedKeyPath(e) : !e || typeof e != "object" ? !1 : this._objectContainsReservedKey(e);
  }
  _objectContainsReservedKey(e) {
    if (!e || typeof e != "object")
      return !1;
    for (const [r, n] of Object.entries(e))
      if (this._isReservedKeyPath(r) || this._objectContainsReservedKey(n))
        return !0;
    return !1;
  }
  _isReservedKeyPath(e) {
    return e === Rr || e.startsWith(`${Rr}.`);
  }
  _isVersionInRangeFormat(e) {
    return dn.clean(e) === null;
  }
  _shouldPerformMigration(e, r, n) {
    return this._isVersionInRangeFormat(e) ? r !== "0.0.0" && dn.satisfies(r, e) ? !1 : dn.satisfies(n, e) : !(dn.lte(e, r) || dn.gt(e, n));
  }
  _get(e, r) {
    return Yh(this.store, e, r);
  }
  _set(e, r) {
    const { store: n } = this;
    vi(n, e, r), this.store = n;
  }
  #h(e) {
    const r = {
      configName: "config",
      fileExtension: "json",
      projectSuffix: "nodejs",
      clearInvalidConfig: !1,
      accessPropertiesByDotNotation: !0,
      configFileMode: 438,
      ...e
    };
    if (r.encryptionAlgorithm ??= $f, !Cw(r.encryptionAlgorithm))
      throw new TypeError(`The \`encryptionAlgorithm\` option must be one of: ${[...Cm].join(", ")}`);
    if (!r.cwd) {
      if (!r.projectName)
        throw new Error("Please specify the `projectName` option.");
      r.cwd = n1(r.projectName, { suffix: r.projectSuffix }).config;
    }
    return typeof r.fileExtension == "string" && (r.fileExtension = r.fileExtension.replace(/^\.+/, "")), r;
  }
  #l(e) {
    if (!(e.schema ?? e.ajvOptions ?? e.rootSchema))
      return;
    if (e.schema && typeof e.schema != "object")
      throw new TypeError("The `schema` option must be an object.");
    const r = Hg.default, n = new Rg.Ajv2020({
      allErrors: !0,
      useDefaults: !0,
      ...e.ajvOptions
    });
    r(n);
    const i = {
      ...e.rootSchema,
      type: "object",
      properties: e.schema
    };
    this.#n = n.compile(i), this.#u(e.schema);
  }
  #u(e) {
    const r = Object.entries(e ?? {});
    for (const [n, i] of r) {
      if (!i || typeof i != "object" || !Object.hasOwn(i, "default"))
        continue;
      const { default: s } = i;
      s !== void 0 && (this.#e[n] = s);
    }
  }
  #f(e) {
    e.defaults && Object.assign(this.#e, e.defaults);
  }
  #d(e) {
    e.serialize && (this._serialize = e.serialize), e.deserialize && (this._deserialize = e.deserialize);
  }
  #m(e) {
    const r = typeof e.fileExtension == "string" ? e.fileExtension : void 0, n = r ? `.${r}` : "";
    return At.resolve(e.cwd, `${e.configName ?? "config"}${n}`);
  }
  #p(e) {
    if (e.migrations) {
      this.#y(e), this._validate(this.store);
      return;
    }
    const r = this.store, n = Object.assign(gr(), e.defaults ?? {}, r);
    this._validate(n);
    try {
      Jh.deepEqual(r, n);
    } catch {
      this.store = n;
    }
  }
  #y(e) {
    const { migrations: r, projectVersion: n } = e;
    if (r) {
      if (!n)
        throw new Error("Please specify the `projectVersion` option.");
      this.#a = !0;
      try {
        const i = this.store, s = Object.assign(gr(), e.defaults ?? {}, i);
        try {
          Jh.deepEqual(i, s);
        } catch {
          this._write(s);
        }
        this._migrate(r, n, e.beforeEachMigration);
      } finally {
        this.#a = !1;
      }
    }
  }
}
const { app: Bs, ipcMain: nh, shell: Fw } = am;
let Pf = !1;
const Af = () => {
  if (!nh || !Bs)
    throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
  const t = {
    defaultCwd: Bs.getPath("userData"),
    appVersion: Bs.getVersion()
  };
  return Pf || (nh.on("electron-store-get-data", (e) => {
    e.returnValue = t;
  }), Pf = !0), t;
};
class Gw extends Lw {
  constructor(e) {
    let r, n;
    if (Xt.type === "renderer") {
      const i = am.ipcRenderer.sendSync("electron-store-get-data");
      if (!i)
        throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
      ({ defaultCwd: r, appVersion: n } = i);
    } else nh && Bs && ({ defaultCwd: r, appVersion: n } = Af());
    e = {
      name: "config",
      ...e
    }, e.projectVersion ||= n, e.cwd ? e.cwd = At.isAbsolute(e.cwd) ? e.cwd : At.join(r, e.cwd) : e.cwd = r, e.configName = e.name, delete e.name, super(e);
  }
  static initRenderer() {
    Af();
  }
  async openInEditor() {
    const e = await Fw.openPath(this.path);
    if (e)
      throw new Error(e);
  }
}
var Do = {}, bs = {}, Nf;
function he() {
  return Nf || (Nf = 1, bs.fromCallback = function(t) {
    return Object.defineProperty(function(...e) {
      if (typeof e[e.length - 1] == "function") t.apply(this, e);
      else
        return new Promise((r, n) => {
          e.push((i, s) => i != null ? n(i) : r(s)), t.apply(this, e);
        });
    }, "name", { value: t.name });
  }, bs.fromPromise = function(t) {
    return Object.defineProperty(function(...e) {
      const r = e[e.length - 1];
      if (typeof r != "function") return t.apply(this, e);
      e.pop(), t.apply(this, e).then((n) => r(null, n), r);
    }, "name", { value: t.name });
  }), bs;
}
var jo, Of;
function zw() {
  if (Of) return jo;
  Of = 1;
  var t = Zp, e = process.cwd, r = null, n = process.env.GRACEFUL_FS_PLATFORM || process.platform;
  process.cwd = function() {
    return r || (r = e.call(process)), r;
  };
  try {
    process.cwd();
  } catch {
  }
  if (typeof process.chdir == "function") {
    var i = process.chdir;
    process.chdir = function(a) {
      r = null, i.call(process, a);
    }, Object.setPrototypeOf && Object.setPrototypeOf(process.chdir, i);
  }
  jo = s;
  function s(a) {
    t.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./) && o(a), a.lutimes || c(a), a.chown = u(a.chown), a.fchown = u(a.fchown), a.lchown = u(a.lchown), a.chmod = h(a.chmod), a.fchmod = h(a.fchmod), a.lchmod = h(a.lchmod), a.chownSync = l(a.chownSync), a.fchownSync = l(a.fchownSync), a.lchownSync = l(a.lchownSync), a.chmodSync = f(a.chmodSync), a.fchmodSync = f(a.fchmodSync), a.lchmodSync = f(a.lchmodSync), a.stat = d(a.stat), a.fstat = d(a.fstat), a.lstat = d(a.lstat), a.statSync = g(a.statSync), a.fstatSync = g(a.fstatSync), a.lstatSync = g(a.lstatSync), a.chmod && !a.lchmod && (a.lchmod = function(m, v, p) {
      p && process.nextTick(p);
    }, a.lchmodSync = function() {
    }), a.chown && !a.lchown && (a.lchown = function(m, v, p, E) {
      E && process.nextTick(E);
    }, a.lchownSync = function() {
    }), n === "win32" && (a.rename = typeof a.rename != "function" ? a.rename : (function(m) {
      function v(p, E, _) {
        var y = Date.now(), b = 0;
        m(p, E, function S(x) {
          if (x && (x.code === "EACCES" || x.code === "EPERM" || x.code === "EBUSY") && Date.now() - y < 6e4) {
            setTimeout(function() {
              a.stat(E, function(M, k) {
                M && M.code === "ENOENT" ? m(p, E, S) : _(x);
              });
            }, b), b < 100 && (b += 10);
            return;
          }
          _ && _(x);
        });
      }
      return Object.setPrototypeOf && Object.setPrototypeOf(v, m), v;
    })(a.rename)), a.read = typeof a.read != "function" ? a.read : (function(m) {
      function v(p, E, _, y, b, S) {
        var x;
        if (S && typeof S == "function") {
          var M = 0;
          x = function(k, $, O) {
            if (k && k.code === "EAGAIN" && M < 10)
              return M++, m.call(a, p, E, _, y, b, x);
            S.apply(this, arguments);
          };
        }
        return m.call(a, p, E, _, y, b, x);
      }
      return Object.setPrototypeOf && Object.setPrototypeOf(v, m), v;
    })(a.read), a.readSync = typeof a.readSync != "function" ? a.readSync : /* @__PURE__ */ (function(m) {
      return function(v, p, E, _, y) {
        for (var b = 0; ; )
          try {
            return m.call(a, v, p, E, _, y);
          } catch (S) {
            if (S.code === "EAGAIN" && b < 10) {
              b++;
              continue;
            }
            throw S;
          }
      };
    })(a.readSync);
    function o(m) {
      m.lchmod = function(v, p, E) {
        m.open(
          v,
          t.O_WRONLY | t.O_SYMLINK,
          p,
          function(_, y) {
            if (_) {
              E && E(_);
              return;
            }
            m.fchmod(y, p, function(b) {
              m.close(y, function(S) {
                E && E(b || S);
              });
            });
          }
        );
      }, m.lchmodSync = function(v, p) {
        var E = m.openSync(v, t.O_WRONLY | t.O_SYMLINK, p), _ = !0, y;
        try {
          y = m.fchmodSync(E, p), _ = !1;
        } finally {
          if (_)
            try {
              m.closeSync(E);
            } catch {
            }
          else
            m.closeSync(E);
        }
        return y;
      };
    }
    function c(m) {
      t.hasOwnProperty("O_SYMLINK") && m.futimes ? (m.lutimes = function(v, p, E, _) {
        m.open(v, t.O_SYMLINK, function(y, b) {
          if (y) {
            _ && _(y);
            return;
          }
          m.futimes(b, p, E, function(S) {
            m.close(b, function(x) {
              _ && _(S || x);
            });
          });
        });
      }, m.lutimesSync = function(v, p, E) {
        var _ = m.openSync(v, t.O_SYMLINK), y, b = !0;
        try {
          y = m.futimesSync(_, p, E), b = !1;
        } finally {
          if (b)
            try {
              m.closeSync(_);
            } catch {
            }
          else
            m.closeSync(_);
        }
        return y;
      }) : m.futimes && (m.lutimes = function(v, p, E, _) {
        _ && process.nextTick(_);
      }, m.lutimesSync = function() {
      });
    }
    function h(m) {
      return m && function(v, p, E) {
        return m.call(a, v, p, function(_) {
          w(_) && (_ = null), E && E.apply(this, arguments);
        });
      };
    }
    function f(m) {
      return m && function(v, p) {
        try {
          return m.call(a, v, p);
        } catch (E) {
          if (!w(E)) throw E;
        }
      };
    }
    function u(m) {
      return m && function(v, p, E, _) {
        return m.call(a, v, p, E, function(y) {
          w(y) && (y = null), _ && _.apply(this, arguments);
        });
      };
    }
    function l(m) {
      return m && function(v, p, E) {
        try {
          return m.call(a, v, p, E);
        } catch (_) {
          if (!w(_)) throw _;
        }
      };
    }
    function d(m) {
      return m && function(v, p, E) {
        typeof p == "function" && (E = p, p = null);
        function _(y, b) {
          b && (b.uid < 0 && (b.uid += 4294967296), b.gid < 0 && (b.gid += 4294967296)), E && E.apply(this, arguments);
        }
        return p ? m.call(a, v, p, _) : m.call(a, v, _);
      };
    }
    function g(m) {
      return m && function(v, p) {
        var E = p ? m.call(a, v, p) : m.call(a, v);
        return E && (E.uid < 0 && (E.uid += 4294967296), E.gid < 0 && (E.gid += 4294967296)), E;
      };
    }
    function w(m) {
      if (!m || m.code === "ENOSYS")
        return !0;
      var v = !process.getuid || process.getuid() !== 0;
      return !!(v && (m.code === "EINVAL" || m.code === "EPERM"));
    }
  }
  return jo;
}
var To, Rf;
function qw() {
  if (Rf) return To;
  Rf = 1;
  var t = ca.Stream;
  To = e;
  function e(r) {
    return {
      ReadStream: n,
      WriteStream: i
    };
    function n(s, a) {
      if (!(this instanceof n)) return new n(s, a);
      t.call(this);
      var o = this;
      this.path = s, this.fd = null, this.readable = !0, this.paused = !1, this.flags = "r", this.mode = 438, this.bufferSize = 64 * 1024, a = a || {};
      for (var c = Object.keys(a), h = 0, f = c.length; h < f; h++) {
        var u = c[h];
        this[u] = a[u];
      }
      if (this.encoding && this.setEncoding(this.encoding), this.start !== void 0) {
        if (typeof this.start != "number")
          throw TypeError("start must be a Number");
        if (this.end === void 0)
          this.end = 1 / 0;
        else if (typeof this.end != "number")
          throw TypeError("end must be a Number");
        if (this.start > this.end)
          throw new Error("start must be <= end");
        this.pos = this.start;
      }
      if (this.fd !== null) {
        process.nextTick(function() {
          o._read();
        });
        return;
      }
      r.open(this.path, this.flags, this.mode, function(l, d) {
        if (l) {
          o.emit("error", l), o.readable = !1;
          return;
        }
        o.fd = d, o.emit("open", d), o._read();
      });
    }
    function i(s, a) {
      if (!(this instanceof i)) return new i(s, a);
      t.call(this), this.path = s, this.fd = null, this.writable = !0, this.flags = "w", this.encoding = "binary", this.mode = 438, this.bytesWritten = 0, a = a || {};
      for (var o = Object.keys(a), c = 0, h = o.length; c < h; c++) {
        var f = o[c];
        this[f] = a[f];
      }
      if (this.start !== void 0) {
        if (typeof this.start != "number")
          throw TypeError("start must be a Number");
        if (this.start < 0)
          throw new Error("start must be >= zero");
        this.pos = this.start;
      }
      this.busy = !1, this._queue = [], this.fd === null && (this._open = r.open, this._queue.push([this._open, this.path, this.flags, this.mode, void 0]), this.flush());
    }
  }
  return To;
}
var Co, Df;
function Uw() {
  if (Df) return Co;
  Df = 1, Co = e;
  var t = Object.getPrototypeOf || function(r) {
    return r.__proto__;
  };
  function e(r) {
    if (r === null || typeof r != "object")
      return r;
    if (r instanceof Object)
      var n = { __proto__: t(r) };
    else
      var n = /* @__PURE__ */ Object.create(null);
    return Object.getOwnPropertyNames(r).forEach(function(i) {
      Object.defineProperty(n, i, Object.getOwnPropertyDescriptor(r, i));
    }), n;
  }
  return Co;
}
var Ss, jf;
function ui() {
  if (jf) return Ss;
  jf = 1;
  var t = Gr, e = zw(), r = qw(), n = Uw(), i = ha, s, a;
  typeof Symbol == "function" && typeof Symbol.for == "function" ? (s = /* @__PURE__ */ Symbol.for("graceful-fs.queue"), a = /* @__PURE__ */ Symbol.for("graceful-fs.previous")) : (s = "___graceful-fs.queue", a = "___graceful-fs.previous");
  function o() {
  }
  function c(m, v) {
    Object.defineProperty(m, s, {
      get: function() {
        return v;
      }
    });
  }
  var h = o;
  if (i.debuglog ? h = i.debuglog("gfs4") : /\bgfs4\b/i.test(process.env.NODE_DEBUG || "") && (h = function() {
    var m = i.format.apply(i, arguments);
    m = "GFS4: " + m.split(/\n/).join(`
GFS4: `), console.error(m);
  }), !t[s]) {
    var f = ka[s] || [];
    c(t, f), t.close = (function(m) {
      function v(p, E) {
        return m.call(t, p, function(_) {
          _ || g(), typeof E == "function" && E.apply(this, arguments);
        });
      }
      return Object.defineProperty(v, a, {
        value: m
      }), v;
    })(t.close), t.closeSync = (function(m) {
      function v(p) {
        m.apply(t, arguments), g();
      }
      return Object.defineProperty(v, a, {
        value: m
      }), v;
    })(t.closeSync), /\bgfs4\b/i.test(process.env.NODE_DEBUG || "") && process.on("exit", function() {
      h(t[s]), Vp.equal(t[s].length, 0);
    });
  }
  ka[s] || c(ka, t[s]), Ss = u(n(t)), process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !t.__patched && (Ss = u(t), t.__patched = !0);
  function u(m) {
    e(m), m.gracefulify = u, m.createReadStream = D, m.createWriteStream = G;
    var v = m.readFile;
    m.readFile = p;
    function p(P, U, K) {
      return typeof U == "function" && (K = U, U = null), J(P, U, K);
      function J(et, rt, z, B) {
        return v(et, rt, function(X) {
          X && (X.code === "EMFILE" || X.code === "ENFILE") ? l([J, [et, rt, z], X, B || Date.now(), Date.now()]) : typeof z == "function" && z.apply(this, arguments);
        });
      }
    }
    var E = m.writeFile;
    m.writeFile = _;
    function _(P, U, K, J) {
      return typeof K == "function" && (J = K, K = null), et(P, U, K, J);
      function et(rt, z, B, X, Y) {
        return E(rt, z, B, function(nt) {
          nt && (nt.code === "EMFILE" || nt.code === "ENFILE") ? l([et, [rt, z, B, X], nt, Y || Date.now(), Date.now()]) : typeof X == "function" && X.apply(this, arguments);
        });
      }
    }
    var y = m.appendFile;
    y && (m.appendFile = b);
    function b(P, U, K, J) {
      return typeof K == "function" && (J = K, K = null), et(P, U, K, J);
      function et(rt, z, B, X, Y) {
        return y(rt, z, B, function(nt) {
          nt && (nt.code === "EMFILE" || nt.code === "ENFILE") ? l([et, [rt, z, B, X], nt, Y || Date.now(), Date.now()]) : typeof X == "function" && X.apply(this, arguments);
        });
      }
    }
    var S = m.copyFile;
    S && (m.copyFile = x);
    function x(P, U, K, J) {
      return typeof K == "function" && (J = K, K = 0), et(P, U, K, J);
      function et(rt, z, B, X, Y) {
        return S(rt, z, B, function(nt) {
          nt && (nt.code === "EMFILE" || nt.code === "ENFILE") ? l([et, [rt, z, B, X], nt, Y || Date.now(), Date.now()]) : typeof X == "function" && X.apply(this, arguments);
        });
      }
    }
    var M = m.readdir;
    m.readdir = $;
    var k = /^v[0-5]\./;
    function $(P, U, K) {
      typeof U == "function" && (K = U, U = null);
      var J = k.test(process.version) ? function(z, B, X, Y) {
        return M(z, et(
          z,
          B,
          X,
          Y
        ));
      } : function(z, B, X, Y) {
        return M(z, B, et(
          z,
          B,
          X,
          Y
        ));
      };
      return J(P, U, K);
      function et(rt, z, B, X) {
        return function(Y, nt) {
          Y && (Y.code === "EMFILE" || Y.code === "ENFILE") ? l([
            J,
            [rt, z, B],
            Y,
            X || Date.now(),
            Date.now()
          ]) : (nt && nt.sort && nt.sort(), typeof B == "function" && B.call(this, Y, nt));
        };
      }
    }
    if (process.version.substr(0, 4) === "v0.8") {
      var O = r(m);
      C = O.ReadStream, q = O.WriteStream;
    }
    var T = m.ReadStream;
    T && (C.prototype = Object.create(T.prototype), C.prototype.open = F);
    var I = m.WriteStream;
    I && (q.prototype = Object.create(I.prototype), q.prototype.open = R), Object.defineProperty(m, "ReadStream", {
      get: function() {
        return C;
      },
      set: function(P) {
        C = P;
      },
      enumerable: !0,
      configurable: !0
    }), Object.defineProperty(m, "WriteStream", {
      get: function() {
        return q;
      },
      set: function(P) {
        q = P;
      },
      enumerable: !0,
      configurable: !0
    });
    var N = C;
    Object.defineProperty(m, "FileReadStream", {
      get: function() {
        return N;
      },
      set: function(P) {
        N = P;
      },
      enumerable: !0,
      configurable: !0
    });
    var j = q;
    Object.defineProperty(m, "FileWriteStream", {
      get: function() {
        return j;
      },
      set: function(P) {
        j = P;
      },
      enumerable: !0,
      configurable: !0
    });
    function C(P, U) {
      return this instanceof C ? (T.apply(this, arguments), this) : C.apply(Object.create(C.prototype), arguments);
    }
    function F() {
      var P = this;
      A(P.path, P.flags, P.mode, function(U, K) {
        U ? (P.autoClose && P.destroy(), P.emit("error", U)) : (P.fd = K, P.emit("open", K), P.read());
      });
    }
    function q(P, U) {
      return this instanceof q ? (I.apply(this, arguments), this) : q.apply(Object.create(q.prototype), arguments);
    }
    function R() {
      var P = this;
      A(P.path, P.flags, P.mode, function(U, K) {
        U ? (P.destroy(), P.emit("error", U)) : (P.fd = K, P.emit("open", K));
      });
    }
    function D(P, U) {
      return new m.ReadStream(P, U);
    }
    function G(P, U) {
      return new m.WriteStream(P, U);
    }
    var L = m.open;
    m.open = A;
    function A(P, U, K, J) {
      return typeof K == "function" && (J = K, K = null), et(P, U, K, J);
      function et(rt, z, B, X, Y) {
        return L(rt, z, B, function(nt, vt) {
          nt && (nt.code === "EMFILE" || nt.code === "ENFILE") ? l([et, [rt, z, B, X], nt, Y || Date.now(), Date.now()]) : typeof X == "function" && X.apply(this, arguments);
        });
      }
    }
    return m;
  }
  function l(m) {
    h("ENQUEUE", m[0].name, m[1]), t[s].push(m), w();
  }
  var d;
  function g() {
    for (var m = Date.now(), v = 0; v < t[s].length; ++v)
      t[s][v].length > 2 && (t[s][v][3] = m, t[s][v][4] = m);
    w();
  }
  function w() {
    if (clearTimeout(d), d = void 0, t[s].length !== 0) {
      var m = t[s].shift(), v = m[0], p = m[1], E = m[2], _ = m[3], y = m[4];
      if (_ === void 0)
        h("RETRY", v.name, p), v.apply(null, p);
      else if (Date.now() - _ >= 6e4) {
        h("TIMEOUT", v.name, p);
        var b = p.pop();
        typeof b == "function" && b.call(null, E);
      } else {
        var S = Date.now() - y, x = Math.max(y - _, 1), M = Math.min(x * 1.2, 100);
        S >= M ? (h("RETRY", v.name, p), v.apply(null, p.concat([_]))) : t[s].push(m);
      }
      d === void 0 && (d = setTimeout(w, 0));
    }
  }
  return Ss;
}
var Tf;
function Oe() {
  return Tf || (Tf = 1, (function(t) {
    const e = he().fromCallback, r = ui(), n = [
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
    ].filter((i) => typeof r[i] == "function");
    Object.assign(t, r), n.forEach((i) => {
      t[i] = e(r[i]);
    }), t.exists = function(i, s) {
      return typeof s == "function" ? r.exists(i, s) : new Promise((a) => r.exists(i, a));
    }, t.read = function(i, s, a, o, c, h) {
      return typeof h == "function" ? r.read(i, s, a, o, c, h) : new Promise((f, u) => {
        r.read(i, s, a, o, c, (l, d, g) => {
          if (l) return u(l);
          f({ bytesRead: d, buffer: g });
        });
      });
    }, t.write = function(i, s, ...a) {
      return typeof a[a.length - 1] == "function" ? r.write(i, s, ...a) : new Promise((o, c) => {
        r.write(i, s, ...a, (h, f, u) => {
          if (h) return c(h);
          o({ bytesWritten: f, buffer: u });
        });
      });
    }, t.readv = function(i, s, ...a) {
      return typeof a[a.length - 1] == "function" ? r.readv(i, s, ...a) : new Promise((o, c) => {
        r.readv(i, s, ...a, (h, f, u) => {
          if (h) return c(h);
          o({ bytesRead: f, buffers: u });
        });
      });
    }, t.writev = function(i, s, ...a) {
      return typeof a[a.length - 1] == "function" ? r.writev(i, s, ...a) : new Promise((o, c) => {
        r.writev(i, s, ...a, (h, f, u) => {
          if (h) return c(h);
          o({ bytesWritten: f, buffers: u });
        });
      });
    }, typeof r.realpath.native == "function" ? t.realpath.native = e(r.realpath.native) : process.emitWarning(
      "fs.realpath.native is not a function. Is fs being monkey-patched?",
      "Warning",
      "fs-extra-WARN0003"
    );
  })(Do)), Do;
}
var Ms = {}, Lo = {}, Cf;
function Bw() {
  if (Cf) return Lo;
  Cf = 1;
  const t = lt;
  return Lo.checkPath = function(r) {
    if (process.platform === "win32" && /[<>:"|?*]/.test(r.replace(t.parse(r).root, ""))) {
      const i = new Error(`Path contains invalid characters: ${r}`);
      throw i.code = "EINVAL", i;
    }
  }, Lo;
}
var Lf;
function Zw() {
  if (Lf) return Ms;
  Lf = 1;
  const t = /* @__PURE__ */ Oe(), { checkPath: e } = /* @__PURE__ */ Bw(), r = (n) => {
    const i = { mode: 511 };
    return typeof n == "number" ? n : { ...i, ...n }.mode;
  };
  return Ms.makeDir = async (n, i) => (e(n), t.mkdir(n, {
    mode: r(i),
    recursive: !0
  })), Ms.makeDirSync = (n, i) => (e(n), t.mkdirSync(n, {
    mode: r(i),
    recursive: !0
  })), Ms;
}
var Fo, Ff;
function ur() {
  if (Ff) return Fo;
  Ff = 1;
  const t = he().fromPromise, { makeDir: e, makeDirSync: r } = /* @__PURE__ */ Zw(), n = t(e);
  return Fo = {
    mkdirs: n,
    mkdirsSync: r,
    // alias
    mkdirp: n,
    mkdirpSync: r,
    ensureDir: n,
    ensureDirSync: r
  }, Fo;
}
var Go, Gf;
function on() {
  if (Gf) return Go;
  Gf = 1;
  const t = he().fromPromise, e = /* @__PURE__ */ Oe();
  function r(n) {
    return e.access(n).then(() => !0).catch(() => !1);
  }
  return Go = {
    pathExists: t(r),
    pathExistsSync: e.existsSync
  }, Go;
}
var zo, zf;
function Lm() {
  if (zf) return zo;
  zf = 1;
  const t = /* @__PURE__ */ Oe(), e = he().fromPromise;
  async function r(i, s, a) {
    const o = await t.open(i, "r+");
    let c = null;
    try {
      await t.futimes(o, s, a);
    } finally {
      try {
        await t.close(o);
      } catch (h) {
        c = h;
      }
    }
    if (c)
      throw c;
  }
  function n(i, s, a) {
    const o = t.openSync(i, "r+");
    return t.futimesSync(o, s, a), t.closeSync(o);
  }
  return zo = {
    utimesMillis: e(r),
    utimesMillisSync: n
  }, zo;
}
var qo, qf;
function On() {
  if (qf) return qo;
  qf = 1;
  const t = /* @__PURE__ */ Oe(), e = lt, r = he().fromPromise;
  function n(l, d, g) {
    const w = g.dereference ? (m) => t.stat(m, { bigint: !0 }) : (m) => t.lstat(m, { bigint: !0 });
    return Promise.all([
      w(l),
      w(d).catch((m) => {
        if (m.code === "ENOENT") return null;
        throw m;
      })
    ]).then(([m, v]) => ({ srcStat: m, destStat: v }));
  }
  function i(l, d, g) {
    let w;
    const m = g.dereference ? (p) => t.statSync(p, { bigint: !0 }) : (p) => t.lstatSync(p, { bigint: !0 }), v = m(l);
    try {
      w = m(d);
    } catch (p) {
      if (p.code === "ENOENT") return { srcStat: v, destStat: null };
      throw p;
    }
    return { srcStat: v, destStat: w };
  }
  async function s(l, d, g, w) {
    const { srcStat: m, destStat: v } = await n(l, d, w);
    if (v) {
      if (h(m, v)) {
        const p = e.basename(l), E = e.basename(d);
        if (g === "move" && p !== E && p.toLowerCase() === E.toLowerCase())
          return { srcStat: m, destStat: v, isChangingCase: !0 };
        throw new Error("Source and destination must not be the same.");
      }
      if (m.isDirectory() && !v.isDirectory())
        throw new Error(`Cannot overwrite non-directory '${d}' with directory '${l}'.`);
      if (!m.isDirectory() && v.isDirectory())
        throw new Error(`Cannot overwrite directory '${d}' with non-directory '${l}'.`);
    }
    if (m.isDirectory() && f(l, d))
      throw new Error(u(l, d, g));
    return { srcStat: m, destStat: v };
  }
  function a(l, d, g, w) {
    const { srcStat: m, destStat: v } = i(l, d, w);
    if (v) {
      if (h(m, v)) {
        const p = e.basename(l), E = e.basename(d);
        if (g === "move" && p !== E && p.toLowerCase() === E.toLowerCase())
          return { srcStat: m, destStat: v, isChangingCase: !0 };
        throw new Error("Source and destination must not be the same.");
      }
      if (m.isDirectory() && !v.isDirectory())
        throw new Error(`Cannot overwrite non-directory '${d}' with directory '${l}'.`);
      if (!m.isDirectory() && v.isDirectory())
        throw new Error(`Cannot overwrite directory '${d}' with non-directory '${l}'.`);
    }
    if (m.isDirectory() && f(l, d))
      throw new Error(u(l, d, g));
    return { srcStat: m, destStat: v };
  }
  async function o(l, d, g, w) {
    const m = e.resolve(e.dirname(l)), v = e.resolve(e.dirname(g));
    if (v === m || v === e.parse(v).root) return;
    let p;
    try {
      p = await t.stat(v, { bigint: !0 });
    } catch (E) {
      if (E.code === "ENOENT") return;
      throw E;
    }
    if (h(d, p))
      throw new Error(u(l, g, w));
    return o(l, d, v, w);
  }
  function c(l, d, g, w) {
    const m = e.resolve(e.dirname(l)), v = e.resolve(e.dirname(g));
    if (v === m || v === e.parse(v).root) return;
    let p;
    try {
      p = t.statSync(v, { bigint: !0 });
    } catch (E) {
      if (E.code === "ENOENT") return;
      throw E;
    }
    if (h(d, p))
      throw new Error(u(l, g, w));
    return c(l, d, v, w);
  }
  function h(l, d) {
    return d.ino !== void 0 && d.dev !== void 0 && d.ino === l.ino && d.dev === l.dev;
  }
  function f(l, d) {
    const g = e.resolve(l).split(e.sep).filter((m) => m), w = e.resolve(d).split(e.sep).filter((m) => m);
    return g.every((m, v) => w[v] === m);
  }
  function u(l, d, g) {
    return `Cannot ${g} '${l}' to a subdirectory of itself, '${d}'.`;
  }
  return qo = {
    // checkPaths
    checkPaths: r(s),
    checkPathsSync: a,
    // checkParent
    checkParentPaths: r(o),
    checkParentPathsSync: c,
    // Misc
    isSrcSubdir: f,
    areIdentical: h
  }, qo;
}
var Uo, Uf;
function Vw() {
  if (Uf) return Uo;
  Uf = 1;
  async function t(e, r) {
    const n = [];
    for await (const i of e)
      n.push(
        r(i).then(
          () => null,
          (s) => s ?? new Error("unknown error")
        )
      );
    await Promise.all(
      n.map(
        (i) => i.then((s) => {
          if (s !== null) throw s;
        })
      )
    );
  }
  return Uo = {
    asyncIteratorConcurrentProcess: t
  }, Uo;
}
var Bo, Bf;
function Hw() {
  if (Bf) return Bo;
  Bf = 1;
  const t = /* @__PURE__ */ Oe(), e = lt, { mkdirs: r } = /* @__PURE__ */ ur(), { pathExists: n } = /* @__PURE__ */ on(), { utimesMillis: i } = /* @__PURE__ */ Lm(), s = /* @__PURE__ */ On(), { asyncIteratorConcurrentProcess: a } = /* @__PURE__ */ Vw();
  async function o(m, v, p = {}) {
    typeof p == "function" && (p = { filter: p }), p.clobber = "clobber" in p ? !!p.clobber : !0, p.overwrite = "overwrite" in p ? !!p.overwrite : p.clobber, p.preserveTimestamps && process.arch === "ia32" && process.emitWarning(
      `Using the preserveTimestamps option in 32-bit node is not recommended;

	see https://github.com/jprichardson/node-fs-extra/issues/269`,
      "Warning",
      "fs-extra-WARN0001"
    );
    const { srcStat: E, destStat: _ } = await s.checkPaths(m, v, "copy", p);
    if (await s.checkParentPaths(m, E, v, "copy"), !await c(m, v, p)) return;
    const b = e.dirname(v);
    await n(b) || await r(b), await h(_, m, v, p);
  }
  async function c(m, v, p) {
    return p.filter ? p.filter(m, v) : !0;
  }
  async function h(m, v, p, E) {
    const y = await (E.dereference ? t.stat : t.lstat)(v);
    if (y.isDirectory()) return g(y, m, v, p, E);
    if (y.isFile() || y.isCharacterDevice() || y.isBlockDevice()) return f(y, m, v, p, E);
    if (y.isSymbolicLink()) return w(m, v, p, E);
    throw y.isSocket() ? new Error(`Cannot copy a socket file: ${v}`) : y.isFIFO() ? new Error(`Cannot copy a FIFO pipe: ${v}`) : new Error(`Unknown file: ${v}`);
  }
  async function f(m, v, p, E, _) {
    if (!v) return u(m, p, E, _);
    if (_.overwrite)
      return await t.unlink(E), u(m, p, E, _);
    if (_.errorOnExist)
      throw new Error(`'${E}' already exists`);
  }
  async function u(m, v, p, E) {
    if (await t.copyFile(v, p), E.preserveTimestamps) {
      l(m.mode) && await d(p, m.mode);
      const _ = await t.stat(v);
      await i(p, _.atime, _.mtime);
    }
    return t.chmod(p, m.mode);
  }
  function l(m) {
    return (m & 128) === 0;
  }
  function d(m, v) {
    return t.chmod(m, v | 128);
  }
  async function g(m, v, p, E, _) {
    v || await t.mkdir(E), await a(await t.opendir(p), async (y) => {
      const b = e.join(p, y.name), S = e.join(E, y.name);
      if (await c(b, S, _)) {
        const { destStat: M } = await s.checkPaths(b, S, "copy", _);
        await h(M, b, S, _);
      }
    }), v || await t.chmod(E, m.mode);
  }
  async function w(m, v, p, E) {
    let _ = await t.readlink(v);
    if (E.dereference && (_ = e.resolve(process.cwd(), _)), !m)
      return t.symlink(_, p);
    let y = null;
    try {
      y = await t.readlink(p);
    } catch (b) {
      if (b.code === "EINVAL" || b.code === "UNKNOWN") return t.symlink(_, p);
      throw b;
    }
    if (E.dereference && (y = e.resolve(process.cwd(), y)), _ !== y) {
      if (s.isSrcSubdir(_, y))
        throw new Error(`Cannot copy '${_}' to a subdirectory of itself, '${y}'.`);
      if (s.isSrcSubdir(y, _))
        throw new Error(`Cannot overwrite '${y}' with '${_}'.`);
    }
    return await t.unlink(p), t.symlink(_, p);
  }
  return Bo = o, Bo;
}
var Zo, Zf;
function Kw() {
  if (Zf) return Zo;
  Zf = 1;
  const t = ui(), e = lt, r = ur().mkdirsSync, n = Lm().utimesMillisSync, i = /* @__PURE__ */ On();
  function s(y, b, S) {
    typeof S == "function" && (S = { filter: S }), S = S || {}, S.clobber = "clobber" in S ? !!S.clobber : !0, S.overwrite = "overwrite" in S ? !!S.overwrite : S.clobber, S.preserveTimestamps && process.arch === "ia32" && process.emitWarning(
      `Using the preserveTimestamps option in 32-bit node is not recommended;

	see https://github.com/jprichardson/node-fs-extra/issues/269`,
      "Warning",
      "fs-extra-WARN0002"
    );
    const { srcStat: x, destStat: M } = i.checkPathsSync(y, b, "copy", S);
    if (i.checkParentPathsSync(y, x, b, "copy"), S.filter && !S.filter(y, b)) return;
    const k = e.dirname(b);
    return t.existsSync(k) || r(k), a(M, y, b, S);
  }
  function a(y, b, S, x) {
    const k = (x.dereference ? t.statSync : t.lstatSync)(b);
    if (k.isDirectory()) return w(k, y, b, S, x);
    if (k.isFile() || k.isCharacterDevice() || k.isBlockDevice()) return o(k, y, b, S, x);
    if (k.isSymbolicLink()) return E(y, b, S, x);
    throw k.isSocket() ? new Error(`Cannot copy a socket file: ${b}`) : k.isFIFO() ? new Error(`Cannot copy a FIFO pipe: ${b}`) : new Error(`Unknown file: ${b}`);
  }
  function o(y, b, S, x, M) {
    return b ? c(y, S, x, M) : h(y, S, x, M);
  }
  function c(y, b, S, x) {
    if (x.overwrite)
      return t.unlinkSync(S), h(y, b, S, x);
    if (x.errorOnExist)
      throw new Error(`'${S}' already exists`);
  }
  function h(y, b, S, x) {
    return t.copyFileSync(b, S), x.preserveTimestamps && f(y.mode, b, S), d(S, y.mode);
  }
  function f(y, b, S) {
    return u(y) && l(S, y), g(b, S);
  }
  function u(y) {
    return (y & 128) === 0;
  }
  function l(y, b) {
    return d(y, b | 128);
  }
  function d(y, b) {
    return t.chmodSync(y, b);
  }
  function g(y, b) {
    const S = t.statSync(y);
    return n(b, S.atime, S.mtime);
  }
  function w(y, b, S, x, M) {
    return b ? v(S, x, M) : m(y.mode, S, x, M);
  }
  function m(y, b, S, x) {
    return t.mkdirSync(S), v(b, S, x), d(S, y);
  }
  function v(y, b, S) {
    const x = t.opendirSync(y);
    try {
      let M;
      for (; (M = x.readSync()) !== null; )
        p(M.name, y, b, S);
    } finally {
      x.closeSync();
    }
  }
  function p(y, b, S, x) {
    const M = e.join(b, y), k = e.join(S, y);
    if (x.filter && !x.filter(M, k)) return;
    const { destStat: $ } = i.checkPathsSync(M, k, "copy", x);
    return a($, M, k, x);
  }
  function E(y, b, S, x) {
    let M = t.readlinkSync(b);
    if (x.dereference && (M = e.resolve(process.cwd(), M)), y) {
      let k;
      try {
        k = t.readlinkSync(S);
      } catch ($) {
        if ($.code === "EINVAL" || $.code === "UNKNOWN") return t.symlinkSync(M, S);
        throw $;
      }
      if (x.dereference && (k = e.resolve(process.cwd(), k)), M !== k) {
        if (i.isSrcSubdir(M, k))
          throw new Error(`Cannot copy '${M}' to a subdirectory of itself, '${k}'.`);
        if (i.isSrcSubdir(k, M))
          throw new Error(`Cannot overwrite '${k}' with '${M}'.`);
      }
      return _(M, S);
    } else
      return t.symlinkSync(M, S);
  }
  function _(y, b) {
    return t.unlinkSync(b), t.symlinkSync(y, b);
  }
  return Zo = s, Zo;
}
var Vo, Vf;
function Ih() {
  if (Vf) return Vo;
  Vf = 1;
  const t = he().fromPromise;
  return Vo = {
    copy: t(/* @__PURE__ */ Hw()),
    copySync: /* @__PURE__ */ Kw()
  }, Vo;
}
var Ho, Hf;
function va() {
  if (Hf) return Ho;
  Hf = 1;
  const t = ui(), e = he().fromCallback;
  function r(i, s) {
    t.rm(i, { recursive: !0, force: !0 }, s);
  }
  function n(i) {
    t.rmSync(i, { recursive: !0, force: !0 });
  }
  return Ho = {
    remove: e(r),
    removeSync: n
  }, Ho;
}
var Ko, Kf;
function Xw() {
  if (Kf) return Ko;
  Kf = 1;
  const t = he().fromPromise, e = /* @__PURE__ */ Oe(), r = lt, n = /* @__PURE__ */ ur(), i = /* @__PURE__ */ va(), s = t(async function(c) {
    let h;
    try {
      h = await e.readdir(c);
    } catch {
      return n.mkdirs(c);
    }
    return Promise.all(h.map((f) => i.remove(r.join(c, f))));
  });
  function a(o) {
    let c;
    try {
      c = e.readdirSync(o);
    } catch {
      return n.mkdirsSync(o);
    }
    c.forEach((h) => {
      h = r.join(o, h), i.removeSync(h);
    });
  }
  return Ko = {
    emptyDirSync: a,
    emptydirSync: a,
    emptyDir: s,
    emptydir: s
  }, Ko;
}
var Xo, Xf;
function Ww() {
  if (Xf) return Xo;
  Xf = 1;
  const t = he().fromPromise, e = lt, r = /* @__PURE__ */ Oe(), n = /* @__PURE__ */ ur();
  async function i(a) {
    let o;
    try {
      o = await r.stat(a);
    } catch {
    }
    if (o && o.isFile()) return;
    const c = e.dirname(a);
    let h = null;
    try {
      h = await r.stat(c);
    } catch (f) {
      if (f.code === "ENOENT") {
        await n.mkdirs(c), await r.writeFile(a, "");
        return;
      } else
        throw f;
    }
    h.isDirectory() ? await r.writeFile(a, "") : await r.readdir(c);
  }
  function s(a) {
    let o;
    try {
      o = r.statSync(a);
    } catch {
    }
    if (o && o.isFile()) return;
    const c = e.dirname(a);
    try {
      r.statSync(c).isDirectory() || r.readdirSync(c);
    } catch (h) {
      if (h && h.code === "ENOENT") n.mkdirsSync(c);
      else throw h;
    }
    r.writeFileSync(a, "");
  }
  return Xo = {
    createFile: t(i),
    createFileSync: s
  }, Xo;
}
var Wo, Wf;
function Jw() {
  if (Wf) return Wo;
  Wf = 1;
  const t = he().fromPromise, e = lt, r = /* @__PURE__ */ Oe(), n = /* @__PURE__ */ ur(), { pathExists: i } = /* @__PURE__ */ on(), { areIdentical: s } = /* @__PURE__ */ On();
  async function a(c, h) {
    let f;
    try {
      f = await r.lstat(h);
    } catch {
    }
    let u;
    try {
      u = await r.lstat(c);
    } catch (g) {
      throw g.message = g.message.replace("lstat", "ensureLink"), g;
    }
    if (f && s(u, f)) return;
    const l = e.dirname(h);
    await i(l) || await n.mkdirs(l), await r.link(c, h);
  }
  function o(c, h) {
    let f;
    try {
      f = r.lstatSync(h);
    } catch {
    }
    try {
      const d = r.lstatSync(c);
      if (f && s(d, f)) return;
    } catch (d) {
      throw d.message = d.message.replace("lstat", "ensureLink"), d;
    }
    const u = e.dirname(h);
    return r.existsSync(u) || n.mkdirsSync(u), r.linkSync(c, h);
  }
  return Wo = {
    createLink: t(a),
    createLinkSync: o
  }, Wo;
}
var Jo, Jf;
function Yw() {
  if (Jf) return Jo;
  Jf = 1;
  const t = lt, e = /* @__PURE__ */ Oe(), { pathExists: r } = /* @__PURE__ */ on(), n = he().fromPromise;
  async function i(a, o) {
    if (t.isAbsolute(a)) {
      try {
        await e.lstat(a);
      } catch (u) {
        throw u.message = u.message.replace("lstat", "ensureSymlink"), u;
      }
      return {
        toCwd: a,
        toDst: a
      };
    }
    const c = t.dirname(o), h = t.join(c, a);
    if (await r(h))
      return {
        toCwd: h,
        toDst: a
      };
    try {
      await e.lstat(a);
    } catch (u) {
      throw u.message = u.message.replace("lstat", "ensureSymlink"), u;
    }
    return {
      toCwd: a,
      toDst: t.relative(c, a)
    };
  }
  function s(a, o) {
    if (t.isAbsolute(a)) {
      if (!e.existsSync(a)) throw new Error("absolute srcpath does not exist");
      return {
        toCwd: a,
        toDst: a
      };
    }
    const c = t.dirname(o), h = t.join(c, a);
    if (e.existsSync(h))
      return {
        toCwd: h,
        toDst: a
      };
    if (!e.existsSync(a)) throw new Error("relative srcpath does not exist");
    return {
      toCwd: a,
      toDst: t.relative(c, a)
    };
  }
  return Jo = {
    symlinkPaths: n(i),
    symlinkPathsSync: s
  }, Jo;
}
var Yo, Yf;
function Qw() {
  if (Yf) return Yo;
  Yf = 1;
  const t = /* @__PURE__ */ Oe(), e = he().fromPromise;
  async function r(i, s) {
    if (s) return s;
    let a;
    try {
      a = await t.lstat(i);
    } catch {
      return "file";
    }
    return a && a.isDirectory() ? "dir" : "file";
  }
  function n(i, s) {
    if (s) return s;
    let a;
    try {
      a = t.lstatSync(i);
    } catch {
      return "file";
    }
    return a && a.isDirectory() ? "dir" : "file";
  }
  return Yo = {
    symlinkType: e(r),
    symlinkTypeSync: n
  }, Yo;
}
var Qo, Qf;
function t_() {
  if (Qf) return Qo;
  Qf = 1;
  const t = he().fromPromise, e = lt, r = /* @__PURE__ */ Oe(), { mkdirs: n, mkdirsSync: i } = /* @__PURE__ */ ur(), { symlinkPaths: s, symlinkPathsSync: a } = /* @__PURE__ */ Yw(), { symlinkType: o, symlinkTypeSync: c } = /* @__PURE__ */ Qw(), { pathExists: h } = /* @__PURE__ */ on(), { areIdentical: f } = /* @__PURE__ */ On();
  async function u(d, g, w) {
    let m;
    try {
      m = await r.lstat(g);
    } catch {
    }
    if (m && m.isSymbolicLink()) {
      const [_, y] = await Promise.all([
        r.stat(d),
        r.stat(g)
      ]);
      if (f(_, y)) return;
    }
    const v = await s(d, g);
    d = v.toDst;
    const p = await o(v.toCwd, w), E = e.dirname(g);
    return await h(E) || await n(E), r.symlink(d, g, p);
  }
  function l(d, g, w) {
    let m;
    try {
      m = r.lstatSync(g);
    } catch {
    }
    if (m && m.isSymbolicLink()) {
      const _ = r.statSync(d), y = r.statSync(g);
      if (f(_, y)) return;
    }
    const v = a(d, g);
    d = v.toDst, w = c(v.toCwd, w);
    const p = e.dirname(g);
    return r.existsSync(p) || i(p), r.symlinkSync(d, g, w);
  }
  return Qo = {
    createSymlink: t(u),
    createSymlinkSync: l
  }, Qo;
}
var tc, td;
function e_() {
  if (td) return tc;
  td = 1;
  const { createFile: t, createFileSync: e } = /* @__PURE__ */ Ww(), { createLink: r, createLinkSync: n } = /* @__PURE__ */ Jw(), { createSymlink: i, createSymlinkSync: s } = /* @__PURE__ */ t_();
  return tc = {
    // file
    createFile: t,
    createFileSync: e,
    ensureFile: t,
    ensureFileSync: e,
    // link
    createLink: r,
    createLinkSync: n,
    ensureLink: r,
    ensureLinkSync: n,
    // symlink
    createSymlink: i,
    createSymlinkSync: s,
    ensureSymlink: i,
    ensureSymlinkSync: s
  }, tc;
}
var ec, ed;
function Ph() {
  if (ed) return ec;
  ed = 1;
  function t(r, { EOL: n = `
`, finalEOL: i = !0, replacer: s = null, spaces: a } = {}) {
    const o = i ? n : "";
    return JSON.stringify(r, s, a).replace(/\n/g, n) + o;
  }
  function e(r) {
    return Buffer.isBuffer(r) && (r = r.toString("utf8")), r.replace(/^\uFEFF/, "");
  }
  return ec = { stringify: t, stripBom: e }, ec;
}
var rc, rd;
function r_() {
  if (rd) return rc;
  rd = 1;
  let t;
  try {
    t = ui();
  } catch {
    t = Gr;
  }
  const e = he(), { stringify: r, stripBom: n } = Ph();
  async function i(f, u = {}) {
    typeof u == "string" && (u = { encoding: u });
    const l = u.fs || t, d = "throws" in u ? u.throws : !0;
    let g = await e.fromCallback(l.readFile)(f, u);
    g = n(g);
    let w;
    try {
      w = JSON.parse(g, u ? u.reviver : null);
    } catch (m) {
      if (d)
        throw m.message = `${f}: ${m.message}`, m;
      return null;
    }
    return w;
  }
  const s = e.fromPromise(i);
  function a(f, u = {}) {
    typeof u == "string" && (u = { encoding: u });
    const l = u.fs || t, d = "throws" in u ? u.throws : !0;
    try {
      let g = l.readFileSync(f, u);
      return g = n(g), JSON.parse(g, u.reviver);
    } catch (g) {
      if (d)
        throw g.message = `${f}: ${g.message}`, g;
      return null;
    }
  }
  async function o(f, u, l = {}) {
    const d = l.fs || t, g = r(u, l);
    await e.fromCallback(d.writeFile)(f, g, l);
  }
  const c = e.fromPromise(o);
  function h(f, u, l = {}) {
    const d = l.fs || t, g = r(u, l);
    return d.writeFileSync(f, g, l);
  }
  return rc = {
    readFile: s,
    readFileSync: a,
    writeFile: c,
    writeFileSync: h
  }, rc;
}
var nc, nd;
function n_() {
  if (nd) return nc;
  nd = 1;
  const t = r_();
  return nc = {
    // jsonfile exports
    readJson: t.readFile,
    readJsonSync: t.readFileSync,
    writeJson: t.writeFile,
    writeJsonSync: t.writeFileSync
  }, nc;
}
var ic, id;
function Ah() {
  if (id) return ic;
  id = 1;
  const t = he().fromPromise, e = /* @__PURE__ */ Oe(), r = lt, n = /* @__PURE__ */ ur(), i = on().pathExists;
  async function s(o, c, h = "utf-8") {
    const f = r.dirname(o);
    return await i(f) || await n.mkdirs(f), e.writeFile(o, c, h);
  }
  function a(o, ...c) {
    const h = r.dirname(o);
    e.existsSync(h) || n.mkdirsSync(h), e.writeFileSync(o, ...c);
  }
  return ic = {
    outputFile: t(s),
    outputFileSync: a
  }, ic;
}
var sc, sd;
function i_() {
  if (sd) return sc;
  sd = 1;
  const { stringify: t } = Ph(), { outputFile: e } = /* @__PURE__ */ Ah();
  async function r(n, i, s = {}) {
    const a = t(i, s);
    await e(n, a, s);
  }
  return sc = r, sc;
}
var ac, ad;
function s_() {
  if (ad) return ac;
  ad = 1;
  const { stringify: t } = Ph(), { outputFileSync: e } = /* @__PURE__ */ Ah();
  function r(n, i, s) {
    const a = t(i, s);
    e(n, a, s);
  }
  return ac = r, ac;
}
var oc, od;
function a_() {
  if (od) return oc;
  od = 1;
  const t = he().fromPromise, e = /* @__PURE__ */ n_();
  return e.outputJson = t(/* @__PURE__ */ i_()), e.outputJsonSync = /* @__PURE__ */ s_(), e.outputJSON = e.outputJson, e.outputJSONSync = e.outputJsonSync, e.writeJSON = e.writeJson, e.writeJSONSync = e.writeJsonSync, e.readJSON = e.readJson, e.readJSONSync = e.readJsonSync, oc = e, oc;
}
var cc, cd;
function o_() {
  if (cd) return cc;
  cd = 1;
  const t = /* @__PURE__ */ Oe(), e = lt, { copy: r } = /* @__PURE__ */ Ih(), { remove: n } = /* @__PURE__ */ va(), { mkdirp: i } = /* @__PURE__ */ ur(), { pathExists: s } = /* @__PURE__ */ on(), a = /* @__PURE__ */ On();
  async function o(f, u, l = {}) {
    const d = l.overwrite || l.clobber || !1, { srcStat: g, isChangingCase: w = !1 } = await a.checkPaths(f, u, "move", l);
    await a.checkParentPaths(f, g, u, "move");
    const m = e.dirname(u);
    return e.parse(m).root !== m && await i(m), c(f, u, d, w);
  }
  async function c(f, u, l, d) {
    if (!d) {
      if (l)
        await n(u);
      else if (await s(u))
        throw new Error("dest already exists.");
    }
    try {
      await t.rename(f, u);
    } catch (g) {
      if (g.code !== "EXDEV")
        throw g;
      await h(f, u, l);
    }
  }
  async function h(f, u, l) {
    return await r(f, u, {
      overwrite: l,
      errorOnExist: !0,
      preserveTimestamps: !0
    }), n(f);
  }
  return cc = o, cc;
}
var hc, hd;
function c_() {
  if (hd) return hc;
  hd = 1;
  const t = ui(), e = lt, r = Ih().copySync, n = va().removeSync, i = ur().mkdirpSync, s = /* @__PURE__ */ On();
  function a(u, l, d) {
    d = d || {};
    const g = d.overwrite || d.clobber || !1, { srcStat: w, isChangingCase: m = !1 } = s.checkPathsSync(u, l, "move", d);
    return s.checkParentPathsSync(u, w, l, "move"), o(l) || i(e.dirname(l)), c(u, l, g, m);
  }
  function o(u) {
    const l = e.dirname(u);
    return e.parse(l).root === l;
  }
  function c(u, l, d, g) {
    if (g) return h(u, l, d);
    if (d)
      return n(l), h(u, l, d);
    if (t.existsSync(l)) throw new Error("dest already exists.");
    return h(u, l, d);
  }
  function h(u, l, d) {
    try {
      t.renameSync(u, l);
    } catch (g) {
      if (g.code !== "EXDEV") throw g;
      return f(u, l, d);
    }
  }
  function f(u, l, d) {
    return r(u, l, {
      overwrite: d,
      errorOnExist: !0,
      preserveTimestamps: !0
    }), n(u);
  }
  return hc = a, hc;
}
var lc, ld;
function h_() {
  if (ld) return lc;
  ld = 1;
  const t = he().fromPromise;
  return lc = {
    move: t(/* @__PURE__ */ o_()),
    moveSync: /* @__PURE__ */ c_()
  }, lc;
}
var uc, ud;
function l_() {
  return ud || (ud = 1, uc = {
    // Export promiseified graceful-fs:
    .../* @__PURE__ */ Oe(),
    // Export extra methods:
    .../* @__PURE__ */ Ih(),
    .../* @__PURE__ */ Xw(),
    .../* @__PURE__ */ e_(),
    .../* @__PURE__ */ a_(),
    .../* @__PURE__ */ ur(),
    .../* @__PURE__ */ h_(),
    .../* @__PURE__ */ Ah(),
    .../* @__PURE__ */ on(),
    .../* @__PURE__ */ va()
  }), uc;
}
var u_ = /* @__PURE__ */ l_();
const gt = /* @__PURE__ */ an(u_), Fm = /* @__PURE__ */ JSON.parse('[{"always":true,"mapID":"osm","title":"OpenStreetMap"},{"always":true,"mapID":"gsi","title":"地理院地図"},{"always":true,"mapID":"gsi_ortho","title":"地理院航空写真"},{"mapID":"gsi_ort_USA10","attr":"The Geospatial Information Authority of Japan","url":"https://cyberjapandata.gsi.go.jp/xyz/ort_USA10/{z}/{x}/{y}.png","maxZoom":17,"title":"地理院航空写真1945-50"},{"mapID":"gsi_ort_old10","attr":"The Geospatial Information Authority of Japan","url":"https://cyberjapandata.gsi.go.jp/xyz/ort_old10/{z}/{x}/{y}.png","maxZoom":17,"title":"地理院航空写真1961-64"},{"mapID":"gsi_gazo1","attr":"The Geospatial Information Authority of Japan","url":"https://cyberjapandata.gsi.go.jp/xyz/gazo1/{z}/{x}/{y}.jpg","maxZoom":17,"title":"地理院航空写真1974-78"},{"mapID":"gsi_gazo2","attr":"The Geospatial Information Authority of Japan","url":"https://cyberjapandata.gsi.go.jp/xyz/gazo2/{z}/{x}/{y}.jpg","maxZoom":17,"title":"地理院航空写真1979-83"},{"mapID":"gsi_gazo3","attr":"The Geospatial Information Authority of Japan","url":"https://cyberjapandata.gsi.go.jp/xyz/gazo3/{z}/{x}/{y}.jpg","maxZoom":17,"title":"地理院航空写真1984-86"},{"mapID":"gsi_gazo4","attr":"The Geospatial Information Authority of Japan","url":"https://cyberjapandata.gsi.go.jp/xyz/gazo4/{z}/{x}/{y}.jpg","maxZoom":17,"title":"地理院航空写真1988-90"},{"mapID":"affrc_rapid16","attr":"（独）農業環境技術研究所","url":"https://aginfo.cgk.affrc.go.jp/ws/tmc/1.0.0/Kanto_Rapid-900913-L/{z}/{x}/{y}.png","maxZoom":17,"title":"1/2万　迅速測図原図"},{"mapID":"affrc_tokyo5k","attr":"（独）農業環境技術研究所","url":"https://aginfo.cgk.affrc.go.jp/ws/tmc/1.0.0/Tokyo5000-900913-L/{z}/{x}/{y}.png","maxZoom":18,"title":"1/5千　東京測量図原図"},{"mapID":"tokyo502man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokyo50/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 首都圏 1896-1909年"},{"mapID":"tokyo5000","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokyo50/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 首都圏 1917-1924年"},{"mapID":"tokyo5001","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokyo50/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 首都圏 1927-1939年"},{"mapID":"tokyo5002","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokyo50/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 首都圏 1944-1954年"},{"mapID":"tokyo5003","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokyo50/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 首都圏 1965-1968年"},{"mapID":"tokyo5004","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokyo50/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 首都圏 1975-1978年"},{"mapID":"tokyo5005","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokyo50/05/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 首都圏 1983-1987年"},{"mapID":"tokyo5006","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokyo50/06/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 首都圏 1992-1995年"},{"mapID":"tokyo5007","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokyo50/07/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 首都圏 1998-2005年"},{"mapID":"chukyo2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1888-1898年"},{"mapID":"chukyo00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1920年"},{"mapID":"chukyo01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1932年"},{"mapID":"chukyo02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1937-1938年"},{"mapID":"chukyo03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1947年"},{"mapID":"chukyo04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1959-1960年"},{"mapID":"chukyo05","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/05/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1968-1973年"},{"mapID":"chukyo06","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/06/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1976-1980年"},{"mapID":"chukyo07","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/07/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1984-1989年"},{"mapID":"chukyo08","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/chukyo/08/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 中京圏 1992-1996年"},{"mapID":"keihansin2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1892-1910年"},{"mapID":"keihansin00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1922-1923年"},{"mapID":"keihansin01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1927-1935年"},{"mapID":"keihansin02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1947-1950年"},{"mapID":"keihansin03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1954-1956年"},{"mapID":"keihansin03x","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/03x/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1961-1964年"},{"mapID":"keihansin04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1967-1970年"},{"mapID":"keihansin05","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/05/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1975-1979年"},{"mapID":"keihansin06","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/06/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1983-1988年"},{"mapID":"keihansin07","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/keihansin/07/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 京阪神圏 1993-1997年"},{"mapID":"sapporo00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sapporo/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 札幌 1916年"},{"mapID":"sapporo01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sapporo/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 札幌 1935年"},{"mapID":"sapporo02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sapporo/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 札幌 1950-1952年"},{"mapID":"sapporo03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sapporo/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 札幌 1975-1976年"},{"mapID":"sapporo04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sapporo/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 札幌 1995-1998年"},{"mapID":"sendai00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sendai/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 仙台 1928-1933年"},{"mapID":"sendai01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sendai/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 仙台 1946年"},{"mapID":"sendai02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sendai/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 仙台 1963-1967年"},{"mapID":"sendai03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sendai/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 仙台 1977-1978年"},{"mapID":"sendai04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sendai/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 仙台 1995-2000年"},{"mapID":"hiroshima2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hiroshima/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 広島 1894-1899年"},{"mapID":"hiroshima00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hiroshima/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 広島 1925-1932年"},{"mapID":"hiroshima01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hiroshima/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 広島 1950-1954年"},{"mapID":"hiroshima02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hiroshima/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 広島 1967-1969年"},{"mapID":"hiroshima03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hiroshima/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 広島 1984-1990年"},{"mapID":"hiroshima04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hiroshima/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 広島 1992-2001年"},{"mapID":"fukuoka00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukuoka/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福岡・北九州 1922-1926年"},{"mapID":"fukuoka01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukuoka/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福岡・北九州 1936-1938年"},{"mapID":"fukuoka02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukuoka/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福岡・北九州 1948-1956年"},{"mapID":"fukuoka03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukuoka/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福岡・北九州 1967-1972年"},{"mapID":"fukuoka04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukuoka/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福岡・北九州 1982-1986年"},{"mapID":"fukuoka05","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukuoka/05/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福岡・北九州 1991-2000年"},{"mapID":"tohoku_pacific_coast00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tohoku_pacific_coast/00/{z}/{x}/{-y}.png","maxZoom":15,"title":"今昔マップ 東北地方太平洋岸 1901-1913年"},{"mapID":"tohoku_pacific_coast01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tohoku_pacific_coast/01/{z}/{x}/{-y}.png","maxZoom":15,"title":"今昔マップ 東北地方太平洋岸 1949-1953年"},{"mapID":"tohoku_pacific_coast02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tohoku_pacific_coast/02/{z}/{x}/{-y}.png","maxZoom":15,"title":"今昔マップ 東北地方太平洋岸 1969-1982年"},{"mapID":"tohoku_pacific_coast03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tohoku_pacific_coast/03/{z}/{x}/{-y}.png","maxZoom":15,"title":"今昔マップ 東北地方太平洋岸 1990-2008年"},{"mapID":"kanto00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kanto/00/{z}/{x}/{-y}.png","maxZoom":15,"title":"今昔マップ 関東 1894-1915年"},{"mapID":"kanto01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kanto/01/{z}/{x}/{-y}.png","maxZoom":15,"title":"今昔マップ 関東 1928-1945年"},{"mapID":"kanto02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kanto/02/{z}/{x}/{-y}.png","maxZoom":15,"title":"今昔マップ 関東 1972-1982年"},{"mapID":"kanto03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kanto/03/{z}/{x}/{-y}.png","maxZoom":15,"title":"今昔マップ 関東 1988-2008年"},{"mapID":"okinawas00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/okinawas/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 沖縄本島南部 1919年"},{"mapID":"okinawas01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/okinawas/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 沖縄本島南部 1973-1975年"},{"mapID":"okinawas02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/okinawas/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 沖縄本島南部 1992-1994年"},{"mapID":"okinawas03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/okinawas/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 沖縄本島南部 2005-2008年"},{"mapID":"hamamatsu2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hamamatsu/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 浜松・豊橋 1889-1890年"},{"mapID":"hamamatsu00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hamamatsu/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 浜松・豊橋 1916-1918年"},{"mapID":"hamamatsu01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hamamatsu/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 浜松・豊橋 1938-1950年"},{"mapID":"hamamatsu02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hamamatsu/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 浜松・豊橋 1956-1959年"},{"mapID":"hamamatsu03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hamamatsu/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 浜松・豊橋 1975-1988年"},{"mapID":"hamamatsu04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hamamatsu/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 浜松・豊橋 1988-1995年"},{"mapID":"hamamatsu05","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hamamatsu/05/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 浜松・豊橋 1996-2010年"},{"mapID":"kumamoto2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kumamoto/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 熊本 1900-1901年"},{"mapID":"kumamoto00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kumamoto/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 熊本 1926年"},{"mapID":"kumamoto01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kumamoto/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 熊本 1965-1971年"},{"mapID":"kumamoto02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kumamoto/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 熊本 1983年"},{"mapID":"kumamoto03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kumamoto/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 熊本 1998-2000年"},{"mapID":"niigata00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/niigata/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 新潟 1911年"},{"mapID":"niigata01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/niigata/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 新潟 1931年"},{"mapID":"niigata02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/niigata/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 新潟 1967-1968年"},{"mapID":"niigata03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/niigata/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 新潟 1983-1985年"},{"mapID":"niigata04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/niigata/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 新潟 2000-2001年"},{"mapID":"himeji2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/himeji/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 姫路 1903-1910年"},{"mapID":"himeji00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/himeji/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 姫路 1923年"},{"mapID":"himeji01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/himeji/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 姫路 1967年"},{"mapID":"himeji02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/himeji/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 姫路 1981-1985年"},{"mapID":"himeji03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/himeji/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 姫路 1997-2001年"},{"mapID":"okayama2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/okayama/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 岡山・福山 1895-1898年"},{"mapID":"okayama00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/okayama/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 岡山・福山 1925年"},{"mapID":"okayama01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/okayama/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 岡山・福山 1965-1970年"},{"mapID":"okayama02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/okayama/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 岡山・福山 1978-1988年"},{"mapID":"okayama03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/okayama/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 岡山・福山 1990-2000年"},{"mapID":"kagoshima5man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kagoshima/5man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鹿児島 1902年"},{"mapID":"kagoshima2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kagoshima/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鹿児島 1902年"},{"mapID":"kagoshima00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kagoshima/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鹿児島 1932年"},{"mapID":"kagoshima01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kagoshima/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鹿児島 1966年"},{"mapID":"kagoshima02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kagoshima/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鹿児島 1982-1983年"},{"mapID":"kagoshima03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kagoshima/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鹿児島 1996-2001年"},{"mapID":"matsuyama2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsuyama/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松山 1903年"},{"mapID":"matsuyama00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsuyama/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松山 1928-1955年"},{"mapID":"matsuyama01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsuyama/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松山 1968年"},{"mapID":"matsuyama02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsuyama/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松山 1985年"},{"mapID":"matsuyama03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsuyama/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松山 1998-1999年"},{"mapID":"oita00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/oita/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 大分 1914年"},{"mapID":"oita01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/oita/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 大分 1973年"},{"mapID":"oita02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/oita/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 大分 1984-1986年"},{"mapID":"oita03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/oita/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 大分 1997-2001年"},{"mapID":"nagasaki2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagasaki/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長崎 1900-1901年"},{"mapID":"nagasaki00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagasaki/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長崎 1924-1926年"},{"mapID":"nagasaki01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagasaki/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長崎 1954年"},{"mapID":"nagasaki02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagasaki/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長崎 1970-1970年"},{"mapID":"nagasaki03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagasaki/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長崎 1982-1983年"},{"mapID":"nagasaki03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagasaki/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長崎 1996-2000年"},{"mapID":"kanazawa2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kanazawa/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 金沢・富山 1909-1910年"},{"mapID":"kanazawa00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kanazawa/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 金沢・富山 1930年"},{"mapID":"kanazawa01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kanazawa/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 金沢・富山 1968-1969年"},{"mapID":"kanazawa02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kanazawa/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 金沢・富山 1981-1985年"},{"mapID":"kanazawa03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kanazawa/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 金沢・富山 1994-2001年"},{"mapID":"wakayama2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/wakayama/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 和歌山 1908-1912年"},{"mapID":"wakayama00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/wakayama/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 和歌山 1934年"},{"mapID":"wakayama01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/wakayama/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 和歌山 1947年"},{"mapID":"wakayama02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/wakayama/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 和歌山 1966-1967年"},{"mapID":"wakayama03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/wakayama/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 和歌山 1984-1985年"},{"mapID":"wakayama04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/wakayama/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 和歌山 1998-2000年"},{"mapID":"aomori00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aomori/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 青森 1912年"},{"mapID":"aomori01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aomori/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 青森 1939-1955年"},{"mapID":"aomori02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aomori/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 青森 1970年"},{"mapID":"aomori03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aomori/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 青森 1984-1989年"},{"mapID":"aomori04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aomori/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 青森 2003-2011年"},{"mapID":"takamatsu2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/takamatsu/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高松 1896-1910年"},{"mapID":"takamatsu00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/takamatsu/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高松 1928年"},{"mapID":"takamatsu01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/takamatsu/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高松 1969年"},{"mapID":"takamatsu02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/takamatsu/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高松 1983-1984年"},{"mapID":"takamatsu03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/takamatsu/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高松 1990-2000年"},{"mapID":"nagano00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagano/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長野 1912年"},{"mapID":"nagano01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagano/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長野 1937年"},{"mapID":"nagano02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagano/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長野 1960年"},{"mapID":"nagano03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagano/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長野 1972-1973年"},{"mapID":"nagano04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagano/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長野 1985年"},{"mapID":"nagano05","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/nagano/05/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 長野 2001年"},{"mapID":"fukushima00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukushima/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福島 1908年"},{"mapID":"fukushima01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukushima/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福島 1931年"},{"mapID":"fukushima02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukushima/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福島 1972-1973年"},{"mapID":"fukushima03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukushima/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福島 1983年"},{"mapID":"fukushima04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukushima/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福島 1996-2000年"},{"mapID":"fukui2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukui/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福井 1909年"},{"mapID":"fukui00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukui/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福井 1930年"},{"mapID":"fukui01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukui/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福井 1969-1973年"},{"mapID":"fukui02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukui/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福井 1988-1990年"},{"mapID":"fukui03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/fukui/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 福井 1996-2000年"},{"mapID":"akita00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/akita/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 秋田 1912年"},{"mapID":"akita01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/akita/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 秋田 1971-1972年"},{"mapID":"akita02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/akita/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 秋田 1985-1990年"},{"mapID":"akita03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/akita/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 秋田 2006-2007年"},{"mapID":"morioka00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/morioka/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 盛岡 1811-1912年"},{"mapID":"morioka01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/morioka/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 盛岡 1939年"},{"mapID":"morioka02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/morioka/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 盛岡 1968-1969年"},{"mapID":"morioka03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/morioka/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 盛岡 1983-1988年"},{"mapID":"morioka04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/morioka/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 盛岡 1999-2002年"},{"mapID":"tottori2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tottori/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鳥取 1897年"},{"mapID":"tottori00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tottori/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鳥取 1932年"},{"mapID":"tottori01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tottori/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鳥取 1973年"},{"mapID":"tottori02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tottori/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鳥取 1988年"},{"mapID":"tottori03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tottori/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 鳥取 1999-2001年"},{"mapID":"tokushima2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokushima/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 徳島 1896-1909年"},{"mapID":"tokushima00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokushima/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 徳島 1917年"},{"mapID":"tokushima01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokushima/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 徳島 1928-1934年"},{"mapID":"tokushima02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokushima/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 徳島 1969-1970年"},{"mapID":"tokushima03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokushima/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 徳島 1981-1987年"},{"mapID":"tokushima04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tokushima/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 徳島 1997-2000年"},{"mapID":"kochi2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kochi/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高知 1906-1907年"},{"mapID":"kochi00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kochi/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高知 1933年"},{"mapID":"kochi01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kochi/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高知 1965年"},{"mapID":"kochi02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kochi/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高知 1982年"},{"mapID":"kochi03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kochi/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 高知 1998-2003年"},{"mapID":"miyazaki00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyazaki/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 宮崎 1902年"},{"mapID":"miyazaki01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyazaki/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 宮崎 1935年"},{"mapID":"miyazaki02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyazaki/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 宮崎 1962年"},{"mapID":"miyazaki03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyazaki/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 宮崎 1979年"},{"mapID":"miyazaki04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyazaki/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 宮崎 1999-2001年"},{"mapID":"yamagata2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamagata/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山形 1901-1903年"},{"mapID":"yamagata00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamagata/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山形 1931年"},{"mapID":"yamagata01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamagata/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山形 1970年"},{"mapID":"yamagata02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamagata/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山形 1980-1989年"},{"mapID":"yamagata03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamagata/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山形 1999-2001年"},{"mapID":"saga2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/saga/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐賀・久留米 1900-1911年"},{"mapID":"saga00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/saga/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐賀・久留米 1914-1926年"},{"mapID":"saga01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/saga/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐賀・久留米 1931-1940年"},{"mapID":"saga02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/saga/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐賀・久留米 1958-1964年"},{"mapID":"saga03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/saga/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐賀・久留米 1977-1982年"},{"mapID":"saga04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/saga/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐賀・久留米 1998-2001年"},{"mapID":"matsue00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsue/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松江・米子 1915年"},{"mapID":"matsue01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsue/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松江・米子 1934年"},{"mapID":"matsue02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsue/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松江・米子 1975年"},{"mapID":"matsue03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsue/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松江・米子 1989-1990年"},{"mapID":"matsue04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsue/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松江・米子 1997-2003年"},{"mapID":"tsu2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tsu/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 津 1892-1898年"},{"mapID":"tsu00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tsu/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 津 1920年"},{"mapID":"tsu01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tsu/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 津 1937年"},{"mapID":"tsu02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tsu/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 津 1959年"},{"mapID":"tsu03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tsu/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 津 1980-1982年"},{"mapID":"tsu04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tsu/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 津 1991-1999年"},{"mapID":"yamaguchi2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamaguchi/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山口 1897-1909年"},{"mapID":"yamaguchi00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamaguchi/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山口 1922-1927年"},{"mapID":"yamaguchi01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamaguchi/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山口 1936-1951年"},{"mapID":"yamaguchi02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamaguchi/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山口 1969年"},{"mapID":"yamaguchi03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamaguchi/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山口 1983-1989年"},{"mapID":"yamaguchi04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/yamaguchi/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 山口 2000-2001年"},{"mapID":"asahikawa00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/asahikawa/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 旭川 1916-1917年"},{"mapID":"asahikawa01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/asahikawa/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 旭川 1950-1952年"},{"mapID":"asahikawa02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/asahikawa/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 旭川 1972-1974年"},{"mapID":"asahikawa03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/asahikawa/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 旭川 1986年"},{"mapID":"asahikawa04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/asahikawa/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 旭川 1999-2001年"},{"mapID":"hakodate00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hakodate/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 函館 19159年"},{"mapID":"hakodate01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hakodate/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 函館 1951-1955年"},{"mapID":"hakodate02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hakodate/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 函館 1968年"},{"mapID":"hakodate03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hakodate/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 函館 1986-1989年"},{"mapID":"hakodate04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hakodate/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 函館 1996-2001年"},{"mapID":"matsumoto00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsumoto/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松本 1910年"},{"mapID":"matsumoto01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsumoto/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松本 1931年"},{"mapID":"matsumoto02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsumoto/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松本 1974-1975年"},{"mapID":"matsumoto03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsumoto/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松本 1987-1992年"},{"mapID":"matsumoto04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/matsumoto/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 松本 1996-2001年"},{"mapID":"sasebo2man","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sasebo/2man/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐世保 1900-1901年"},{"mapID":"sasebo00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sasebo/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐世保 1924年"},{"mapID":"sasebo01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sasebo/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐世保 1971年"},{"mapID":"sasebo02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sasebo/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐世保 1985-1987年"},{"mapID":"sasebo03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/sasebo/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 佐世保 1997-1998年"},{"mapID":"hirosaki00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hirosaki/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 弘前 1912年"},{"mapID":"hirosaki01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hirosaki/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 弘前 1939年"},{"mapID":"hirosaki02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hirosaki/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 弘前 1970-1971年"},{"mapID":"hirosaki03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hirosaki/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 弘前 1980-1986年"},{"mapID":"hirosaki04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/hirosaki/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 弘前 1994-1997年"},{"mapID":"aizu00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aizu/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 会津 1908-1910年"},{"mapID":"aizu01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aizu/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 会津 1931年"},{"mapID":"aizu02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aizu/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 会津 1972-1975年"},{"mapID":"aizu03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aizu/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 会津 1988-1991年"},{"mapID":"aizu04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/aizu/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 会津 1997-2000年"},{"mapID":"kushiro00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kushiro/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 釧路 1897年"},{"mapID":"kushiro01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kushiro/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 釧路 1922年"},{"mapID":"kushiro02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kushiro/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 釧路 1958年"},{"mapID":"kushiro03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kushiro/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 釧路 1981年"},{"mapID":"kushiro04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/kushiro/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 釧路 2001年"},{"mapID":"tomakomai00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tomakomai/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 苫小牧 1896年"},{"mapID":"tomakomai01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tomakomai/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 苫小牧 1935年"},{"mapID":"tomakomai02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tomakomai/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 苫小牧 1954-1955年"},{"mapID":"tomakomai03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tomakomai/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 苫小牧 1983-1984年"},{"mapID":"tomakomai04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/tomakomai/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 苫小牧 1993-999年"},{"mapID":"obihiro00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/obihiro/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 帯広 1896年"},{"mapID":"obihiro01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/obihiro/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 帯広 1930年"},{"mapID":"obihiro02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/obihiro/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 帯広 1956-1957年"},{"mapID":"obihiro03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/obihiro/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 帯広 1985年"},{"mapID":"obihiro04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/obihiro/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 帯広 1998-2000年"},{"mapID":"miyakonojyou00","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/00/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 都城 1902年"},{"mapID":"miyakonojyou01","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/01/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 都城 1932年"},{"mapID":"miyakonojyou02","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/02/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 都城 1966年"},{"mapID":"miyakonojyou03","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/03/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 都城 1979-1980年"},{"mapID":"miyakonojyou04","attr":"今昔マップ on the web","url":"https://ktgis.net/kjmapw/kjtilemap/miyakonojyou/04/{z}/{x}/{-y}.png","maxZoom":16,"title":"今昔マップ 都城 1998-2001年"}]'), f_ = {
  lang: "ja",
  saveFolder: lt.join(xe.getPath("documents"), xe.getName()),
  tmsList: Fm
};
class d_ extends Kp {
  store;
  constructor() {
    super(), this.store = new Gw({ defaults: f_ }), this.migrateLegacySettings(), this.ensureDataDirectories();
  }
  // ... (migrateLegacySettings remains same)
  migrateLegacySettings() {
    if (!this.store.has("migratedFromLegacy"))
      try {
        const e = xe.getPath("appData"), r = lt.join(e, "MaplatEditor", "storage");
        if (gt.existsSync(r)) {
          const n = lt.join(r, "saveFolder.json");
          if (gt.existsSync(n))
            try {
              const s = gt.readJsonSync(n);
              s && this.store.set("saveFolder", s);
            } catch {
            }
          const i = lt.join(r, "lang.json");
          if (gt.existsSync(i))
            try {
              const s = gt.readJsonSync(i);
              s && this.store.set("lang", s);
            } catch {
            }
          this.store.set("migratedFromLegacy", !0), console.log("Migrated legacy settings.");
        }
      } catch (e) {
        console.error("Failed to migrate legacy settings", e);
      }
  }
  ensureDataDirectories() {
    const e = this.store.get("saveFolder");
    try {
      gt.ensureDirSync(e);
    } catch (r) {
      console.error(`Could not create/access saveFolder: ${e}`, r);
    }
  }
  get(e) {
    return e === "tmpFolder" ? lt.join(xe.getPath("temp"), xe.getName()) : this.store.get(e);
  }
  getAll() {
    return this.store.store;
  }
  set(e, r) {
    const n = this.store.get(e);
    this.store.set(e, r), e === "saveFolder" && this.ensureDataDirectories(), e === "lang" && n !== r && this.emit("changeLang", r);
  }
  async showSaveFolderDialog(e) {
    const r = await In.showOpenDialog(e, {
      defaultPath: this.store.get("saveFolder"),
      properties: ["openDirectory"]
    });
    return !r.canceled && r.filePaths.length > 0 ? r.filePaths[0] : null;
  }
  async getTmsListOfMapID(e) {
    return new Promise((r) => {
      const n = [...Fm], i = this.store.get("saveFolder"), s = lt.join(i, "settings");
      let a = this.store.get("tmsList") || [];
      Array.isArray(a) || (a = []);
      let o = n.concat(a);
      try {
        const l = lt.join(s, "tmsList.json");
        if (gt.existsSync(l)) {
          const d = gt.readJsonSync(l);
          Array.isArray(d) && (o = n.concat(d));
        }
      } catch (l) {
        console.error("Failed to read user tmsList.json", l);
      }
      let c = {};
      const h = lt.join(s, `tmsList.${e}.json`);
      let f = !1;
      try {
        gt.existsSync(h) && (c = gt.readJsonSync(h) || {});
      } catch (l) {
        console.error(`Failed to read ${h}`, l);
      }
      const u = [];
      if (o.forEach((l) => {
        if (l.always) {
          u.push(l);
          return;
        }
        const d = l.mapID;
        let g = c[d];
        g == null && (g = c[d] = !0, f = !0), g && u.push(l);
      }), f)
        try {
          gt.ensureDirSync(s), gt.writeJsonSync(h, c, { spaces: 2 });
        } catch (l) {
          console.error(`Failed to write to ${h}`, l);
        }
      r(u);
    });
  }
}
const ae = new d_();
var Te = {}, Kr = {}, fd;
function Nh() {
  if (fd) return Kr;
  fd = 1;
  const t = (a, o) => o ? [...new Map(a.map((c) => [o(c), c])).values()] : [...new Set(a)], e = (a) => typeof a == "object" && a !== null, r = (a) => e(a) && Object.prototype.toString.call(a) === "[object Date]", n = (a) => e(a) && Object.prototype.toString.call(a) === "[object RegExp]", i = (a, o) => o.reduce((c, h) => (a && Object.prototype.hasOwnProperty.call(a, h) && (c[h] = a[h]), c), {}), s = (a) => ([o, c]) => !!(typeof c == "string" || typeof c == "number" || typeof c == "boolean" || r(c) || c === null) && a.includes(o);
  return Kr.uniq = t, Kr.isDate = r, Kr.isRegExp = n, Kr.pick = i, Kr.filterIndexNames = s, Kr;
}
var dd;
function Ea() {
  if (dd) return Te;
  dd = 1;
  const { uniq: t, isDate: e, isRegExp: r } = Nh(), n = (M, k) => {
    if (typeof M == "number" && (M = M.toString()), M[0] === "$" && !(M === "$$date" && typeof k == "number") && !(M === "$$deleted" && k === !0) && M !== "$$indexCreated" && M !== "$$indexRemoved") throw new Error("Field names cannot begin with the $ character");
    if (M.indexOf(".") !== -1) throw new Error("Field names cannot contain a .");
  }, i = (M) => {
    if (Array.isArray(M) && M.forEach((k) => {
      i(k);
    }), typeof M == "object" && M !== null)
      for (const k in M)
        Object.prototype.hasOwnProperty.call(M, k) && (n(k, M[k]), i(M[k]));
  }, s = (M) => JSON.stringify(M, function(k, $) {
    if (n(k, $), $ !== void 0)
      return $ === null ? null : typeof this[k].getTime == "function" ? { $$date: this[k].getTime() } : $;
  }), a = (M) => JSON.parse(M, function(k, $) {
    return k === "$$date" ? new Date($) : typeof $ == "string" || typeof $ == "number" || typeof $ == "boolean" || $ === null ? $ : $ && $.$$date ? $.$$date : $;
  });
  function o(M, k) {
    if (typeof M == "boolean" || typeof M == "number" || typeof M == "string" || M === null || e(M)) return M;
    if (Array.isArray(M)) return M.map(($) => o($, k));
    if (typeof M == "object") {
      const $ = {};
      for (const O in M)
        Object.prototype.hasOwnProperty.call(M, O) && (!k || O[0] !== "$" && O.indexOf(".") === -1) && ($[O] = o(M[O], k));
      return $;
    }
  }
  const c = (M) => typeof M == "boolean" || typeof M == "number" || typeof M == "string" || M === null || e(M) || Array.isArray(M), h = (M, k) => M < k ? -1 : M > k ? 1 : 0, f = (M, k) => {
    const $ = Math.min(M.length, k.length);
    for (let O = 0; O < $; O += 1) {
      const T = u(M[O], k[O]);
      if (T !== 0) return T;
    }
    return h(M.length, k.length);
  }, u = (M, k, $) => {
    const O = $ || h;
    if (M === void 0) return k === void 0 ? 0 : -1;
    if (k === void 0) return 1;
    if (M === null) return k === null ? 0 : -1;
    if (k === null) return 1;
    if (typeof M == "number") return typeof k == "number" ? h(M, k) : -1;
    if (typeof k == "number") return typeof M == "number" ? h(M, k) : 1;
    if (typeof M == "string") return typeof k == "string" ? O(M, k) : -1;
    if (typeof k == "string") return typeof M == "string" ? O(M, k) : 1;
    if (typeof M == "boolean") return typeof k == "boolean" ? h(M, k) : -1;
    if (typeof k == "boolean") return typeof M == "boolean" ? h(M, k) : 1;
    if (e(M)) return e(k) ? h(M.getTime(), k.getTime()) : -1;
    if (e(k)) return e(M) ? h(M.getTime(), k.getTime()) : 1;
    if (Array.isArray(M)) return Array.isArray(k) ? f(M, k) : -1;
    if (Array.isArray(k)) return Array.isArray(M) ? f(M, k) : 1;
    const T = Object.keys(M).sort(), I = Object.keys(k).sort();
    for (let N = 0; N < Math.min(T.length, I.length); N += 1) {
      const j = u(M[T[N]], k[I[N]]);
      if (j !== 0) return j;
    }
    return h(T.length, I.length);
  }, l = (M, k = !1) => {
    const $ = (O, T, I) => {
      const N = typeof T == "string" ? T.split(".") : T;
      if (N.length === 1) M(O, T, I);
      else {
        if (O[N[0]] === void 0) {
          if (k) return;
          O[N[0]] = {};
        }
        $(O[N[0]], N.slice(1), I);
      }
    };
    return $;
  }, d = (M, k, $) => {
    if (Object.prototype.hasOwnProperty.call(M, k) || (M[k] = []), !Array.isArray(M[k])) throw new Error("Can't $addToSet an element on non-array values");
    if ($ !== null && typeof $ == "object" && $.$each) {
      if (Object.keys($).length > 1) throw new Error("Can't use another field in conjunction with $each");
      if (!Array.isArray($.$each)) throw new Error("$each requires an array value");
      $.$each.forEach((O) => {
        d(M, k, O);
      });
    } else {
      let O = !0;
      M[k].forEach((T) => {
        u(T, $) === 0 && (O = !1);
      }), O && M[k].push($);
    }
  }, g = {
    /**
     * Set a field to a new value
     */
    $set: l((M, k, $) => {
      M[k] = $;
    }),
    /**
     * Unset a field
     */
    $unset: l((M, k, $) => {
      delete M[k];
    }, !0),
    /**
     * Updates the value of the field, only if specified field is smaller than the current value of the field
     */
    $min: l((M, k, $) => {
      (typeof M[k] > "u" || $ < M[k]) && (M[k] = $);
    }),
    /**
     * Updates the value of the field, only if specified field is greater than the current value of the field
     */
    $max: l((M, k, $) => {
      (typeof M[k] > "u" || $ > M[k]) && (M[k] = $);
    }),
    /**
     * Increment a numeric field's value
     */
    $inc: l((M, k, $) => {
      if (typeof $ != "number") throw new Error(`${$} must be a number`);
      if (typeof M[k] != "number")
        if (!Object.prototype.hasOwnProperty.call(M, k)) M[k] = $;
        else throw new Error("Don't use the $inc modifier on non-number fields");
      else M[k] += $;
    }),
    /**
     * Removes all instances of a value from an existing array
     */
    $pull: l((M, k, $) => {
      if (!Array.isArray(M[k])) throw new Error("Can't $pull an element from non-array values");
      const O = M[k];
      for (let T = O.length - 1; T >= 0; T -= 1)
        S(O[T], $) && O.splice(T, 1);
    }),
    /**
     * Remove the first or last element of an array
     */
    $pop: l((M, k, $) => {
      if (!Array.isArray(M[k])) throw new Error("Can't $pop an element from non-array values");
      if (typeof $ != "number") throw new Error(`${$} isn't an integer, can't use it with $pop`);
      $ !== 0 && ($ > 0 ? M[k] = M[k].slice(0, M[k].length - 1) : M[k] = M[k].slice(1));
    }),
    /**
     * Add an element to an array field only if it is not already in it
     * No modification if the element is already in the array
     * Note that it doesn't check whether the original array contains duplicates
     */
    $addToSet: l(d),
    /**
     * Push an element to the end of an array field
     * Optional modifier $each instead of value to push several values
     * Optional modifier $slice to slice the resulting array, see https://docs.mongodb.org/manual/reference/operator/update/slice/
     * Difference with MongoDB: if $slice is specified and not $each, we act as if value is an empty array
     */
    $push: l((M, k, $) => {
      if (Object.prototype.hasOwnProperty.call(M, k) || (M[k] = []), !Array.isArray(M[k])) throw new Error("Can't $push an element on non-array values");
      if ($ !== null && typeof $ == "object" && $.$slice && $.$each === void 0 && ($.$each = []), $ !== null && typeof $ == "object" && $.$each) {
        if (Object.keys($).length >= 3 || Object.keys($).length === 2 && $.$slice === void 0) throw new Error("Can only use $slice in cunjunction with $each when $push to array");
        if (!Array.isArray($.$each)) throw new Error("$each requires an array value");
        if ($.$each.forEach((O) => {
          M[k].push(O);
        }), $.$slice === void 0 || typeof $.$slice != "number") return;
        if ($.$slice === 0) M[k] = [];
        else {
          let O, T;
          const I = M[k].length;
          $.$slice < 0 ? (O = Math.max(0, I + $.$slice), T = I) : $.$slice > 0 && (O = 0, T = Math.min(I, $.$slice)), M[k] = M[k].slice(O, T);
        }
      } else
        M[k].push($);
    })
  }, w = (M, k) => {
    const $ = Object.keys(k), O = $.map((j) => j[0]), T = O.filter((j) => j === "$");
    let I, N;
    if ($.indexOf("_id") !== -1 && k._id !== M._id) throw new Error("You cannot change a document's _id");
    if (T.length !== 0 && T.length !== O.length) throw new Error("You cannot mix modifiers and normal fields");
    if (T.length === 0 ? (I = o(k), I._id = M._id) : (N = t($), I = o(M), N.forEach((j) => {
      if (!g[j]) throw new Error(`Unknown modifier ${j}`);
      if (typeof k[j] != "object") throw new Error(`Modifier ${j}'s argument must be an object`);
      Object.keys(k[j]).forEach((F) => {
        g[j](I, F, k[j][F]);
      });
    })), i(I), M._id !== I._id) throw new Error("You can't change a document's _id");
    return I;
  }, m = (M, k) => {
    const $ = typeof k == "string" ? k.split(".") : k;
    if (M) {
      if ($.length === 0) return M;
      if ($.length === 1) return M[$[0]];
      if (Array.isArray(M[$[0]])) {
        const O = parseInt($[1], 10);
        return typeof O == "number" && !isNaN(O) ? m(M[$[0]][O], $.slice(2)) : M[$[0]].map((T) => m(T, $.slice(1)));
      } else return m(M[$[0]], $.slice(1));
    }
  }, v = (M, k) => {
    if (!Array.isArray(k)) throw new Error("fields must be an Array");
    if (k.length > 1) {
      const $ = {};
      for (const O of k)
        $[O] = m(M, O);
      return $;
    } else return m(M, k[0]);
  }, p = (M, k) => {
    if (M === null || typeof M == "string" || typeof M == "boolean" || typeof M == "number" || k === null || typeof k == "string" || typeof k == "boolean" || typeof k == "number") return M === k;
    if (e(M) || e(k)) return e(M) && e(k) && M.getTime() === k.getTime();
    if (!(Array.isArray(M) && Array.isArray(k)) && (Array.isArray(M) || Array.isArray(k)) || M === void 0 || k === void 0) return !1;
    let $, O;
    try {
      $ = Object.keys(M), O = Object.keys(k);
    } catch {
      return !1;
    }
    if ($.length !== O.length) return !1;
    for (const T of $)
      if (O.indexOf(T) === -1 || !p(M[T], k[T])) return !1;
    return !0;
  }, E = (M, k) => !(typeof M != "string" && typeof M != "number" && !e(M) && typeof k != "string" && typeof k != "number" && !e(k) || typeof M != typeof k), _ = {
    /** Lower than */
    $lt: (M, k) => E(M, k) && M < k,
    /** Lower than or equals */
    $lte: (M, k) => E(M, k) && M <= k,
    /** Greater than */
    $gt: (M, k) => E(M, k) && M > k,
    /** Greater than or equals */
    $gte: (M, k) => E(M, k) && M >= k,
    /** Does not equal */
    $ne: (M, k) => M === void 0 || !p(M, k),
    /** Is in Array */
    $in: (M, k) => {
      if (!Array.isArray(k)) throw new Error("$in operator called with a non-array");
      for (const $ of k)
        if (p(M, $)) return !0;
      return !1;
    },
    /** Is not in Array */
    $nin: (M, k) => {
      if (!Array.isArray(k)) throw new Error("$nin operator called with a non-array");
      return !_.$in(M, k);
    },
    /** Matches Regexp */
    $regex: (M, k) => {
      if (!r(k)) throw new Error("$regex operator called with non regular expression");
      return typeof M != "string" ? !1 : k.test(M);
    },
    /** Returns true if field exists */
    $exists: (M, k) => (k || k === "" ? k = !0 : k = !1, M === void 0 ? !k : k),
    /** Specific to Arrays, returns true if a length equals b */
    $size: (M, k) => {
      if (!Array.isArray(M)) return !1;
      if (k % 1 !== 0) throw new Error("$size operator called without an integer");
      return M.length === k;
    },
    /** Specific to Arrays, returns true if some elements of a match the query b */
    $elemMatch: (M, k) => Array.isArray(M) ? M.some(($) => S($, k)) : !1
  }, y = { $size: !0, $elemMatch: !0 }, b = {
    /**
     * Match any of the subqueries
     * @param {document} obj
     * @param {query[]} query
     * @return {boolean}
     */
    $or: (M, k) => {
      if (!Array.isArray(k)) throw new Error("$or operator used without an array");
      for (let $ = 0; $ < k.length; $ += 1)
        if (S(M, k[$])) return !0;
      return !1;
    },
    /**
     * Match all of the subqueries
     * @param {document} obj
     * @param {query[]} query
     * @return {boolean}
     */
    $and: (M, k) => {
      if (!Array.isArray(k)) throw new Error("$and operator used without an array");
      for (let $ = 0; $ < k.length; $ += 1)
        if (!S(M, k[$])) return !1;
      return !0;
    },
    /**
     * Inverted match of the query
     * @param {document} obj
     * @param {query} query
     * @return {boolean}
     */
    $not: (M, k) => !S(M, k),
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
    $where: (M, k) => {
      if (typeof k != "function") throw new Error("$where operator used without a function");
      const $ = k.call(M);
      if (typeof $ != "boolean") throw new Error("$where function must return boolean");
      return $;
    }
  }, S = (M, k) => {
    if (c(M) || c(k)) return x({ needAKey: M }, "needAKey", k);
    for (const $ in k)
      if (Object.prototype.hasOwnProperty.call(k, $)) {
        const O = k[$];
        if ($[0] === "$") {
          if (!b[$]) throw new Error(`Unknown logical operator ${$}`);
          if (!b[$](M, O)) return !1;
        } else if (!x(M, $, O)) return !1;
      }
    return !0;
  };
  function x(M, k, $, O) {
    const T = m(M, k);
    if (Array.isArray(T) && !O) {
      if (Array.isArray($)) return x(M, k, $, !0);
      if ($ !== null && typeof $ == "object" && !r($)) {
        for (const I in $)
          if (Object.prototype.hasOwnProperty.call($, I) && y[I])
            return x(M, k, $, !0);
      }
      for (const I of T)
        if (x({ k: I }, "k", $)) return !0;
      return !1;
    }
    if ($ !== null && typeof $ == "object" && !r($) && !Array.isArray($)) {
      const I = Object.keys($), N = I.map((C) => C[0]), j = N.filter((C) => C === "$");
      if (j.length !== 0 && j.length !== N.length) throw new Error("You cannot mix operators and normal fields");
      if (j.length > 0) {
        for (const C of I) {
          if (!_[C]) throw new Error(`Unknown comparison function ${C}`);
          if (!_[C](T, $[C])) return !1;
        }
        return !0;
      }
    }
    return r($) ? _.$regex(T, $) : p(T, $);
  }
  return Te.serialize = s, Te.deserialize = a, Te.deepCopy = o, Te.checkObject = i, Te.isPrimitiveType = c, Te.modify = w, Te.getDotValue = m, Te.getDotValues = v, Te.match = S, Te.areThingsEqual = p, Te.compareThings = u, Te;
}
var fc, md;
function m_() {
  if (md) return fc;
  md = 1;
  const t = Ea(), { callbackify: e } = ha;
  class r {
    /**
     * Create a new cursor for this collection.
     * @param {Datastore} db - The datastore this cursor is bound to
     * @param {query} query - The query this cursor will operate on
     * @param {Cursor~mapFn} [mapFn] - Handler to be executed after cursor has found the results and before the callback passed to find/findOne/update/remove
     */
    constructor(i, s, a) {
      this.db = i, this.query = s || {}, a && (this.mapFn = a), this._limit = void 0, this._skip = void 0, this._sort = void 0, this._projection = void 0;
    }
    /**
     * Set a limit to the number of results for the given Cursor.
     * @param {Number} limit
     * @return {Cursor} the same instance of Cursor, (useful for chaining).
     */
    limit(i) {
      return this._limit = i, this;
    }
    /**
     * Skip a number of results for the given Cursor.
     * @param {Number} skip
     * @return {Cursor} the same instance of Cursor, (useful for chaining).
     */
    skip(i) {
      return this._skip = i, this;
    }
    /**
     * Sort results of the query for the given Cursor.
     * @param {Object.<string, number>} sortQuery - sortQuery is { field: order }, field can use the dot-notation, order is 1 for ascending and -1 for descending
     * @return {Cursor} the same instance of Cursor, (useful for chaining).
     */
    sort(i) {
      return this._sort = i, this;
    }
    /**
     * Add the use of a projection to the given Cursor.
     * @param {Object.<string, number>} projection - MongoDB-style projection. {} means take all fields. Then it's { key1: 1, key2: 1 } to take only key1 and key2
     * { key1: 0, key2: 0 } to omit only key1 and key2. Except _id, you can't mix takes and omits.
     * @return {Cursor} the same instance of Cursor, (useful for chaining).
     */
    projection(i) {
      return this._projection = i, this;
    }
    /**
     * Apply the projection.
     *
     * This is an internal function. You should use {@link Cursor#execAsync} or {@link Cursor#exec}.
     * @param {document[]} candidates
     * @return {document[]}
     * @private
     */
    _project(i) {
      const s = [];
      let a;
      if (this._projection === void 0 || Object.keys(this._projection).length === 0)
        return i;
      const o = this._projection._id !== 0, { _id: c, ...h } = this._projection;
      this._projection = h;
      const f = Object.keys(this._projection);
      return f.forEach((u) => {
        if (a !== void 0 && this._projection[u] !== a) throw new Error("Can't both keep and omit fields except for _id");
        a = this._projection[u];
      }), i.forEach((u) => {
        let l;
        a === 1 ? (l = { $set: {} }, f.forEach((d) => {
          l.$set[d] = t.getDotValue(u, d), l.$set[d] === void 0 && delete l.$set[d];
        }), l = t.modify({}, l)) : (l = { $unset: {} }, f.forEach((d) => {
          l.$unset[d] = !0;
        }), l = t.modify(u, l)), o ? l._id = u._id : delete l._id, s.push(l);
      }), s;
    }
    /**
     * Get all matching elements
     * Will return pointers to matched elements (shallow copies), returning full copies is the role of find or findOne
     * This is an internal function, use execAsync which uses the executor
     * @return {document[]|Promise<*>}
     * @private
     */
    async _execAsync() {
      let i = [], s = 0, a = 0;
      const o = await this.db._getCandidatesAsync(this.query);
      for (const c of o)
        if (t.match(c, this.query)) {
          if (this._sort)
            i.push(c);
          else if (this._skip && this._skip > a) a += 1;
          else if (i.push(c), s += 1, this._limit && this._limit <= s) break;
        }
      if (this._sort) {
        const c = Object.entries(this._sort).map(([u, l]) => ({ key: u, direction: l }));
        i.sort((u, l) => {
          for (const d of c) {
            const g = d.direction * t.compareThings(t.getDotValue(u, d.key), t.getDotValue(l, d.key), this.db.compareStrings);
            if (g !== 0) return g;
          }
          return 0;
        });
        const h = this._limit || i.length, f = this._skip || 0;
        i = i.slice(f, f + h);
      }
      return i = this._project(i), this.mapFn ? this.mapFn(i) : i;
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
    exec(i) {
      e(() => this.execAsync())(i);
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
    then(i, s) {
      return this.execAsync().then(i, s);
    }
    catch(i) {
      return this.execAsync().catch(i);
    }
    finally(i) {
      return this.execAsync().finally(i);
    }
  }
  return fc = r, fc;
}
var dc = {}, pd;
function p_() {
  if (pd) return dc;
  pd = 1;
  const t = cm, e = (r) => t.randomBytes(Math.ceil(Math.max(8, r * 2))).toString("base64").replace(/[+/]/g, "").slice(0, r);
  return dc.uid = e, dc;
}
var mc, yd;
function Gm() {
  if (yd) return mc;
  yd = 1;
  class t {
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
    waterfall(r) {
      return (...n) => (this.guardian = this.guardian.then(() => r(...n).then((i) => ({ error: !1, result: i }), (i) => ({ error: !0, result: i }))), this.guardian.then(({ error: i, result: s }) => i ? Promise.reject(s) : Promise.resolve(s)));
    }
    /**
     * Shorthand for chaining a promise to the Waterfall
     * @param {Promise} promise
     * @return {Promise}
     */
    chain(r) {
      return this.waterfall(() => r)();
    }
  }
  return mc = t, mc;
}
var pc, gd;
function y_() {
  if (gd) return pc;
  gd = 1;
  const t = Gm();
  class e {
    /**
     * Instantiates a new Executor.
     */
    constructor() {
      this.ready = !1, this.queue = new t(), this.buffer = null, this._triggerBuffer = null, this.resetBuffer();
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
    pushAsync(n, i = !1) {
      return this.ready || i ? this.queue.waterfall(n)() : this.buffer.waterfall(n)();
    }
    /**
     * Queue all tasks in buffer (in the same order they came in)
     * Automatically sets executor as ready
     */
    processBuffer() {
      this.ready = !0, this._triggerBuffer(), this.queue.waterfall(() => this.buffer.guardian);
    }
    /**
     * Removes all tasks queued up in the buffer
     */
    resetBuffer() {
      this.buffer = new t(), this.buffer.chain(new Promise((n) => {
        this._triggerBuffer = n;
      })), this.ready && this._triggerBuffer();
    }
  }
  return pc = e, pc;
}
var xs = {}, Gn = {}, wd;
function zm() {
  if (wd) return Gn;
  wd = 1;
  const t = (n) => {
    if (n === 0) return [];
    if (n === 1) return [0];
    const i = t(n - 1), s = Math.floor(Math.random() * n);
    return i.splice(s, 0, n - 1), i;
  };
  Gn.getRandomArray = t;
  const e = (n, i) => {
    if (n < i) return -1;
    if (n > i) return 1;
    if (n === i) return 0;
    const s = new Error("Couldn't compare elements");
    throw s.a = n, s.b = i, s;
  };
  Gn.defaultCompareKeysFunction = e;
  const r = (n, i) => n === i;
  return Gn.defaultCheckValueEquality = r, Gn;
}
var yc, _d;
function qm() {
  if (_d) return yc;
  _d = 1;
  const t = zm();
  class e {
    /**
     * Constructor
     * @param {Object} options Optional
     * @param {Boolean}  options.unique Whether to enforce a 'unique' constraint on the key or not
     * @param {Key}      options.key Initialize this BST's key with key
     * @param {Value}    options.value Initialize this BST's data with [value]
     * @param {Function} options.compareKeys Initialize this BST's compareKeys
     */
    constructor(i) {
      i = i || {}, this.left = null, this.right = null, this.parent = i.parent !== void 0 ? i.parent : null, Object.prototype.hasOwnProperty.call(i, "key") && (this.key = i.key), this.data = Object.prototype.hasOwnProperty.call(i, "value") ? [i.value] : [], this.unique = i.unique || !1, this.compareKeys = i.compareKeys || t.defaultCompareKeysFunction, this.checkValueEquality = i.checkValueEquality || t.defaultCheckValueEquality;
    }
    /**
     * Get the descendant with max key
     */
    getMaxKeyDescendant() {
      return this.right ? this.right.getMaxKeyDescendant() : this;
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
      return this.left ? this.left.getMinKeyDescendant() : this;
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
    checkAllNodesFullfillCondition(i) {
      Object.prototype.hasOwnProperty.call(this, "key") && (i(this.key, this.data), this.left && this.left.checkAllNodesFullfillCondition(i), this.right && this.right.checkAllNodesFullfillCondition(i));
    }
    /**
     * Check that the core BST properties on node ordering are verified
     * Throw if they aren't
     */
    checkNodeOrdering() {
      Object.prototype.hasOwnProperty.call(this, "key") && (this.left && (this.left.checkAllNodesFullfillCondition((i) => {
        if (this.compareKeys(i, this.key) >= 0) throw new Error(`Tree with root ${this.key} is not a binary search tree`);
      }), this.left.checkNodeOrdering()), this.right && (this.right.checkAllNodesFullfillCondition((i) => {
        if (this.compareKeys(i, this.key) <= 0) throw new Error(`Tree with root ${this.key} is not a binary search tree`);
      }), this.right.checkNodeOrdering()));
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
      if (this.checkNodeOrdering(), this.checkInternalPointers(), this.parent) throw new Error("The root shouldn't have a parent");
    }
    /**
     * Get number of keys inserted
     */
    getNumberOfKeys() {
      let i;
      return Object.prototype.hasOwnProperty.call(this, "key") ? (i = 1, this.left && (i += this.left.getNumberOfKeys()), this.right && (i += this.right.getNumberOfKeys()), i) : 0;
    }
    /**
     * Create a BST similar (i.e. same options except for key and value) to the current one
     * Use the same constructor (i.e. BinarySearchTree, AVLTree etc)
     * @param {Object} options see constructor
     */
    createSimilar(i) {
      return i = i || {}, i.unique = this.unique, i.compareKeys = this.compareKeys, i.checkValueEquality = this.checkValueEquality, new this.constructor(i);
    }
    /**
     * Create the left child of this BST and return it
     */
    createLeftChild(i) {
      const s = this.createSimilar(i);
      return s.parent = this, this.left = s, s;
    }
    /**
     * Create the right child of this BST and return it
     */
    createRightChild(i) {
      const s = this.createSimilar(i);
      return s.parent = this, this.right = s, s;
    }
    /**
     * Insert a new element
     */
    insert(i, s) {
      if (!Object.prototype.hasOwnProperty.call(this, "key")) {
        this.key = i, this.data.push(s);
        return;
      }
      if (this.compareKeys(this.key, i) === 0) {
        if (this.unique) {
          const a = new Error(`Can't insert key ${JSON.stringify(i)}, it violates the unique constraint`);
          throw a.key = i, a.errorType = "uniqueViolated", a;
        } else this.data.push(s);
        return;
      }
      this.compareKeys(i, this.key) < 0 ? this.left ? this.left.insert(i, s) : this.createLeftChild({ key: i, value: s }) : this.right ? this.right.insert(i, s) : this.createRightChild({ key: i, value: s });
    }
    /**
     * Search for all data corresponding to a key
     */
    search(i) {
      return Object.prototype.hasOwnProperty.call(this, "key") ? this.compareKeys(this.key, i) === 0 ? this.data : this.compareKeys(i, this.key) < 0 ? this.left ? this.left.search(i) : [] : this.right ? this.right.search(i) : [] : [];
    }
    /**
     * Return a function that tells whether a given key matches a lower bound
     */
    getLowerBoundMatcher(i) {
      return !Object.prototype.hasOwnProperty.call(i, "$gt") && !Object.prototype.hasOwnProperty.call(i, "$gte") ? () => !0 : Object.prototype.hasOwnProperty.call(i, "$gt") && Object.prototype.hasOwnProperty.call(i, "$gte") ? this.compareKeys(i.$gte, i.$gt) === 0 ? (s) => this.compareKeys(s, i.$gt) > 0 : this.compareKeys(i.$gte, i.$gt) > 0 ? (s) => this.compareKeys(s, i.$gte) >= 0 : (s) => this.compareKeys(s, i.$gt) > 0 : Object.prototype.hasOwnProperty.call(i, "$gt") ? (s) => this.compareKeys(s, i.$gt) > 0 : (s) => this.compareKeys(s, i.$gte) >= 0;
    }
    /**
     * Return a function that tells whether a given key matches an upper bound
     */
    getUpperBoundMatcher(i) {
      return !Object.prototype.hasOwnProperty.call(i, "$lt") && !Object.prototype.hasOwnProperty.call(i, "$lte") ? () => !0 : Object.prototype.hasOwnProperty.call(i, "$lt") && Object.prototype.hasOwnProperty.call(i, "$lte") ? this.compareKeys(i.$lte, i.$lt) === 0 ? (s) => this.compareKeys(s, i.$lt) < 0 : this.compareKeys(i.$lte, i.$lt) < 0 ? (s) => this.compareKeys(s, i.$lte) <= 0 : (s) => this.compareKeys(s, i.$lt) < 0 : Object.prototype.hasOwnProperty.call(i, "$lt") ? (s) => this.compareKeys(s, i.$lt) < 0 : (s) => this.compareKeys(s, i.$lte) <= 0;
    }
    /**
     * Get all data for a key between bounds
     * Return it in key order
     * @param {Object} query Mongo-style query where keys are $lt, $lte, $gt or $gte (other keys are not considered)
     * @param {Functions} lbm/ubm matching functions calculated at the first recursive step
     */
    betweenBounds(i, s, a) {
      const o = [];
      return Object.prototype.hasOwnProperty.call(this, "key") ? (s = s || this.getLowerBoundMatcher(i), a = a || this.getUpperBoundMatcher(i), s(this.key) && this.left && r(o, this.left.betweenBounds(i, s, a)), s(this.key) && a(this.key) && r(o, this.data), a(this.key) && this.right && r(o, this.right.betweenBounds(i, s, a)), o) : [];
    }
    /**
     * Delete the current node if it is a leaf
     * Return true if it was deleted
     */
    deleteIfLeaf() {
      return this.left || this.right ? !1 : this.parent ? (this.parent.left === this ? this.parent.left = null : this.parent.right = null, !0) : (delete this.key, this.data = [], !0);
    }
    /**
     * Delete the current node if it has only one child
     * Return true if it was deleted
     */
    deleteIfOnlyOneChild() {
      let i;
      return this.left && !this.right && (i = this.left), !this.left && this.right && (i = this.right), i ? this.parent ? (this.parent.left === this ? (this.parent.left = i, i.parent = this.parent) : (this.parent.right = i, i.parent = this.parent), !0) : (this.key = i.key, this.data = i.data, this.left = null, i.left && (this.left = i.left, i.left.parent = this), this.right = null, i.right && (this.right = i.right, i.right.parent = this), !0) : !1;
    }
    /**
     * Delete a key or just a value
     * @param {Key} key
     * @param {Value} value Optional. If not set, the whole key is deleted. If set, only this value is deleted
     */
    delete(i, s) {
      const a = [];
      let o;
      if (Object.prototype.hasOwnProperty.call(this, "key")) {
        if (this.compareKeys(i, this.key) < 0) {
          this.left && this.left.delete(i, s);
          return;
        }
        if (this.compareKeys(i, this.key) > 0) {
          this.right && this.right.delete(i, s);
          return;
        }
        if (!this.compareKeys(i, this.key) !== 0) {
          if (this.data.length > 1 && s !== void 0) {
            this.data.forEach((c) => {
              this.checkValueEquality(c, s) || a.push(c);
            }), this.data = a;
            return;
          }
          this.deleteIfLeaf() || this.deleteIfOnlyOneChild() || (Math.random() >= 0.5 ? (o = this.left.getMaxKeyDescendant(), this.key = o.key, this.data = o.data, this === o.parent ? (this.left = o.left, o.left && (o.left.parent = o.parent)) : (o.parent.right = o.left, o.left && (o.left.parent = o.parent))) : (o = this.right.getMinKeyDescendant(), this.key = o.key, this.data = o.data, this === o.parent ? (this.right = o.right, o.right && (o.right.parent = o.parent)) : (o.parent.left = o.right, o.right && (o.right.parent = o.parent))));
        }
      }
    }
    /**
     * Execute a function on every node of the tree, in key order
     * @param {Function} fn Signature: node. Most useful will probably be node.key and node.data
     */
    executeOnEveryNode(i) {
      this.left && this.left.executeOnEveryNode(i), i(this), this.right && this.right.executeOnEveryNode(i);
    }
    /**
     * Pretty print a tree
     * @param {Boolean} printData To print the nodes' data along with the key
     */
    prettyPrint(i, s) {
      s = s || "", console.log(`${s}* ${this.key}`), i && console.log(`${s}* ${this.data}`), !(!this.left && !this.right) && (this.left ? this.left.prettyPrint(i, `${s}  `) : console.log(`${s}  *`), this.right ? this.right.prettyPrint(i, `${s}  `) : console.log(`${s}  *`));
    }
  }
  function r(n, i) {
    for (let s = 0; s < i.length; s += 1)
      n.push(i[s]);
  }
  return yc = e, yc;
}
var gc, vd;
function g_() {
  if (vd) return gc;
  vd = 1;
  const t = qm(), e = zm();
  class r {
    /**
     * Constructor
     * We can't use a direct pointer to the root node (as in the simple binary search tree)
     * as the root will change during tree rotations
     * @param {Boolean}  options.unique Whether to enforce a 'unique' constraint on the key or not
     * @param {Function} options.compareKeys Initialize this BST's compareKeys
     */
    constructor(s) {
      this.tree = new n(s);
    }
    checkIsAVLT() {
      this.tree.checkIsAVLT();
    }
    // Insert in the internal tree, update the pointer to the root if needed
    insert(s, a) {
      const o = this.tree.insert(s, a);
      o && (this.tree = o);
    }
    // Delete a value
    delete(s, a) {
      const o = this.tree.delete(s, a);
      o && (this.tree = o);
    }
  }
  class n extends t {
    /**
     * Constructor of the internal AVLTree
     * @param {Object} options Optional
     * @param {Boolean}  options.unique Whether to enforce a 'unique' constraint on the key or not
     * @param {Key}      options.key Initialize this BST's key with key
     * @param {Value}    options.value Initialize this BST's data with [value]
     * @param {Function} options.compareKeys Initialize this BST's compareKeys
     */
    constructor(s) {
      super(), s = s || {}, this.left = null, this.right = null, this.parent = s.parent !== void 0 ? s.parent : null, Object.prototype.hasOwnProperty.call(s, "key") && (this.key = s.key), this.data = Object.prototype.hasOwnProperty.call(s, "value") ? [s.value] : [], this.unique = s.unique || !1, this.compareKeys = s.compareKeys || e.defaultCompareKeysFunction, this.checkValueEquality = s.checkValueEquality || e.defaultCheckValueEquality;
    }
    /**
     * Check the recorded height is correct for every node
     * Throws if one height doesn't match
     */
    checkHeightCorrect() {
      if (!Object.prototype.hasOwnProperty.call(this, "key"))
        return;
      if (this.left && this.left.height === void 0)
        throw new Error("Undefined height for node " + this.left.key);
      if (this.right && this.right.height === void 0)
        throw new Error("Undefined height for node " + this.right.key);
      if (this.height === void 0)
        throw new Error("Undefined height for node " + this.key);
      const s = this.left ? this.left.height : 0, a = this.right ? this.right.height : 0;
      if (this.height !== 1 + Math.max(s, a))
        throw new Error("Height constraint failed for node " + this.key);
      this.left && this.left.checkHeightCorrect(), this.right && this.right.checkHeightCorrect();
    }
    /**
     * Return the balance factor
     */
    balanceFactor() {
      const s = this.left ? this.left.height : 0, a = this.right ? this.right.height : 0;
      return s - a;
    }
    /**
     * Check that the balance factors are all between -1 and 1
     */
    checkBalanceFactors() {
      if (Math.abs(this.balanceFactor()) > 1)
        throw new Error("Tree is unbalanced at node " + this.key);
      this.left && this.left.checkBalanceFactors(), this.right && this.right.checkBalanceFactors();
    }
    /**
     * When checking if the BST conditions are met, also check that the heights are correct
     * and the tree is balanced
     */
    checkIsAVLT() {
      super.checkIsBST(), this.checkHeightCorrect(), this.checkBalanceFactors();
    }
    /**
     * Perform a right rotation of the tree if possible
     * and return the root of the resulting tree
     * The resulting tree's nodes' heights are also updated
     */
    rightRotation() {
      const s = this, a = this.left;
      if (!a) return s;
      const o = a.right;
      s.parent ? (a.parent = s.parent, s.parent.left === s ? s.parent.left = a : s.parent.right = a) : a.parent = null, a.right = s, s.parent = a, s.left = o, o && (o.parent = s);
      const c = a.left ? a.left.height : 0, h = o ? o.height : 0, f = s.right ? s.right.height : 0;
      return s.height = Math.max(h, f) + 1, a.height = Math.max(c, s.height) + 1, a;
    }
    /**
     * Perform a left rotation of the tree if possible
     * and return the root of the resulting tree
     * The resulting tree's nodes' heights are also updated
     */
    leftRotation() {
      const s = this, a = this.right;
      if (!a)
        return this;
      const o = a.left;
      s.parent ? (a.parent = s.parent, s.parent.left === s ? s.parent.left = a : s.parent.right = a) : a.parent = null, a.left = s, s.parent = a, s.right = o, o && (o.parent = s);
      const c = s.left ? s.left.height : 0, h = o ? o.height : 0, f = a.right ? a.right.height : 0;
      return s.height = Math.max(c, h) + 1, a.height = Math.max(f, s.height) + 1, a;
    }
    /**
     * Modify the tree if its right subtree is too small compared to the left
     * Return the new root if any
     */
    rightTooSmall() {
      return this.balanceFactor() <= 1 ? this : (this.left.balanceFactor() < 0 && this.left.leftRotation(), this.rightRotation());
    }
    /**
     * Modify the tree if its left subtree is too small compared to the right
     * Return the new root if any
     */
    leftTooSmall() {
      return this.balanceFactor() >= -1 ? this : (this.right.balanceFactor() > 0 && this.right.rightRotation(), this.leftRotation());
    }
    /**
     * Rebalance the tree along the given path. The path is given reversed (as he was calculated
     * in the insert and delete functions).
     * Returns the new root of the tree
     * Of course, the first element of the path must be the root of the tree
     */
    rebalanceAlongPath(s) {
      let a = this, o, c;
      if (!Object.prototype.hasOwnProperty.call(this, "key"))
        return delete this.height, this;
      for (c = s.length - 1; c >= 0; c -= 1)
        s[c].height = 1 + Math.max(s[c].left ? s[c].left.height : 0, s[c].right ? s[c].right.height : 0), s[c].balanceFactor() > 1 && (o = s[c].rightTooSmall(), c === 0 && (a = o)), s[c].balanceFactor() < -1 && (o = s[c].leftTooSmall(), c === 0 && (a = o));
      return a;
    }
    /**
     * Insert a key, value pair in the tree while maintaining the AVL tree height constraint
     * Return a pointer to the root node, which may have changed
     */
    insert(s, a) {
      const o = [];
      let c = this;
      if (!Object.prototype.hasOwnProperty.call(this, "key"))
        return this.key = s, this.data.push(a), this.height = 1, this;
      for (; ; ) {
        if (c.compareKeys(c.key, s) === 0) {
          if (c.unique) {
            const h = new Error(`Can't insert key ${JSON.stringify(s)}, it violates the unique constraint`);
            throw h.key = s, h.errorType = "uniqueViolated", h;
          } else c.data.push(a);
          return this;
        }
        if (o.push(c), c.compareKeys(s, c.key) < 0)
          if (c.left)
            c = c.left;
          else {
            o.push(c.createLeftChild({ key: s, value: a }));
            break;
          }
        else if (c.right)
          c = c.right;
        else {
          o.push(c.createRightChild({ key: s, value: a }));
          break;
        }
      }
      return this.rebalanceAlongPath(o);
    }
    /**
     * Delete a key or just a value and return the new root of the tree
     * @param {Key} key
     * @param {Value} value Optional. If not set, the whole key is deleted. If set, only this value is deleted
     */
    delete(s, a) {
      const o = [];
      let c, h = this;
      const f = [];
      if (!Object.prototype.hasOwnProperty.call(this, "key")) return this;
      for (; h.compareKeys(s, h.key) !== 0; )
        if (f.push(h), h.compareKeys(s, h.key) < 0)
          if (h.left)
            h = h.left;
          else return this;
        else if (h.right)
          h = h.right;
        else return this;
      if (h.data.length > 1 && a !== void 0)
        return h.data.forEach(function(u) {
          h.checkValueEquality(u, a) || o.push(u);
        }), h.data = o, this;
      if (!h.left && !h.right)
        return h === this ? (delete h.key, h.data = [], delete h.height, this) : (h.parent.left === h ? h.parent.left = null : h.parent.right = null, this.rebalanceAlongPath(f));
      if (!h.left || !h.right)
        return c = h.left ? h.left : h.right, h === this ? (c.parent = null, c) : (h.parent.left === h ? (h.parent.left = c, c.parent = h.parent) : (h.parent.right = c, c.parent = h.parent), this.rebalanceAlongPath(f));
      if (f.push(h), c = h.left, !c.right)
        return h.key = c.key, h.data = c.data, h.left = c.left, c.left && (c.left.parent = h), this.rebalanceAlongPath(f);
      for (; c.right; )
        f.push(c), c = c.right;
      return h.key = c.key, h.data = c.data, c.parent.right = c.left, c.left && (c.left.parent = c.parent), this.rebalanceAlongPath(f);
    }
  }
  return r._AVLTree = n, ["getNumberOfKeys", "search", "betweenBounds", "prettyPrint", "executeOnEveryNode"].forEach(function(i) {
    r.prototype[i] = function() {
      return this.tree[i].apply(this.tree, arguments);
    };
  }), gc = r, gc;
}
var Ed;
function w_() {
  return Ed || (Ed = 1, xs.BinarySearchTree = qm(), xs.AVLTree = g_()), xs;
}
var wc, bd;
function Um() {
  if (bd) return wc;
  bd = 1;
  const t = w_().AVLTree, e = Ea(), { uniq: r, isDate: n } = Nh(), i = (o, c) => o === c, s = (o) => o === null ? "$null" : typeof o == "string" ? "$string" + o : typeof o == "boolean" ? "$boolean" + o : typeof o == "number" ? "$number" + o : n(o) ? "$date" + o.getTime() : o;
  class a {
    /**
     * Create a new index
     * All methods on an index guarantee that either the whole operation was successful and the index changed
     * or the operation was unsuccessful and an error is thrown while the index is unchanged
     * @param {object} options
     * @param {string} options.fieldName On which field should the index apply, can use dot notation to index on sub fields, can use comma-separated notation to use compound indexes
     * @param {boolean} [options.unique = false] Enforces a unique constraint
     * @param {boolean} [options.sparse = false] Allows a sparse index (we can have documents for which fieldName is `undefined`)
     */
    constructor(c) {
      if (this.fieldName = c.fieldName, typeof this.fieldName != "string") throw new Error("fieldName must be a string");
      this._fields = this.fieldName.split(","), this.unique = c.unique || !1, this.sparse = c.sparse || !1, this.treeOptions = { unique: this.unique, compareKeys: e.compareThings, checkValueEquality: i }, this.tree = new t(this.treeOptions);
    }
    /**
     * Reset an index
     * @param {?document|?document[]} [newData] Data to initialize the index with. If an error is thrown during
     * insertion, the index is not modified.
     */
    reset(c) {
      this.tree = new t(this.treeOptions), c && this.insert(c);
    }
    /**
     * Insert a new document in the index
     * If an array is passed, we insert all its elements (if one insertion fails the index is not modified)
     * O(log(n))
     * @param {document|document[]} doc The document, or array of documents, to insert.
     */
    insert(c) {
      let h, f, u;
      if (Array.isArray(c)) {
        this.insertMultipleDocs(c);
        return;
      }
      const l = e.getDotValues(c, this._fields);
      if (!((l === void 0 || typeof l == "object" && l !== null && Object.values(l).every((d) => d === void 0)) && this.sparse))
        if (!Array.isArray(l)) this.tree.insert(l, c);
        else {
          h = r(l, s);
          for (let d = 0; d < h.length; d += 1)
            try {
              this.tree.insert(h[d], c);
            } catch (g) {
              u = g, f = d;
              break;
            }
          if (u) {
            for (let d = 0; d < f; d += 1)
              this.tree.delete(h[d], c);
            throw u;
          }
        }
    }
    /**
     * Insert an array of documents in the index
     * If a constraint is violated, the changes should be rolled back and an error thrown
     * @param {document[]} docs Array of documents to insert.
     * @private
     */
    insertMultipleDocs(c) {
      let h, f;
      for (let u = 0; u < c.length; u += 1)
        try {
          this.insert(c[u]);
        } catch (l) {
          h = l, f = u;
          break;
        }
      if (h) {
        for (let u = 0; u < f; u += 1)
          this.remove(c[u]);
        throw h;
      }
    }
    /**
     * Removes a document from the index.
     * If an array is passed, we remove all its elements
     * The remove operation is safe with regards to the 'unique' constraint
     * O(log(n))
     * @param {document[]|document} doc The document, or Array of documents, to remove.
     */
    remove(c) {
      if (Array.isArray(c)) {
        c.forEach((f) => {
          this.remove(f);
        });
        return;
      }
      const h = e.getDotValues(c, this._fields);
      h === void 0 && this.sparse || (Array.isArray(h) ? r(h, s).forEach((f) => {
        this.tree.delete(f, c);
      }) : this.tree.delete(h, c));
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
    update(c, h) {
      if (Array.isArray(c)) {
        this.updateMultipleDocs(c);
        return;
      }
      this.remove(c);
      try {
        this.insert(h);
      } catch (f) {
        throw this.insert(c), f;
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
    updateMultipleDocs(c) {
      let h, f;
      for (let u = 0; u < c.length; u += 1)
        this.remove(c[u].oldDoc);
      for (let u = 0; u < c.length; u += 1)
        try {
          this.insert(c[u].newDoc);
        } catch (l) {
          f = l, h = u;
          break;
        }
      if (f) {
        for (let u = 0; u < h; u += 1)
          this.remove(c[u].newDoc);
        for (let u = 0; u < c.length; u += 1)
          this.insert(c[u].oldDoc);
        throw f;
      }
    }
    /**
     * Revert an update
     * @param {document|Array.<{oldDoc: document, newDoc: document}>} oldDoc Document to revert to, or an `Array` of `{oldDoc, newDoc}` pairs.
     * @param {document} [newDoc] Document to revert from. If the first argument is an Array of {oldDoc, newDoc}, this second argument is ignored.
     */
    revertUpdate(c, h) {
      const f = [];
      Array.isArray(c) ? (c.forEach((u) => {
        f.push({ oldDoc: u.newDoc, newDoc: u.oldDoc });
      }), this.update(f)) : this.update(h, c);
    }
    /**
     * Get all documents in index whose key match value (if it is a Thing) or one of the elements of value (if it is an array of Things)
     * @param {Array.<*>|*} value Value to match the key against
     * @return {document[]}
     */
    getMatching(c) {
      if (Array.isArray(c)) {
        const h = {}, f = [];
        return c.forEach((u) => {
          this.getMatching(u).forEach((l) => {
            h[l._id] = l;
          });
        }), Object.keys(h).forEach((u) => {
          f.push(h[u]);
        }), f;
      } else
        return this.tree.search(c);
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
    getBetweenBounds(c) {
      return this.tree.betweenBounds(c);
    }
    /**
     * Get all elements in the index
     * @return {document[]}
     */
    getAll() {
      const c = [];
      return this.tree.executeOnEveryNode((h) => {
        c.push(...h.data);
      }), c;
    }
  }
  return wc = a, wc;
}
var _c, Sd;
function __() {
  if (Sd) return _c;
  Sd = 1;
  const t = ca, e = Xp, { Buffer: r } = Wp, n = (s, a) => {
    if (!s) throw new Error("expected readStream");
    if (!s.readable) throw new Error("readStream must be readable");
    const o = new i(a);
    return s.pipe(o), o;
  };
  class i extends t.Transform {
    constructor(a) {
      super(a), a = a || {}, this._readableState.objectMode = !0, this._lineBuffer = [], this._keepEmptyLines = a.keepEmptyLines || !1, this._lastChunkEndedWithCR = !1, this.once("pipe", (o) => {
        !this.encoding && o instanceof t.Readable && (this.encoding = o._readableState.encoding);
      });
    }
    _transform(a, o, c) {
      o = o || "utf8", r.isBuffer(a) && (o === "buffer" ? (a = a.toString(), o = "utf8") : a = a.toString(o)), this._chunkEncoding = o;
      const h = a.split(/\r\n|[\n\v\f\r\x85\u2028\u2029]/g);
      this._lastChunkEndedWithCR && a[0] === `
` && h.shift(), this._lineBuffer.length > 0 && (this._lineBuffer[this._lineBuffer.length - 1] += h[0], h.shift()), this._lastChunkEndedWithCR = a[a.length - 1] === "\r", this._lineBuffer = this._lineBuffer.concat(h), this._pushBuffer(o, 1, c);
    }
    _pushBuffer(a, o, c) {
      for (; this._lineBuffer.length > o; ) {
        const h = this._lineBuffer.shift();
        if ((this._keepEmptyLines || h.length > 0) && !this.push(this._reencode(h, a))) {
          e.setImmediate(() => {
            this._pushBuffer(a, o, c);
          });
          return;
        }
      }
      c();
    }
    _flush(a) {
      this._pushBuffer(this._chunkEncoding, 0, a);
    }
    // see Readable::push
    _reencode(a, o) {
      return this.encoding && this.encoding !== o ? r.from(a, o).toString(this.encoding) : this.encoding ? a : r.from(a, o);
    }
  }
  return _c = n, _c;
}
var de = {}, Md;
function v_() {
  if (Md) return de;
  Md = 1;
  const t = Gr, e = t.promises, r = lt, { Readable: n } = ca, i = 493, s = 420, a = (y) => e.access(y, t.constants.F_OK).then(() => !0, () => !1), o = e.rename, c = e.writeFile, h = t.createWriteStream, f = e.unlink, u = e.appendFile, l = e.readFile, d = t.createReadStream, g = e.mkdir, w = async (y) => {
    await a(y) && await f(y);
  }, m = async (y) => {
    let b, S, x;
    typeof y == "string" ? (b = y, S = "r+", x = s) : (b = y.filename, S = y.isDir ? "r" : "r+", x = y.mode !== void 0 ? y.mode : s);
    let M, k, $;
    try {
      M = await e.open(b, S, x);
      try {
        await M.sync();
      } catch (O) {
        k = O;
      }
    } catch (O) {
      if (O.code !== "EISDIR" || !y.isDir) throw O;
    } finally {
      try {
        await M.close();
      } catch (O) {
        $ = O;
      }
    }
    if ((k || $) && !((k.code === "EPERM" || $.code === "EISDIR") && y.isDir)) {
      const O = new Error("Failed to flush to storage");
      throw O.errorOnFsync = k, O.errorOnClose = $, O;
    }
  }, v = (y, b, S = s) => new Promise((x, M) => {
    try {
      const k = h(y, { mode: S }), $ = n.from(b);
      $.on("data", (O) => {
        try {
          k.write(O + `
`);
        } catch (T) {
          M(T);
        }
      }), $.on("end", () => {
        k.close((O) => {
          O ? M(O) : x();
        });
      }), $.on("error", (O) => {
        M(O);
      }), k.on("error", (O) => {
        M(O);
      });
    } catch (k) {
      M(k);
    }
  }), p = async (y, b, S = { fileMode: s, dirMode: i }) => {
    const x = y + "~";
    await m({ filename: r.dirname(y), isDir: !0, mode: S.dirMode }), await a(y) && await m({ filename: y, mode: S.fileMode }), await v(x, b, S.fileMode), await m({ filename: x, mode: S.fileMode }), await o(x, y), await m({ filename: r.dirname(y), isDir: !0, mode: S.dirMode });
  }, E = async (y, b = s) => {
    const S = y + "~";
    if (await a(y)) return;
    await a(S) ? await o(S, y) : await c(y, "", { encoding: "utf8", mode: b });
  }, _ = async (y, b) => {
    const S = r.dirname(y), x = r.parse(r.resolve(S));
    (process.platform !== "win32" || x.dir !== x.root || x.base !== "") && await g(S, { recursive: !0, mode: b });
  };
  return de.existsAsync = a, de.renameAsync = o, de.writeFileAsync = c, de.writeFileLinesAsync = v, de.crashSafeWriteFileLinesAsync = p, de.appendFileAsync = u, de.readFileAsync = l, de.unlinkAsync = f, de.mkdirAsync = g, de.readFileStream = d, de.flushToStorageAsync = m, de.ensureDatafileIntegrityAsync = E, de.ensureFileDoesntExistAsync = w, de.ensureParentDirectoryExistsAsync = _, de;
}
var vc, xd;
function E_() {
  if (xd) return vc;
  xd = 1;
  const { deprecate: t } = ha, e = __(), r = Um(), n = Ea(), i = v_(), s = Gm(), a = 493, o = 420;
  class c {
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
    constructor(f) {
      if (this.db = f.db, this.inMemoryOnly = this.db.inMemoryOnly, this.filename = this.db.filename, this.corruptAlertThreshold = f.corruptAlertThreshold !== void 0 ? f.corruptAlertThreshold : 0.1, this.modes = f.modes !== void 0 ? f.modes : {
        fileMode: o,
        dirMode: a
      }, this.modes.fileMode === void 0 && (this.modes.fileMode = o), this.modes.dirMode === void 0 && (this.modes.dirMode = a), !this.inMemoryOnly && this.filename && this.filename.charAt(this.filename.length - 1) === "~") throw new Error("The datafile name can't end with a ~, which is reserved for crash safe backup files");
      if (f.afterSerialization && !f.beforeDeserialization) throw new Error("Serialization hook defined but deserialization hook undefined, cautiously refusing to start NeDB to prevent dataloss");
      if (!f.afterSerialization && f.beforeDeserialization) throw new Error("Serialization hook undefined but deserialization hook defined, cautiously refusing to start NeDB to prevent dataloss");
      this.afterSerialization = async (u) => (f.afterSerialization || ((l) => l))(u), this.beforeDeserialization = async (u) => (f.beforeDeserialization || ((l) => l))(u);
    }
    /**
     * Internal version without using the {@link Datastore#executor} of {@link Datastore#compactDatafileAsync}, use it instead.
     * @return {Promise<void>}
     * @private
     */
    async persistCachedDatabaseAsync() {
      const f = [];
      if (!this.inMemoryOnly) {
        for (const u of this.db.getAllData())
          f.push(await this.afterSerialization(n.serialize(u)));
        for (const u of Object.keys(this.db.indexes))
          u !== "_id" && f.push(await this.afterSerialization(n.serialize({
            $$indexCreated: {
              fieldName: this.db.indexes[u].fieldName,
              unique: this.db.indexes[u].unique,
              sparse: this.db.indexes[u].sparse
            }
          })));
        await i.crashSafeWriteFileLinesAsync(this.filename, f, this.modes), this.db.emit("compaction.done");
      }
    }
    /**
     * @see Datastore#compactDatafile
     * @deprecated
     * @param {NoParamCallback} [callback = () => {}]
     * @see Persistence#compactDatafileAsync
     */
    compactDatafile(f) {
      t((u) => this.db.compactDatafile(u), "@seald-io/nedb: calling Datastore#persistence#compactDatafile is deprecated, please use Datastore#compactDatafile, it will be removed in the next major version.")(f);
    }
    /**
     * @see Datastore#setAutocompactionInterval
     * @deprecated
     */
    setAutocompactionInterval(f) {
      t((u) => this.db.setAutocompactionInterval(u), "@seald-io/nedb: calling Datastore#persistence#setAutocompactionInterval is deprecated, please use Datastore#setAutocompactionInterval, it will be removed in the next major version.")(f);
    }
    /**
     * @see Datastore#stopAutocompaction
     * @deprecated
     */
    stopAutocompaction() {
      t(() => this.db.stopAutocompaction(), "@seald-io/nedb: calling Datastore#persistence#stopAutocompaction is deprecated, please use Datastore#stopAutocompaction, it will be removed in the next major version.")();
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
    async persistNewStateAsync(f) {
      let u = "";
      if (!this.inMemoryOnly) {
        for (const l of f)
          u += await this.afterSerialization(n.serialize(l)) + `
`;
        u.length !== 0 && await i.appendFileAsync(this.filename, u, { encoding: "utf8", mode: this.modes.fileMode });
      }
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
    async treatRawData(f) {
      const u = f.split(`
`).filter((v) => v !== "").map(async (v) => n.deserialize(await this.beforeDeserialization(v))), l = {}, d = {}, g = u.length;
      let w = 0;
      for (const v of u)
        try {
          const p = await v;
          p._id ? p.$$deleted === !0 ? delete l[p._id] : l[p._id] = p : p.$$indexCreated && p.$$indexCreated.fieldName != null ? d[p.$$indexCreated.fieldName] = p.$$indexCreated : typeof p.$$indexRemoved == "string" && delete d[p.$$indexRemoved];
        } catch {
          w += 1;
        }
      if (g > 0) {
        const v = w / g;
        if (v > this.corruptAlertThreshold) {
          const p = new Error(`${Math.floor(100 * v)}% of the data file is corrupt, more than given corruptAlertThreshold (${Math.floor(100 * this.corruptAlertThreshold)}%). Cautiously refusing to start NeDB to prevent dataloss.`);
          throw p.corruptionRate = v, p.corruptItems = w, p.dataLength = g, p;
        }
      }
      return { data: Object.values(l), indexes: d };
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
    treatRawStreamAsync(f) {
      return new Promise((u, l) => {
        const d = {}, g = {};
        let w = 0;
        const m = e(f);
        let v = 0;
        const p = new s();
        m.on("data", (E) => {
          const _ = this.beforeDeserialization(E);
          return p.waterfall(async () => {
            if (E !== "") {
              try {
                const y = n.deserialize(await _);
                y._id ? y.$$deleted === !0 ? delete d[y._id] : d[y._id] = y : y.$$indexCreated && y.$$indexCreated.fieldName != null ? g[y.$$indexCreated.fieldName] = y.$$indexCreated : typeof y.$$indexRemoved == "string" && delete g[y.$$indexRemoved];
              } catch {
                w += 1;
              }
              v++;
            }
          })();
        }), m.on("end", async () => {
          if (await p.guardian, v > 0) {
            const _ = w / v;
            if (_ > this.corruptAlertThreshold) {
              const y = new Error(`${Math.floor(100 * _)}% of the data file is corrupt, more than given corruptAlertThreshold (${Math.floor(100 * this.corruptAlertThreshold)}%). Cautiously refusing to start NeDB to prevent dataloss.`);
              y.corruptionRate = _, y.corruptItems = w, y.dataLength = v, l(y, null);
              return;
            }
          }
          const E = Object.values(d);
          u({ data: E, indexes: g });
        }), m.on("error", function(E) {
          l(E, null);
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
      if (this.db._resetIndexes(), this.inMemoryOnly) return;
      await c.ensureParentDirectoryExistsAsync(this.filename, this.modes.dirMode), await i.ensureDatafileIntegrityAsync(this.filename, this.modes.fileMode);
      let f;
      if (i.readFileStream) {
        const u = i.readFileStream(this.filename, { encoding: "utf8", mode: this.modes.fileMode });
        f = await this.treatRawStreamAsync(u);
      } else {
        const u = await i.readFileAsync(this.filename, { encoding: "utf8", mode: this.modes.fileMode });
        f = await this.treatRawData(u);
      }
      Object.keys(f.indexes).forEach((u) => {
        this.db.indexes[u] = new r(f.indexes[u]);
      });
      try {
        this.db._resetIndexes(f.data);
      } catch (u) {
        throw this.db._resetIndexes(), u;
      }
      await this.db.persistence.persistCachedDatabaseAsync(), this.db.executor.processBuffer();
    }
    /**
     * See {@link Datastore#dropDatabaseAsync}. This function uses {@link Datastore#executor} internally. Decorating this
     * function with an {@link Executor#pushAsync} will result in a deadlock.
     * @return {Promise<void>}
     * @private
     * @see Datastore#dropDatabaseAsync
     */
    async dropDatabaseAsync() {
      this.db.stopAutocompaction(), this.db.executor.ready = !1, this.db.executor.resetBuffer(), await this.db.executor.queue.guardian, this.db.indexes = {}, this.db.indexes._id = new r({ fieldName: "_id", unique: !0 }), this.db.ttlIndexes = {}, this.db.inMemoryOnly || await this.db.executor.pushAsync(async () => {
        await i.existsAsync(this.filename) && await i.unlinkAsync(this.filename);
      }, !0);
    }
    /**
     * Check if a directory stat and create it on the fly if it is not the case.
     * @param {string} dir
     * @param {number} [mode=0o777]
     * @return {Promise<void>}
     * @private
     */
    static async ensureParentDirectoryExistsAsync(f, u = a) {
      return i.ensureParentDirectoryExistsAsync(f, u);
    }
  }
  return vc = c, vc;
}
var Ec, kd;
function b_() {
  if (kd) return Ec;
  kd = 1;
  const { EventEmitter: t } = Hp, { callbackify: e, deprecate: r } = ha, n = m_(), i = p_(), s = y_(), a = Um(), o = Ea(), c = E_(), { isDate: h, pick: f, filterIndexNames: u } = Nh();
  class l extends t {
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
    constructor(g) {
      super();
      let w;
      typeof g == "string" ? r(() => {
        w = g, this.inMemoryOnly = !1;
      }, "@seald-io/nedb: Giving a string to the Datastore constructor is deprecated and will be removed in the next major version. Please use an options object with an argument 'filename'.")() : (g = g || {}, w = g.filename, this.inMemoryOnly = g.inMemoryOnly || !1, this.autoload = g.autoload || !1, this.timestampData = g.timestampData || !1), !w || typeof w != "string" || w.length === 0 ? (this.filename = null, this.inMemoryOnly = !0) : this.filename = w, this.compareStrings = g.compareStrings, this.persistence = new c({
        db: this,
        afterSerialization: g.afterSerialization,
        beforeDeserialization: g.beforeDeserialization,
        corruptAlertThreshold: g.corruptAlertThreshold,
        modes: g.modes,
        testSerializationHooks: g.testSerializationHooks
      }), this.executor = new s(), this.inMemoryOnly && (this.executor.ready = !0), this.indexes = {}, this.indexes._id = new a({ fieldName: "_id", unique: !0 }), this.ttlIndexes = {}, this.autoload ? (this.autoloadPromise = this.loadDatabaseAsync(), this.autoloadPromise.then(() => {
        g.onload && g.onload();
      }, (m) => {
        if (g.onload) g.onload(m);
        else throw m;
      })) : this.autoloadPromise = null, this._autocompactionIntervalId = null;
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
    compactDatafile(g) {
      const w = this.compactDatafileAsync();
      typeof g == "function" && e(() => w)(g);
    }
    /**
     * Set automatic compaction every `interval` ms
     * @param {Number} interval in milliseconds, with an enforced minimum of 5000 milliseconds
     */
    setAutocompactionInterval(g) {
      if (Number.isNaN(Number(g))) throw new Error("Interval must be a non-NaN number");
      const m = Math.max(Number(g), 5e3);
      this.stopAutocompaction(), this._autocompactionIntervalId = setInterval(() => {
        this.compactDatafile();
      }, m);
    }
    /**
     * Stop autocompaction (do nothing if automatic compaction was not running)
     */
    stopAutocompaction() {
      this._autocompactionIntervalId && (clearInterval(this._autocompactionIntervalId), this._autocompactionIntervalId = null);
    }
    /**
     * Callback version of {@link Datastore#loadDatabaseAsync}.
     * @param {NoParamCallback} [callback]
     * @see Datastore#loadDatabaseAsync
     */
    loadDatabase(g) {
      const w = this.loadDatabaseAsync();
      typeof g == "function" && e(() => w)(g);
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
    dropDatabase(g) {
      const w = this.dropDatabaseAsync();
      typeof g == "function" && e(() => w)(g);
    }
    /**
     * Load the database from the datafile, and trigger the execution of buffered commands if any.
     * @async
     * @return {Promise}
     */
    loadDatabaseAsync() {
      return this.executor.pushAsync(() => this.persistence.loadDatabaseAsync(), !0);
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
    _resetIndexes(g) {
      for (const w of Object.values(this.indexes))
        w.reset(g);
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
    ensureIndex(g = {}, w) {
      const m = this.ensureIndexAsync(g);
      typeof w == "function" && e(() => m)(w);
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
    async ensureIndexAsync(g = {}) {
      if (!g.fieldName) {
        const v = new Error("Cannot create an index without a fieldName");
        throw v.missingFieldName = !0, v;
      }
      const w = [].concat(g.fieldName).sort();
      if (w.some((v) => v.includes(",")))
        throw new Error("Cannot use comma in index fieldName");
      const m = {
        ...g,
        fieldName: w.join(",")
      };
      if (!this.indexes[m.fieldName]) {
        this.indexes[m.fieldName] = new a(m), g.expireAfterSeconds !== void 0 && (this.ttlIndexes[m.fieldName] = m.expireAfterSeconds);
        try {
          this.indexes[m.fieldName].insert(this.getAllData());
        } catch (v) {
          throw delete this.indexes[m.fieldName], v;
        }
        await this.executor.pushAsync(() => this.persistence.persistNewStateAsync([{ $$indexCreated: m }]), !0);
      }
    }
    /**
     * Callback version of {@link Datastore#removeIndexAsync}.
     * @param {string} fieldName
     * @param {NoParamCallback} [callback]
     * @see Datastore#removeIndexAsync
     */
    removeIndex(g, w = () => {
    }) {
      const m = this.removeIndexAsync(g);
      e(() => m)(w);
    }
    /**
     * Remove an index.
     * @param {string} fieldName Field name of the index to remove. Use the dot notation to remove an index referring to a
     * field in a nested document.
     * @return {Promise<void>}
     * @see Datastore#removeIndex
     */
    async removeIndexAsync(g) {
      delete this.indexes[g], await this.executor.pushAsync(() => this.persistence.persistNewStateAsync([{ $$indexRemoved: g }]), !0);
    }
    /**
     * Add one or several document(s) to all indexes.
     *
     * This is an internal function.
     * @param {document} doc
     * @private
     */
    _addToIndexes(g) {
      let w, m;
      const v = Object.keys(this.indexes);
      for (let p = 0; p < v.length; p += 1)
        try {
          this.indexes[v[p]].insert(g);
        } catch (E) {
          w = p, m = E;
          break;
        }
      if (m) {
        for (let p = 0; p < w; p += 1)
          this.indexes[v[p]].remove(g);
        throw m;
      }
    }
    /**
     * Remove one or several document(s) from all indexes.
     *
     * This is an internal function.
     * @param {document} doc
     * @private
     */
    _removeFromIndexes(g) {
      for (const w of Object.values(this.indexes))
        w.remove(g);
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
    _updateIndexes(g, w) {
      let m, v;
      const p = Object.keys(this.indexes);
      for (let E = 0; E < p.length; E += 1)
        try {
          this.indexes[p[E]].update(g, w);
        } catch (_) {
          m = E, v = _;
          break;
        }
      if (v) {
        for (let E = 0; E < m; E += 1)
          this.indexes[p[E]].revertUpdate(g, w);
        throw v;
      }
    }
    /**
     * Get all candidate documents matching the query, regardless of their expiry status.
     * @param {query} query
     * @return {document[]}
     *
     * @private
     */
    _getRawCandidates(g) {
      const w = Object.keys(this.indexes);
      let m;
      if (m = Object.entries(g).filter(u(w)).pop(), m) return this.indexes[m[0]].getMatching(m[1]);
      const v = w.filter((p) => p.indexOf(",") !== -1).map((p) => p.split(",")).filter(
        (p) => Object.entries(g).filter(u(p)).length === p.length
      );
      return v.length > 0 ? this.indexes[v[0]].getMatching(f(g, v[0])) : (m = Object.entries(g).filter(
        ([p, E]) => !!(g[p] && Object.prototype.hasOwnProperty.call(g[p], "$in")) && w.includes(p)
      ).pop(), m ? this.indexes[m[0]].getMatching(m[1].$in) : (m = Object.entries(g).filter(
        ([p, E]) => !!(g[p] && (Object.prototype.hasOwnProperty.call(g[p], "$lt") || Object.prototype.hasOwnProperty.call(g[p], "$lte") || Object.prototype.hasOwnProperty.call(g[p], "$gt") || Object.prototype.hasOwnProperty.call(g[p], "$gte"))) && w.includes(p)
      ).pop(), m ? this.indexes[m[0]].getBetweenBounds(m[1]) : this.getAllData()));
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
    async _getCandidatesAsync(g, w = !1) {
      const m = [], v = this._getRawCandidates(g);
      if (w)
        m.push(...v);
      else {
        const p = [], E = Object.keys(this.ttlIndexes);
        v.forEach((_) => {
          E.every((y) => !(_[y] !== void 0 && h(_[y]) && Date.now() > _[y].getTime() + this.ttlIndexes[y] * 1e3)) ? m.push(_) : p.push(_._id);
        });
        for (const _ of p)
          await this._removeAsync({ _id: _ }, {});
      }
      return m;
    }
    /**
     * Insert a new document
     * This is an internal function, use {@link Datastore#insertAsync} which has the same signature.
     * @param {document|document[]} newDoc
     * @return {Promise<document|document[]>}
     * @private
     */
    async _insertAsync(g) {
      const w = this._prepareDocumentForInsertion(g);
      return this._insertInCache(w), await this.persistence.persistNewStateAsync(Array.isArray(w) ? w : [w]), o.deepCopy(w);
    }
    /**
     * Create a new _id that's not already in use
     * @return {string} id
     * @private
     */
    _createNewId() {
      let g = i.uid(16);
      return this.indexes._id.getMatching(g).length > 0 && (g = this._createNewId()), g;
    }
    /**
     * Prepare a document (or array of documents) to be inserted in a database
     * Meaning adds _id and timestamps if necessary on a copy of newDoc to avoid any side effect on user input
     * @param {document|document[]} newDoc document, or Array of documents, to prepare
     * @return {document|document[]} prepared document, or Array of prepared documents
     * @private
     */
    _prepareDocumentForInsertion(g) {
      let w;
      if (Array.isArray(g))
        w = [], g.forEach((m) => {
          w.push(this._prepareDocumentForInsertion(m));
        });
      else {
        w = o.deepCopy(g), w._id === void 0 && (w._id = this._createNewId());
        const m = /* @__PURE__ */ new Date();
        this.timestampData && w.createdAt === void 0 && (w.createdAt = m), this.timestampData && w.updatedAt === void 0 && (w.updatedAt = m), o.checkObject(w);
      }
      return w;
    }
    /**
     * If newDoc is an array of documents, this will insert all documents in the cache
     * @param {document|document[]} preparedDoc
     * @private
     */
    _insertInCache(g) {
      Array.isArray(g) ? this._insertMultipleDocsInCache(g) : this._addToIndexes(g);
    }
    /**
     * If one insertion fails (e.g. because of a unique constraint), roll back all previous
     * inserts and throws the error
     * @param {document[]} preparedDocs
     * @private
     */
    _insertMultipleDocsInCache(g) {
      let w, m;
      for (let v = 0; v < g.length; v += 1)
        try {
          this._addToIndexes(g[v]);
        } catch (p) {
          m = p, w = v;
          break;
        }
      if (m) {
        for (let v = 0; v < w; v += 1)
          this._removeFromIndexes(g[v]);
        throw m;
      }
    }
    /**
     * Callback version of {@link Datastore#insertAsync}.
     * @param {document|document[]} newDoc
     * @param {SingleDocumentCallback|MultipleDocumentsCallback} [callback]
     * @see Datastore#insertAsync
     */
    insert(g, w) {
      const m = this.insertAsync(g);
      typeof w == "function" && e(() => m)(w);
    }
    /**
     * Insert a new document, or new documents.
     * @param {document|document[]} newDoc Document or array of documents to insert.
     * @return {Promise<document|document[]>} The document(s) inserted.
     * @async
     */
    insertAsync(g) {
      return this.executor.pushAsync(() => this._insertAsync(g));
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
    count(g, w) {
      const m = this.countAsync(g);
      if (typeof w == "function") e(m.execAsync.bind(m))(w);
      else return m;
    }
    /**
     * Count all documents matching the query.
     * @param {query} query MongoDB-style query
     * @return {Cursor<number>} count
     * @async
     */
    countAsync(g) {
      return new n(this, g, (w) => w.length);
    }
    /**
     * Callback version of {@link Datastore#findAsync}.
     * @param {query} query
     * @param {projection|MultipleDocumentsCallback} [projection = {}]
     * @param {MultipleDocumentsCallback} [callback]
     * @return {Cursor<document[]>|undefined}
     * @see Datastore#findAsync
     */
    find(g, w, m) {
      arguments.length === 1 ? w = {} : arguments.length === 2 && typeof w == "function" && (m = w, w = {});
      const v = this.findAsync(g, w);
      if (typeof m == "function") e(v.execAsync.bind(v))(m);
      else return v;
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
    findAsync(g, w = {}) {
      const m = new n(this, g, (v) => v.map((p) => o.deepCopy(p)));
      return m.projection(w), m;
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
    findOne(g, w, m) {
      arguments.length === 1 ? w = {} : arguments.length === 2 && typeof w == "function" && (m = w, w = {});
      const v = this.findOneAsync(g, w);
      if (typeof m == "function") e(v.execAsync.bind(v))(m);
      else return v;
    }
    /**
     * Find one document matching the query.
     * We return the {@link Cursor} that the user can either `await` directly or use to can {@link Cursor#skip} before.
     * @param {query} query MongoDB-style query
     * @param {projection} projection MongoDB-style projection
     * @return {Cursor<document>}
     */
    findOneAsync(g, w = {}) {
      const m = new n(this, g, (v) => v.length === 1 ? o.deepCopy(v[0]) : null);
      return m.projection(w).limit(1), m;
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
    async _updateAsync(g, w, m) {
      const v = m.multi !== void 0 ? m.multi : !1;
      if ((m.upsert !== void 0 ? m.upsert : !1) && (await new n(this, g).limit(1)._execAsync()).length !== 1) {
        let $;
        try {
          o.checkObject(w), $ = w;
        } catch {
          $ = o.modify(o.deepCopy(g, !0), w);
        }
        return { numAffected: 1, affectedDocuments: await this._insertAsync($), upsert: !0 };
      }
      let E = 0, _;
      const y = [];
      let b;
      const S = await this._getCandidatesAsync(g);
      for (const M of S)
        o.match(M, g) && (v || E === 0) && (E += 1, this.timestampData && (b = M.createdAt), _ = o.modify(M, w), this.timestampData && (_.createdAt = b, _.updatedAt = /* @__PURE__ */ new Date()), y.push({ oldDoc: M, newDoc: _ }));
      this._updateIndexes(y);
      const x = y.map((M) => M.newDoc);
      if (await this.persistence.persistNewStateAsync(x), m.returnUpdatedDocs) {
        let M = [];
        return x.forEach((k) => {
          M.push(o.deepCopy(k));
        }), v || (M = M[0]), { numAffected: E, affectedDocuments: M, upsert: !1 };
      } else
        return { numAffected: E, upsert: !1, affectedDocuments: null };
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
    update(g, w, m, v) {
      typeof m == "function" && (v = m, m = {});
      const p = (E, _ = {}) => {
        v && v(E, _.numAffected, _.affectedDocuments, _.upsert);
      };
      e((E, _, y) => this.updateAsync(E, _, y))(g, w, m, p);
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
    updateAsync(g, w, m = {}) {
      return this.executor.pushAsync(() => this._updateAsync(g, w, m));
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
    async _removeAsync(g, w = {}) {
      const m = w.multi !== void 0 ? w.multi : !1, v = await this._getCandidatesAsync(g, !0), p = [];
      let E = 0;
      return v.forEach((_) => {
        o.match(_, g) && (m || E === 0) && (E += 1, p.push({ $$deleted: !0, _id: _._id }), this._removeFromIndexes(_));
      }), await this.persistence.persistNewStateAsync(p), E;
    }
    /**
     * Callback version of {@link Datastore#removeAsync}.
     * @param {query} query
     * @param {object|Datastore~removeCallback} [options={}]
     * @param {boolean} [options.multi = false]
     * @param {Datastore~removeCallback} [cb = () => {}]
     * @see Datastore#removeAsync
     */
    remove(g, w, m) {
      typeof w == "function" && (m = w, w = {});
      const v = m || (() => {
      });
      e((p, E) => this.removeAsync(p, E))(g, w, v);
    }
    /**
     * Remove all docs matching the query.
     * @param {query} query MongoDB-style query
     * @param {object} [options={}] Optional options
     * @param {boolean} [options.multi = false] If true, can update multiple documents
     * @return {Promise<number>} How many documents were removed
     * @async
     */
    removeAsync(g, w = {}) {
      return this.executor.pushAsync(() => this._removeAsync(g, w));
    }
  }
  return Ec = l, Ec;
}
var bc, $d;
function S_() {
  return $d || ($d = 1, bc = b_()), bc;
}
var M_ = S_();
const x_ = /* @__PURE__ */ an(M_);
function k_(t, e) {
  if (!t) return !1;
  const r = e.trim().split(/\s+/);
  return typeof t == "string" ? r.every((n) => new RegExp(n, "i").test(t)) : r.every(
    (n) => Object.values(t).some((i) => new RegExp(n, "i").test(i))
  );
}
class $_ {
  db = null;
  get folders() {
    const e = ae.get("saveFolder");
    return {
      saveFolder: e,
      tileFolder: lt.join(e, "tiles"),
      originalFolder: lt.join(e, "originals"),
      uiThumbnailFolder: lt.join(e, "tmbs"),
      dbFile: lt.join(e, "nedb.db")
    };
  }
  async getDBInstance() {
    return this.getDB();
  }
  async getDB() {
    if (this.db) return this.db;
    const { dbFile: e } = this.folders;
    return this.db = new x_({ filename: e, autoload: !0 }), this.db;
  }
  async requestMaps(e = "", r = 1, n = 20) {
    const i = await this.getDB(), s = {};
    if (e && e.trim()) {
      const d = e;
      s.$where = function() {
        return ["title", "officialTitle", "description"].some(
          (g) => k_(this[g], d)
        );
      };
    }
    let a = r, o, c = [], h, f;
    for (; ; ) {
      const d = (a - 1) * n;
      console.log(`[MapDataService] Requesting maps: query='${e}', page=${a}, skip=${d}`);
      const g = await new Promise((w, m) => {
        i.find(s).sort({ _id: 1 }).skip(d).limit(n + 1).exec((v, p) => {
          v ? m(v) : w(p);
        });
      });
      if (f = g.length > n, f && g.pop(), h = a > 1, g.length === 0 && a > 1)
        a--, o = a;
      else {
        c = g;
        break;
      }
    }
    const l = { docs: await Promise.all(c.map(async (d) => {
      const g = d._id || d.mapID;
      let w = d.title;
      if (typeof w == "object" && w !== null) {
        const y = d.lang || "ja";
        w = w[y] || Object.values(w)[0];
      }
      const m = d.width || d.compiled && d.compiled.wh && d.compiled.wh[0], v = d.height || d.compiled && d.compiled.wh && d.compiled.wh[1], p = {
        mapID: g,
        title: w || g,
        width: m,
        height: v,
        image: null
      };
      p.width && p.height ? p.width > p.height ? (p.height = Math.round(p.height * 190 / p.width), p.width = 190) : (p.width = Math.round(p.width * 190 / p.height), p.height = 190) : (p.width = 190, p.height = 190);
      const { tileFolder: E } = this.folders, _ = lt.join(E, g, "0", "0");
      if (gt.existsSync(_))
        try {
          const b = (await gt.readdir(_)).find((S) => /^0\.(jpg|jpeg|png)$/.test(S));
          if (b) {
            const S = lt.join(_, b);
            p.image = `file://${S.split(lt.sep).join("/")}`;
          }
        } catch (y) {
          console.error(`[MapDataService] ${g} のサムネイル読み込みエラー`, y);
        }
      return p;
    })), prev: h, next: f };
    return o !== void 0 && (l.pageUpdate = o), l;
  }
  // 旧実装 nedb_accessor.js searchExtent に準拠:
  // メルカトル extent と重なる地図の mapID 一覧を返す
  async searchExtent(e) {
    const r = await this.getDB(), n = {};
    return n.$where = function() {
      if (!this.compiled) return !1;
      const s = this.compiled.vertices_points;
      if (!s || s.length === 0) return !1;
      const a = s.reduce((o, c) => {
        const h = c[1];
        return o.length === 0 ? [h[0], h[1], h[0], h[1]] : [
          Math.min(o[0], h[0]),
          Math.min(o[1], h[1]),
          Math.max(o[2], h[0]),
          Math.max(o[3], h[1])
        ];
      }, []);
      return e[0] <= a[2] && a[0] <= e[2] && e[1] <= a[3] && a[1] <= e[3];
    }, (await new Promise((s, a) => {
      r.find(n).sort({ _id: 1 }).exec((o, c) => {
        o ? a(o) : s(c);
      });
    })).map((s) => s._id);
  }
  async deleteMap(e) {
    const r = await this.getDB(), { tileFolder: n, uiThumbnailFolder: i, originalFolder: s } = this.folders;
    await r.removeAsync({ _id: e }, {});
    const a = lt.join(n, e);
    gt.existsSync(a) && await gt.remove(a);
    const o = lt.join(i, `${e}.jpg`);
    if (gt.existsSync(o) && await gt.remove(o), gt.existsSync(s)) {
      const c = await gt.readdir(s);
      for (const h of c)
        new RegExp(`^${e}\\.`).test(h) && await gt.remove(lt.join(s, h));
    }
  }
  async generateThumbnail(e, r) {
    gt.existsSync(lt.dirname(r)) || await gt.ensureDir(lt.dirname(r)), await gt.copy(e, r, { overwrite: !0 });
  }
  async switchDataFolder() {
    this.db = null;
    const { tileFolder: e, originalFolder: r, uiThumbnailFolder: n } = this.folders;
    try {
      await gt.ensureDir(e), await gt.ensureDir(r), await gt.ensureDir(n), console.log(`[MapDataService] Data folder switched and initialized: ${ae.get("saveFolder")}`);
    } catch (i) {
      console.error("[MapDataService] Failed to initialize new data folders", i);
    }
  }
}
const Er = new $_();
function I_() {
  Ot.handle("settings:get", (t, e) => ae.get(e)), Ot.handle("settings:set", async (t, e, r) => {
    ae.set(e, r), e === "saveFolder" && (await Er.switchDataFolder(), We.getAllWindows().forEach((n) => {
      n.webContents.send("maplist:refresh");
    }));
  }), Ot.handle("settings:select-folder", async (t) => {
    const e = We.fromWebContents(t.sender);
    return await ae.showSaveFolderDialog(e);
  }), Ot.handle("mapedit:get-tms-list", async (t, e) => await ae.getTmsListOfMapID(e));
}
function P_() {
  Ot.handle("maplist:request", async (t, e, r, n) => await Er.requestMaps(e, r, n)), Ot.handle("maplist:delete", async (t, e, r, n) => (await Er.deleteMap(e), await Er.requestMaps(r, n)));
}
var Xr = { exports: {} }, Sc, Id;
function Bm() {
  return Id || (Id = 1, Sc = {
    /* The local file header */
    LOCHDR: 30,
    // LOC header size
    LOCSIG: 67324752,
    // "PK\003\004"
    LOCVER: 4,
    // version needed to extract
    LOCFLG: 6,
    // general purpose bit flag
    LOCHOW: 8,
    // compression method
    LOCTIM: 10,
    // modification time (2 bytes time, 2 bytes date)
    LOCCRC: 14,
    // uncompressed file crc-32 value
    LOCSIZ: 18,
    // compressed size
    LOCLEN: 22,
    // uncompressed size
    LOCNAM: 26,
    // filename length
    LOCEXT: 28,
    // extra field length
    /* The Data descriptor */
    EXTSIG: 134695760,
    // "PK\007\008"
    EXTHDR: 16,
    // EXT header size
    EXTCRC: 4,
    // uncompressed file crc-32 value
    EXTSIZ: 8,
    // compressed size
    EXTLEN: 12,
    // uncompressed size
    /* The central directory file header */
    CENHDR: 46,
    // CEN header size
    CENSIG: 33639248,
    // "PK\001\002"
    CENVEM: 4,
    // version made by
    CENVER: 6,
    // version needed to extract
    CENFLG: 8,
    // encrypt, decrypt flags
    CENHOW: 10,
    // compression method
    CENTIM: 12,
    // modification time (2 bytes time, 2 bytes date)
    CENCRC: 16,
    // uncompressed file crc-32 value
    CENSIZ: 20,
    // compressed size
    CENLEN: 24,
    // uncompressed size
    CENNAM: 28,
    // filename length
    CENEXT: 30,
    // extra field length
    CENCOM: 32,
    // file comment length
    CENDSK: 34,
    // volume number start
    CENATT: 36,
    // internal file attributes
    CENATX: 38,
    // external file attributes (host system dependent)
    CENOFF: 42,
    // LOC header offset
    /* The entries in the end of central directory */
    ENDHDR: 22,
    // END header size
    ENDSIG: 101010256,
    // "PK\005\006"
    ENDSUB: 8,
    // number of entries on this disk
    ENDTOT: 10,
    // total number of entries
    ENDSIZ: 12,
    // central directory size in bytes
    ENDOFF: 16,
    // offset of first CEN header
    ENDCOM: 20,
    // zip file comment length
    END64HDR: 20,
    // zip64 END header size
    END64SIG: 117853008,
    // zip64 Locator signature, "PK\006\007"
    END64START: 4,
    // number of the disk with the start of the zip64
    END64OFF: 8,
    // relative offset of the zip64 end of central directory
    END64NUMDISKS: 16,
    // total number of disks
    ZIP64SIG: 101075792,
    // zip64 signature, "PK\006\006"
    ZIP64HDR: 56,
    // zip64 record minimum size
    ZIP64LEAD: 12,
    // leading bytes at the start of the record, not counted by the value stored in ZIP64SIZE
    ZIP64SIZE: 4,
    // zip64 size of the central directory record
    ZIP64VEM: 12,
    // zip64 version made by
    ZIP64VER: 14,
    // zip64 version needed to extract
    ZIP64DSK: 16,
    // zip64 number of this disk
    ZIP64DSKDIR: 20,
    // number of the disk with the start of the record directory
    ZIP64SUB: 24,
    // number of entries on this disk
    ZIP64TOT: 32,
    // total number of entries
    ZIP64SIZB: 40,
    // zip64 central directory size in bytes
    ZIP64OFF: 48,
    // offset of start of central directory with respect to the starting disk number
    ZIP64EXTRA: 56,
    // extensible data sector
    /* Compression methods */
    STORED: 0,
    // no compression
    SHRUNK: 1,
    // shrunk
    REDUCED1: 2,
    // reduced with compression factor 1
    REDUCED2: 3,
    // reduced with compression factor 2
    REDUCED3: 4,
    // reduced with compression factor 3
    REDUCED4: 5,
    // reduced with compression factor 4
    IMPLODED: 6,
    // imploded
    // 7 reserved for Tokenizing compression algorithm
    DEFLATED: 8,
    // deflated
    ENHANCED_DEFLATED: 9,
    // enhanced deflated
    PKWARE: 10,
    // PKWare DCL imploded
    // 11 reserved by PKWARE
    BZIP2: 12,
    //  compressed using BZIP2
    // 13 reserved by PKWARE
    LZMA: 14,
    // LZMA
    // 15-17 reserved by PKWARE
    IBM_TERSE: 18,
    // compressed using IBM TERSE
    IBM_LZ77: 19,
    // IBM LZ77 z
    AES_ENCRYPT: 99,
    // WinZIP AES encryption method
    /* General purpose bit flag */
    // values can obtained with expression 2**bitnr
    FLG_ENC: 1,
    // Bit 0: encrypted file
    FLG_COMP1: 2,
    // Bit 1, compression option
    FLG_COMP2: 4,
    // Bit 2, compression option
    FLG_DESC: 8,
    // Bit 3, data descriptor
    FLG_ENH: 16,
    // Bit 4, enhanced deflating
    FLG_PATCH: 32,
    // Bit 5, indicates that the file is compressed patched data.
    FLG_STR: 64,
    // Bit 6, strong encryption (patented)
    // Bits 7-10: Currently unused.
    FLG_EFS: 2048,
    // Bit 11: Language encoding flag (EFS)
    // Bit 12: Reserved by PKWARE for enhanced compression.
    // Bit 13: encrypted the Central Directory (patented).
    // Bits 14-15: Reserved by PKWARE.
    FLG_MSK: 4096,
    // mask header values
    /* Load type */
    FILE: 2,
    BUFFER: 1,
    NONE: 0,
    /* 4.5 Extensible data fields */
    EF_ID: 0,
    EF_SIZE: 2,
    /* Header IDs */
    ID_ZIP64: 1,
    ID_AVINFO: 7,
    ID_PFS: 8,
    ID_OS2: 9,
    ID_NTFS: 10,
    ID_OPENVMS: 12,
    ID_UNIX: 13,
    ID_FORK: 14,
    ID_PATCH: 15,
    ID_X509_PKCS7: 20,
    ID_X509_CERTID_F: 21,
    ID_X509_CERTID_C: 22,
    ID_STRONGENC: 23,
    ID_RECORD_MGT: 24,
    ID_X509_PKCS7_RL: 25,
    ID_IBM1: 101,
    ID_IBM2: 102,
    ID_POSZIP: 18064,
    EF_ZIP64_OR_32: 4294967295,
    EF_ZIP64_OR_16: 65535,
    EF_ZIP64_SUNCOMP: 0,
    EF_ZIP64_SCOMP: 8,
    EF_ZIP64_RHO: 16,
    EF_ZIP64_DSN: 24
  }), Sc;
}
var Mc = {}, Pd;
function Oh() {
  return Pd || (Pd = 1, (function(t) {
    const e = {
      /* Header error messages */
      INVALID_LOC: "Invalid LOC header (bad signature)",
      INVALID_CEN: "Invalid CEN header (bad signature)",
      INVALID_END: "Invalid END header (bad signature)",
      /* Descriptor */
      DESCRIPTOR_NOT_EXIST: "No descriptor present",
      DESCRIPTOR_UNKNOWN: "Unknown descriptor format",
      DESCRIPTOR_FAULTY: "Descriptor data is malformed",
      /* ZipEntry error messages*/
      NO_DATA: "Nothing to decompress",
      BAD_CRC: "CRC32 checksum failed {0}",
      FILE_IN_THE_WAY: "There is a file in the way: {0}",
      UNKNOWN_METHOD: "Invalid/unsupported compression method",
      /* Inflater error messages */
      AVAIL_DATA: "inflate::Available inflate data did not terminate",
      INVALID_DISTANCE: "inflate::Invalid literal/length or distance code in fixed or dynamic block",
      TO_MANY_CODES: "inflate::Dynamic block code description: too many length or distance codes",
      INVALID_REPEAT_LEN: "inflate::Dynamic block code description: repeat more than specified lengths",
      INVALID_REPEAT_FIRST: "inflate::Dynamic block code description: repeat lengths with no first length",
      INCOMPLETE_CODES: "inflate::Dynamic block code description: code lengths codes incomplete",
      INVALID_DYN_DISTANCE: "inflate::Dynamic block code description: invalid distance code lengths",
      INVALID_CODES_LEN: "inflate::Dynamic block code description: invalid literal/length code lengths",
      INVALID_STORE_BLOCK: "inflate::Stored block length did not match one's complement",
      INVALID_BLOCK_TYPE: "inflate::Invalid block type (type == 3)",
      /* ADM-ZIP error messages */
      CANT_EXTRACT_FILE: "Could not extract the file",
      CANT_OVERRIDE: "Target file already exists",
      DISK_ENTRY_TOO_LARGE: "Number of disk entries is too large",
      NO_ZIP: "No zip file was loaded",
      NO_ENTRY: "Entry doesn't exist",
      DIRECTORY_CONTENT_ERROR: "A directory cannot have content",
      FILE_NOT_FOUND: 'File not found: "{0}"',
      NOT_IMPLEMENTED: "Not implemented",
      INVALID_FILENAME: "Invalid filename",
      INVALID_FORMAT: "Invalid or unsupported zip format. No END header found",
      INVALID_PASS_PARAM: "Incompatible password parameter",
      WRONG_PASSWORD: "Wrong Password",
      /* ADM-ZIP */
      COMMENT_TOO_LONG: "Comment is too long",
      // Comment can be max 65535 bytes long (NOTE: some non-US characters may take more space)
      EXTRA_FIELD_PARSE_ERROR: "Extra field parsing error"
    };
    function r(n) {
      return function(...i) {
        return i.length && (n = n.replace(/\{(\d)\}/g, (s, a) => i[a] || "")), new Error("ADM-ZIP: " + n);
      };
    }
    for (const n of Object.keys(e))
      t[n] = r(e[n]);
  })(Mc)), Mc;
}
var xc, Ad;
function A_() {
  if (Ad) return xc;
  Ad = 1;
  const t = Gr, e = lt, r = Bm(), n = Oh(), i = typeof process == "object" && process.platform === "win32", s = (c) => typeof c == "object" && c !== null, a = new Uint32Array(256).map((c, h) => {
    for (let f = 0; f < 8; f++)
      (h & 1) !== 0 ? h = 3988292384 ^ h >>> 1 : h >>>= 1;
    return h >>> 0;
  });
  function o(c) {
    this.sep = e.sep, this.fs = t, s(c) && s(c.fs) && typeof c.fs.statSync == "function" && (this.fs = c.fs);
  }
  return xc = o, o.prototype.makeDir = function(c) {
    const h = this;
    function f(u) {
      let l = u.split(h.sep)[0];
      u.split(h.sep).forEach(function(d) {
        if (!(!d || d.substr(-1, 1) === ":")) {
          l += h.sep + d;
          var g;
          try {
            g = h.fs.statSync(l);
          } catch (w) {
            if (w.message && w.message.startsWith("ENOENT"))
              h.fs.mkdirSync(l);
            else
              throw w;
          }
          if (g && g.isFile()) throw n.FILE_IN_THE_WAY(`"${l}"`);
        }
      });
    }
    f(c);
  }, o.prototype.writeFileTo = function(c, h, f, u) {
    const l = this;
    if (l.fs.existsSync(c)) {
      if (!f) return !1;
      var d = l.fs.statSync(c);
      if (d.isDirectory())
        return !1;
    }
    var g = e.dirname(c);
    l.fs.existsSync(g) || l.makeDir(g);
    var w;
    try {
      w = l.fs.openSync(c, "w", 438);
    } catch {
      l.fs.chmodSync(c, 438), w = l.fs.openSync(c, "w", 438);
    }
    if (w)
      try {
        l.fs.writeSync(w, h, 0, h.length, 0);
      } finally {
        l.fs.closeSync(w);
      }
    return l.fs.chmodSync(c, u || 438), !0;
  }, o.prototype.writeFileToAsync = function(c, h, f, u, l) {
    typeof u == "function" && (l = u, u = void 0);
    const d = this;
    d.fs.exists(c, function(g) {
      if (g && !f) return l(!1);
      d.fs.stat(c, function(w, m) {
        if (g && m.isDirectory())
          return l(!1);
        var v = e.dirname(c);
        d.fs.exists(v, function(p) {
          p || d.makeDir(v), d.fs.open(c, "w", 438, function(E, _) {
            E ? d.fs.chmod(c, 438, function() {
              d.fs.open(c, "w", 438, function(y, b) {
                d.fs.write(b, h, 0, h.length, 0, function() {
                  d.fs.close(b, function() {
                    d.fs.chmod(c, u || 438, function() {
                      l(!0);
                    });
                  });
                });
              });
            }) : _ ? d.fs.write(_, h, 0, h.length, 0, function() {
              d.fs.close(_, function() {
                d.fs.chmod(c, u || 438, function() {
                  l(!0);
                });
              });
            }) : d.fs.chmod(c, u || 438, function() {
              l(!0);
            });
          });
        });
      });
    });
  }, o.prototype.findFiles = function(c) {
    const h = this;
    function f(u, l, d) {
      let g = [];
      return h.fs.readdirSync(u).forEach(function(w) {
        const m = e.join(u, w), v = h.fs.statSync(m);
        g.push(e.normalize(m) + (v.isDirectory() ? h.sep : "")), v.isDirectory() && d && (g = g.concat(f(m, l, d)));
      }), g;
    }
    return f(c, void 0, !0);
  }, o.prototype.findFilesAsync = function(c, h) {
    const f = this;
    let u = [];
    f.fs.readdir(c, function(l, d) {
      if (l) return h(l);
      let g = d.length;
      if (!g) return h(null, u);
      d.forEach(function(w) {
        w = e.join(c, w), f.fs.stat(w, function(m, v) {
          if (m) return h(m);
          v && (u.push(e.normalize(w) + (v.isDirectory() ? f.sep : "")), v.isDirectory() ? f.findFilesAsync(w, function(p, E) {
            if (p) return h(p);
            u = u.concat(E), --g || h(null, u);
          }) : --g || h(null, u));
        });
      });
    });
  }, o.prototype.getAttributes = function() {
  }, o.prototype.setAttributes = function() {
  }, o.crc32update = function(c, h) {
    return a[(c ^ h) & 255] ^ c >>> 8;
  }, o.crc32 = function(c) {
    typeof c == "string" && (c = Buffer.from(c, "utf8"));
    let h = c.length, f = -1;
    for (let u = 0; u < h; ) f = o.crc32update(f, c[u++]);
    return ~f >>> 0;
  }, o.methodToString = function(c) {
    switch (c) {
      case r.STORED:
        return "STORED (" + c + ")";
      case r.DEFLATED:
        return "DEFLATED (" + c + ")";
      default:
        return "UNSUPPORTED (" + c + ")";
    }
  }, o.canonical = function(c) {
    if (!c) return "";
    const h = e.posix.normalize("/" + c.split("\\").join("/"));
    return e.join(".", h);
  }, o.zipnamefix = function(c) {
    if (!c) return "";
    const h = e.posix.normalize("/" + c.split("\\").join("/"));
    return e.posix.join(".", h);
  }, o.findLast = function(c, h) {
    if (!Array.isArray(c)) throw new TypeError("arr is not array");
    const f = c.length >>> 0;
    for (let u = f - 1; u >= 0; u--)
      if (h(c[u], u, c))
        return c[u];
  }, o.sanitize = function(c, h) {
    c = e.resolve(e.normalize(c));
    for (var f = h.split("/"), u = 0, l = f.length; u < l; u++) {
      var d = e.normalize(e.join(c, f.slice(u, l).join(e.sep)));
      if (d.indexOf(c) === 0)
        return d;
    }
    return e.normalize(e.join(c, e.basename(h)));
  }, o.toBuffer = function(h, f) {
    return Buffer.isBuffer(h) ? h : h instanceof Uint8Array ? Buffer.from(h) : typeof h == "string" ? f(h) : Buffer.alloc(0);
  }, o.readBigUInt64LE = function(c, h) {
    const f = c.readUInt32LE(h);
    return c.readUInt32LE(h + 4) * 4294967296 + f;
  }, o.fromDOS2Date = function(c) {
    return new Date((c >> 25 & 127) + 1980, Math.max((c >> 21 & 15) - 1, 0), Math.max(c >> 16 & 31, 1), c >> 11 & 31, c >> 5 & 63, (c & 31) << 1);
  }, o.fromDate2DOS = function(c) {
    let h = 0, f = 0;
    return c.getFullYear() > 1979 && (h = (c.getFullYear() - 1980 & 127) << 9 | c.getMonth() + 1 << 5 | c.getDate(), f = c.getHours() << 11 | c.getMinutes() << 5 | c.getSeconds() >> 1), h << 16 | f;
  }, o.isWin = i, o.crcTable = a, xc;
}
var kc, Nd;
function N_() {
  if (Nd) return kc;
  Nd = 1;
  const t = lt;
  return kc = function(e, { fs: r }) {
    var n = e || "", i = a(), s = null;
    function a() {
      return {
        directory: !1,
        readonly: !1,
        hidden: !1,
        executable: !1,
        mtime: 0,
        atime: 0
      };
    }
    return n && r.existsSync(n) ? (s = r.statSync(n), i.directory = s.isDirectory(), i.mtime = s.mtime, i.atime = s.atime, i.executable = (73 & s.mode) !== 0, i.readonly = (128 & s.mode) === 0, i.hidden = t.basename(n)[0] === ".") : console.warn("Invalid path: " + n), {
      get directory() {
        return i.directory;
      },
      get readOnly() {
        return i.readonly;
      },
      get hidden() {
        return i.hidden;
      },
      get mtime() {
        return i.mtime;
      },
      get atime() {
        return i.atime;
      },
      get executable() {
        return i.executable;
      },
      decodeAttributes: function() {
      },
      encodeAttributes: function() {
      },
      toJSON: function() {
        return {
          path: n,
          isDirectory: i.directory,
          isReadOnly: i.readonly,
          isHidden: i.hidden,
          isExecutable: i.executable,
          mTime: i.mtime,
          aTime: i.atime
        };
      },
      toString: function() {
        return JSON.stringify(this.toJSON(), null, "	");
      }
    };
  }, kc;
}
var $c, Od;
function O_() {
  return Od || (Od = 1, $c = {
    efs: !0,
    encode: (t) => Buffer.from(t, "utf8"),
    decode: (t) => t.toString("utf8")
  }), $c;
}
var Rd;
function fi() {
  return Rd || (Rd = 1, Xr.exports = A_(), Xr.exports.Constants = Bm(), Xr.exports.Errors = Oh(), Xr.exports.FileAttr = N_(), Xr.exports.decoder = O_()), Xr.exports;
}
var ks = {}, Ic, Dd;
function R_() {
  if (Dd) return Ic;
  Dd = 1;
  var t = fi(), e = t.Constants;
  return Ic = function() {
    var r = 20, n = 10, i = 0, s = 0, a = 0, o = 0, c = 0, h = 0, f = 0, u = 0, l = 0, d = 0, g = 0, w = 0, m = 0;
    r |= t.isWin ? 2560 : 768, i |= e.FLG_EFS;
    const v = {
      extraLen: 0
    }, p = (_) => Math.max(0, _) >>> 0, E = (_) => Math.max(0, _) & 255;
    return a = t.fromDate2DOS(/* @__PURE__ */ new Date()), {
      get made() {
        return r;
      },
      set made(_) {
        r = _;
      },
      get version() {
        return n;
      },
      set version(_) {
        n = _;
      },
      get flags() {
        return i;
      },
      set flags(_) {
        i = _;
      },
      get flags_efs() {
        return (i & e.FLG_EFS) > 0;
      },
      set flags_efs(_) {
        _ ? i |= e.FLG_EFS : i &= ~e.FLG_EFS;
      },
      get flags_desc() {
        return (i & e.FLG_DESC) > 0;
      },
      set flags_desc(_) {
        _ ? i |= e.FLG_DESC : i &= ~e.FLG_DESC;
      },
      get method() {
        return s;
      },
      set method(_) {
        switch (_) {
          case e.STORED:
            this.version = 10;
          case e.DEFLATED:
          default:
            this.version = 20;
        }
        s = _;
      },
      get time() {
        return t.fromDOS2Date(this.timeval);
      },
      set time(_) {
        _ = new Date(_), this.timeval = t.fromDate2DOS(_);
      },
      get timeval() {
        return a;
      },
      set timeval(_) {
        a = p(_);
      },
      get timeHighByte() {
        return E(a >>> 8);
      },
      get crc() {
        return o;
      },
      set crc(_) {
        o = p(_);
      },
      get compressedSize() {
        return c;
      },
      set compressedSize(_) {
        c = p(_);
      },
      get size() {
        return h;
      },
      set size(_) {
        h = p(_);
      },
      get fileNameLength() {
        return f;
      },
      set fileNameLength(_) {
        f = _;
      },
      get extraLength() {
        return u;
      },
      set extraLength(_) {
        u = _;
      },
      get extraLocalLength() {
        return v.extraLen;
      },
      set extraLocalLength(_) {
        v.extraLen = _;
      },
      get commentLength() {
        return l;
      },
      set commentLength(_) {
        l = _;
      },
      get diskNumStart() {
        return d;
      },
      set diskNumStart(_) {
        d = p(_);
      },
      get inAttr() {
        return g;
      },
      set inAttr(_) {
        g = p(_);
      },
      get attr() {
        return w;
      },
      set attr(_) {
        w = p(_);
      },
      // get Unix file permissions
      get fileAttr() {
        return (w || 0) >> 16 & 4095;
      },
      get offset() {
        return m;
      },
      set offset(_) {
        m = p(_);
      },
      get encrypted() {
        return (i & e.FLG_ENC) === e.FLG_ENC;
      },
      get centralHeaderSize() {
        return e.CENHDR + f + u + l;
      },
      get realDataOffset() {
        return m + e.LOCHDR + v.fnameLen + v.extraLen;
      },
      get localHeader() {
        return v;
      },
      loadLocalHeaderFromBinary: function(_) {
        var y = _.slice(m, m + e.LOCHDR);
        if (y.readUInt32LE(0) !== e.LOCSIG)
          throw t.Errors.INVALID_LOC();
        v.version = y.readUInt16LE(e.LOCVER), v.flags = y.readUInt16LE(e.LOCFLG), v.flags_desc = (v.flags & e.FLG_DESC) > 0, v.method = y.readUInt16LE(e.LOCHOW), v.time = y.readUInt32LE(e.LOCTIM), v.crc = y.readUInt32LE(e.LOCCRC), v.compressedSize = y.readUInt32LE(e.LOCSIZ), v.size = y.readUInt32LE(e.LOCLEN), v.fnameLen = y.readUInt16LE(e.LOCNAM), v.extraLen = y.readUInt16LE(e.LOCEXT);
        const b = m + e.LOCHDR + v.fnameLen, S = b + v.extraLen;
        return _.slice(b, S);
      },
      loadFromBinary: function(_) {
        if (_.length !== e.CENHDR || _.readUInt32LE(0) !== e.CENSIG)
          throw t.Errors.INVALID_CEN();
        r = _.readUInt16LE(e.CENVEM), n = _.readUInt16LE(e.CENVER), i = _.readUInt16LE(e.CENFLG), s = _.readUInt16LE(e.CENHOW), a = _.readUInt32LE(e.CENTIM), o = _.readUInt32LE(e.CENCRC), c = _.readUInt32LE(e.CENSIZ), h = _.readUInt32LE(e.CENLEN), f = _.readUInt16LE(e.CENNAM), u = _.readUInt16LE(e.CENEXT), l = _.readUInt16LE(e.CENCOM), d = _.readUInt16LE(e.CENDSK), g = _.readUInt16LE(e.CENATT), w = _.readUInt32LE(e.CENATX), m = _.readUInt32LE(e.CENOFF);
      },
      localHeaderToBinary: function() {
        var _ = Buffer.alloc(e.LOCHDR);
        return _.writeUInt32LE(e.LOCSIG, 0), _.writeUInt16LE(n, e.LOCVER), _.writeUInt16LE(i, e.LOCFLG), _.writeUInt16LE(s, e.LOCHOW), _.writeUInt32LE(a, e.LOCTIM), _.writeUInt32LE(o, e.LOCCRC), _.writeUInt32LE(c, e.LOCSIZ), _.writeUInt32LE(h, e.LOCLEN), _.writeUInt16LE(f, e.LOCNAM), _.writeUInt16LE(v.extraLen, e.LOCEXT), _;
      },
      centralHeaderToBinary: function() {
        var _ = Buffer.alloc(e.CENHDR + f + u + l);
        return _.writeUInt32LE(e.CENSIG, 0), _.writeUInt16LE(r, e.CENVEM), _.writeUInt16LE(n, e.CENVER), _.writeUInt16LE(i, e.CENFLG), _.writeUInt16LE(s, e.CENHOW), _.writeUInt32LE(a, e.CENTIM), _.writeUInt32LE(o, e.CENCRC), _.writeUInt32LE(c, e.CENSIZ), _.writeUInt32LE(h, e.CENLEN), _.writeUInt16LE(f, e.CENNAM), _.writeUInt16LE(u, e.CENEXT), _.writeUInt16LE(l, e.CENCOM), _.writeUInt16LE(d, e.CENDSK), _.writeUInt16LE(g, e.CENATT), _.writeUInt32LE(w, e.CENATX), _.writeUInt32LE(m, e.CENOFF), _;
      },
      toJSON: function() {
        const _ = function(y) {
          return y + " bytes";
        };
        return {
          made: r,
          version: n,
          flags: i,
          method: t.methodToString(s),
          time: this.time,
          crc: "0x" + o.toString(16).toUpperCase(),
          compressedSize: _(c),
          size: _(h),
          fileNameLength: _(f),
          extraLength: _(u),
          commentLength: _(l),
          diskNumStart: d,
          inAttr: g,
          attr: w,
          offset: m,
          centralHeaderSize: _(e.CENHDR + f + u + l)
        };
      },
      toString: function() {
        return JSON.stringify(this.toJSON(), null, "	");
      }
    };
  }, Ic;
}
var Pc, jd;
function D_() {
  if (jd) return Pc;
  jd = 1;
  var t = fi(), e = t.Constants;
  return Pc = function() {
    var r = 0, n = 0, i = 0, s = 0, a = 0;
    return {
      get diskEntries() {
        return r;
      },
      set diskEntries(o) {
        r = n = o;
      },
      get totalEntries() {
        return n;
      },
      set totalEntries(o) {
        n = r = o;
      },
      get size() {
        return i;
      },
      set size(o) {
        i = o;
      },
      get offset() {
        return s;
      },
      set offset(o) {
        s = o;
      },
      get commentLength() {
        return a;
      },
      set commentLength(o) {
        a = o;
      },
      get mainHeaderSize() {
        return e.ENDHDR + a;
      },
      loadFromBinary: function(o) {
        if ((o.length !== e.ENDHDR || o.readUInt32LE(0) !== e.ENDSIG) && (o.length < e.ZIP64HDR || o.readUInt32LE(0) !== e.ZIP64SIG))
          throw t.Errors.INVALID_END();
        o.readUInt32LE(0) === e.ENDSIG ? (r = o.readUInt16LE(e.ENDSUB), n = o.readUInt16LE(e.ENDTOT), i = o.readUInt32LE(e.ENDSIZ), s = o.readUInt32LE(e.ENDOFF), a = o.readUInt16LE(e.ENDCOM)) : (r = t.readBigUInt64LE(o, e.ZIP64SUB), n = t.readBigUInt64LE(o, e.ZIP64TOT), i = t.readBigUInt64LE(o, e.ZIP64SIZE), s = t.readBigUInt64LE(o, e.ZIP64OFF), a = 0);
      },
      toBinary: function() {
        var o = Buffer.alloc(e.ENDHDR + a);
        return o.writeUInt32LE(e.ENDSIG, 0), o.writeUInt32LE(0, 4), o.writeUInt16LE(r, e.ENDSUB), o.writeUInt16LE(n, e.ENDTOT), o.writeUInt32LE(i, e.ENDSIZ), o.writeUInt32LE(s, e.ENDOFF), o.writeUInt16LE(a, e.ENDCOM), o.fill(" ", e.ENDHDR), o;
      },
      toJSON: function() {
        const o = function(c, h) {
          let f = c.toString(16).toUpperCase();
          for (; f.length < h; ) f = "0" + f;
          return "0x" + f;
        };
        return {
          diskEntries: r,
          totalEntries: n,
          size: i + " bytes",
          offset: o(s, 4),
          commentLength: a
        };
      },
      toString: function() {
        return JSON.stringify(this.toJSON(), null, "	");
      }
    };
  }, Pc;
}
var Td;
function Zm() {
  return Td || (Td = 1, ks.EntryHeader = R_(), ks.MainHeader = D_()), ks;
}
var zn = {}, Ac, Cd;
function j_() {
  return Cd || (Cd = 1, Ac = function(t) {
    var e = hm, r = { chunkSize: (parseInt(t.length / 1024) + 1) * 1024 };
    return {
      deflate: function() {
        return e.deflateRawSync(t, r);
      },
      deflateAsync: function(n) {
        var i = e.createDeflateRaw(r), s = [], a = 0;
        i.on("data", function(o) {
          s.push(o), a += o.length;
        }), i.on("end", function() {
          var o = Buffer.alloc(a), c = 0;
          o.fill(0);
          for (var h = 0; h < s.length; h++) {
            var f = s[h];
            f.copy(o, c), c += f.length;
          }
          n && n(o);
        }), i.end(t);
      }
    };
  }), Ac;
}
var Nc, Ld;
function T_() {
  if (Ld) return Nc;
  Ld = 1;
  const t = +(process.versions ? process.versions.node : "").split(".")[0] || 0;
  return Nc = function(e, r) {
    var n = hm;
    const i = t >= 15 && r > 0 ? { maxOutputLength: r } : {};
    return {
      inflate: function() {
        return n.inflateRawSync(e, i);
      },
      inflateAsync: function(s) {
        var a = n.createInflateRaw(i), o = [], c = 0;
        a.on("data", function(h) {
          o.push(h), c += h.length;
        }), a.on("end", function() {
          var h = Buffer.alloc(c), f = 0;
          h.fill(0);
          for (var u = 0; u < o.length; u++) {
            var l = o[u];
            l.copy(h, f), f += l.length;
          }
          s && s(h);
        }), a.end(e);
      }
    };
  }, Nc;
}
var Oc, Fd;
function C_() {
  if (Fd) return Oc;
  Fd = 1;
  const { randomFillSync: t } = cm, e = Oh(), r = new Uint32Array(256).map((d, g) => {
    for (let w = 0; w < 8; w++)
      (g & 1) !== 0 ? g = g >>> 1 ^ 3988292384 : g >>>= 1;
    return g >>> 0;
  }), n = (d, g) => Math.imul(d, g) >>> 0, i = (d, g) => r[(d ^ g) & 255] ^ d >>> 8, s = () => typeof t == "function" ? t(Buffer.alloc(12)) : s.node();
  s.node = () => {
    const d = Buffer.alloc(12), g = d.length;
    for (let w = 0; w < g; w++) d[w] = Math.random() * 256 & 255;
    return d;
  };
  const a = {
    genSalt: s
  };
  function o(d) {
    const g = Buffer.isBuffer(d) ? d : Buffer.from(d);
    this.keys = new Uint32Array([305419896, 591751049, 878082192]);
    for (let w = 0; w < g.length; w++)
      this.updateKeys(g[w]);
  }
  o.prototype.updateKeys = function(d) {
    const g = this.keys;
    return g[0] = i(g[0], d), g[1] += g[0] & 255, g[1] = n(g[1], 134775813) + 1, g[2] = i(g[2], g[1] >>> 24), d;
  }, o.prototype.next = function() {
    const d = (this.keys[2] | 2) >>> 0;
    return n(d, d ^ 1) >> 8 & 255;
  };
  function c(d) {
    const g = new o(d);
    return function(w) {
      const m = Buffer.alloc(w.length);
      let v = 0;
      for (let p of w)
        m[v++] = g.updateKeys(p ^ g.next());
      return m;
    };
  }
  function h(d) {
    const g = new o(d);
    return function(w, m, v = 0) {
      m || (m = Buffer.alloc(w.length));
      for (let p of w) {
        const E = g.next();
        m[v++] = p ^ E, g.updateKeys(p);
      }
      return m;
    };
  }
  function f(d, g, w) {
    if (!d || !Buffer.isBuffer(d) || d.length < 12)
      return Buffer.alloc(0);
    const m = c(w), v = m(d.slice(0, 12)), p = (g.flags & 8) === 8 ? g.timeHighByte : g.crc >>> 24;
    if (v[11] !== p)
      throw e.WRONG_PASSWORD();
    return m(d.slice(12));
  }
  function u(d) {
    Buffer.isBuffer(d) && d.length >= 12 ? a.genSalt = function() {
      return d.slice(0, 12);
    } : d === "node" ? a.genSalt = s.node : a.genSalt = s;
  }
  function l(d, g, w, m = !1) {
    d == null && (d = Buffer.alloc(0)), Buffer.isBuffer(d) || (d = Buffer.from(d.toString()));
    const v = h(w), p = a.genSalt();
    p[11] = g.crc >>> 24 & 255, m && (p[10] = g.crc >>> 16 & 255);
    const E = Buffer.alloc(d.length + 12);
    return v(p, E), v(d, E, 12);
  }
  return Oc = { decrypt: f, encrypt: l, _salter: u }, Oc;
}
var Gd;
function L_() {
  return Gd || (Gd = 1, zn.Deflater = j_(), zn.Inflater = T_(), zn.ZipCrypto = C_()), zn;
}
var Rc, zd;
function Vm() {
  if (zd) return Rc;
  zd = 1;
  var t = fi(), e = Zm(), r = t.Constants, n = L_();
  return Rc = function(i, s) {
    var a = new e.EntryHeader(), o = Buffer.alloc(0), c = Buffer.alloc(0), h = !1, f = null, u = Buffer.alloc(0), l = Buffer.alloc(0), d = !0;
    const g = i, w = typeof g.decoder == "object" ? g.decoder : t.decoder;
    d = w.hasOwnProperty("efs") ? w.efs : !1;
    function m() {
      return !s || !(s instanceof Uint8Array) ? Buffer.alloc(0) : (l = a.loadLocalHeaderFromBinary(s), s.slice(a.realDataOffset, a.realDataOffset + a.compressedSize));
    }
    function v(S) {
      if (!a.flags_desc && !a.localHeader.flags_desc) {
        if (t.crc32(S) !== a.localHeader.crc)
          return !1;
      } else {
        const x = {}, M = a.realDataOffset + a.compressedSize;
        if (s.readUInt32LE(M) == r.LOCSIG || s.readUInt32LE(M) == r.CENSIG)
          throw t.Errors.DESCRIPTOR_NOT_EXIST();
        if (s.readUInt32LE(M) == r.EXTSIG)
          x.crc = s.readUInt32LE(M + r.EXTCRC), x.compressedSize = s.readUInt32LE(M + r.EXTSIZ), x.size = s.readUInt32LE(M + r.EXTLEN);
        else if (s.readUInt16LE(M + 12) === 19280)
          x.crc = s.readUInt32LE(M + r.EXTCRC - 4), x.compressedSize = s.readUInt32LE(M + r.EXTSIZ - 4), x.size = s.readUInt32LE(M + r.EXTLEN - 4);
        else
          throw t.Errors.DESCRIPTOR_UNKNOWN();
        if (x.compressedSize !== a.compressedSize || x.size !== a.size || x.crc !== a.crc)
          throw t.Errors.DESCRIPTOR_FAULTY();
        if (t.crc32(S) !== x.crc)
          return !1;
      }
      return !0;
    }
    function p(S, x, M) {
      if (typeof x > "u" && typeof S == "string" && (M = S, S = void 0), h)
        return S && x && x(Buffer.alloc(0), t.Errors.DIRECTORY_CONTENT_ERROR()), Buffer.alloc(0);
      var k = m();
      if (k.length === 0)
        return S && x && x(k), k;
      if (a.encrypted) {
        if (typeof M != "string" && !Buffer.isBuffer(M))
          throw t.Errors.INVALID_PASS_PARAM();
        k = n.ZipCrypto.decrypt(k, a, M);
      }
      var $ = Buffer.alloc(a.size);
      switch (a.method) {
        case t.Constants.STORED:
          if (k.copy($), v($))
            return S && x && x($), $;
          throw S && x && x($, t.Errors.BAD_CRC()), t.Errors.BAD_CRC();
        case t.Constants.DEFLATED:
          var O = new n.Inflater(k, a.size);
          if (S)
            O.inflateAsync(function(T) {
              T.copy(T, 0), x && (v(T) ? x(T) : x(T, t.Errors.BAD_CRC()));
            });
          else {
            if (O.inflate($).copy($, 0), !v($))
              throw t.Errors.BAD_CRC(`"${w.decode(o)}"`);
            return $;
          }
          break;
        default:
          throw S && x && x(Buffer.alloc(0), t.Errors.UNKNOWN_METHOD()), t.Errors.UNKNOWN_METHOD();
      }
    }
    function E(S, x) {
      if ((!f || !f.length) && Buffer.isBuffer(s))
        return S && x && x(m()), m();
      if (f.length && !h) {
        var M;
        switch (a.method) {
          case t.Constants.STORED:
            return a.compressedSize = a.size, M = Buffer.alloc(f.length), f.copy(M), S && x && x(M), M;
          default:
          case t.Constants.DEFLATED:
            var k = new n.Deflater(f);
            if (S)
              k.deflateAsync(function(O) {
                M = Buffer.alloc(O.length), a.compressedSize = O.length, O.copy(M), x && x(M);
              });
            else {
              var $ = k.deflate();
              return a.compressedSize = $.length, $;
            }
            k = null;
            break;
        }
      } else if (S && x)
        x(Buffer.alloc(0));
      else
        return Buffer.alloc(0);
    }
    function _(S, x) {
      return t.readBigUInt64LE(S, x);
    }
    function y(S) {
      try {
        for (var x = 0, M, k, $; x + 4 < S.length; )
          M = S.readUInt16LE(x), x += 2, k = S.readUInt16LE(x), x += 2, $ = S.slice(x, x + k), x += k, r.ID_ZIP64 === M && b($);
      } catch {
        throw t.Errors.EXTRA_FIELD_PARSE_ERROR();
      }
    }
    function b(S) {
      var x, M, k, $;
      S.length >= r.EF_ZIP64_SCOMP && (x = _(S, r.EF_ZIP64_SUNCOMP), a.size === r.EF_ZIP64_OR_32 && (a.size = x)), S.length >= r.EF_ZIP64_RHO && (M = _(S, r.EF_ZIP64_SCOMP), a.compressedSize === r.EF_ZIP64_OR_32 && (a.compressedSize = M)), S.length >= r.EF_ZIP64_DSN && (k = _(S, r.EF_ZIP64_RHO), a.offset === r.EF_ZIP64_OR_32 && (a.offset = k)), S.length >= r.EF_ZIP64_DSN + 4 && ($ = S.readUInt32LE(r.EF_ZIP64_DSN), a.diskNumStart === r.EF_ZIP64_OR_16 && (a.diskNumStart = $));
    }
    return {
      get entryName() {
        return w.decode(o);
      },
      get rawEntryName() {
        return o;
      },
      set entryName(S) {
        o = t.toBuffer(S, w.encode);
        var x = o[o.length - 1];
        h = x === 47 || x === 92, a.fileNameLength = o.length;
      },
      get efs() {
        return typeof d == "function" ? d(this.entryName) : d;
      },
      get extra() {
        return u;
      },
      set extra(S) {
        u = S, a.extraLength = S.length, y(S);
      },
      get comment() {
        return w.decode(c);
      },
      set comment(S) {
        if (c = t.toBuffer(S, w.encode), a.commentLength = c.length, c.length > 65535) throw t.Errors.COMMENT_TOO_LONG();
      },
      get name() {
        var S = w.decode(o);
        return h ? S.substr(S.length - 1).split("/").pop() : S.split("/").pop();
      },
      get isDirectory() {
        return h;
      },
      getCompressedData: function() {
        return E(!1, null);
      },
      getCompressedDataAsync: function(S) {
        E(!0, S);
      },
      setData: function(S) {
        f = t.toBuffer(S, t.decoder.encode), !h && f.length ? (a.size = f.length, a.method = t.Constants.DEFLATED, a.crc = t.crc32(S), a.changed = !0) : a.method = t.Constants.STORED;
      },
      getData: function(S) {
        return a.changed ? f : p(!1, null, S);
      },
      getDataAsync: function(S, x) {
        a.changed ? S(f) : p(!0, S, x);
      },
      set attr(S) {
        a.attr = S;
      },
      get attr() {
        return a.attr;
      },
      set header(S) {
        a.loadFromBinary(S);
      },
      get header() {
        return a;
      },
      packCentralHeader: function() {
        a.flags_efs = this.efs, a.extraLength = u.length;
        var S = a.centralHeaderToBinary(), x = t.Constants.CENHDR;
        return o.copy(S, x), x += o.length, u.copy(S, x), x += a.extraLength, c.copy(S, x), S;
      },
      packLocalHeader: function() {
        let S = 0;
        a.flags_efs = this.efs, a.extraLocalLength = l.length;
        const x = a.localHeaderToBinary(), M = Buffer.alloc(x.length + o.length + a.extraLocalLength);
        return x.copy(M, S), S += x.length, o.copy(M, S), S += o.length, l.copy(M, S), S += l.length, M;
      },
      toJSON: function() {
        const S = function(x) {
          return "<" + (x && x.length + " bytes buffer" || "null") + ">";
        };
        return {
          entryName: this.entryName,
          name: this.name,
          comment: this.comment,
          isDirectory: this.isDirectory,
          header: a.toJSON(),
          compressedData: S(s),
          data: S(f)
        };
      },
      toString: function() {
        return JSON.stringify(this.toJSON(), null, "	");
      }
    };
  }, Rc;
}
var Dc, qd;
function F_() {
  if (qd) return Dc;
  qd = 1;
  const t = Vm(), e = Zm(), r = fi();
  return Dc = function(n, i) {
    var s = [], a = {}, o = Buffer.alloc(0), c = new e.MainHeader(), h = !1;
    const f = /* @__PURE__ */ new Set(), u = i, { noSort: l, decoder: d } = u;
    n ? m(u.readEntries) : h = !0;
    function g() {
      const p = /* @__PURE__ */ new Set();
      for (const E of Object.keys(a)) {
        const _ = E.split("/");
        if (_.pop(), !!_.length)
          for (let y = 0; y < _.length; y++) {
            const b = _.slice(0, y + 1).join("/") + "/";
            p.add(b);
          }
      }
      for (const E of p)
        if (!(E in a)) {
          const _ = new t(u);
          _.entryName = E, _.attr = 16, _.temporary = !0, s.push(_), a[_.entryName] = _, f.add(_);
        }
    }
    function w() {
      if (h = !0, a = {}, c.diskEntries > (n.length - c.offset) / r.Constants.CENHDR)
        throw r.Errors.DISK_ENTRY_TOO_LARGE();
      s = new Array(c.diskEntries);
      for (var p = c.offset, E = 0; E < s.length; E++) {
        var _ = p, y = new t(u, n);
        y.header = n.slice(_, _ += r.Constants.CENHDR), y.entryName = n.slice(_, _ += y.header.fileNameLength), y.header.extraLength && (y.extra = n.slice(_, _ += y.header.extraLength)), y.header.commentLength && (y.comment = n.slice(_, _ + y.header.commentLength)), p += y.header.centralHeaderSize, s[E] = y, a[y.entryName] = y;
      }
      f.clear(), g();
    }
    function m(p) {
      var E = n.length - r.Constants.ENDHDR, _ = Math.max(0, E - 65535), y = _, b = n.length, S = -1, x = 0;
      for (typeof u.trailingSpace == "boolean" && u.trailingSpace && (_ = 0), E; E >= y; E--)
        if (n[E] === 80) {
          if (n.readUInt32LE(E) === r.Constants.ENDSIG) {
            S = E, x = E, b = E + r.Constants.ENDHDR, y = E - r.Constants.END64HDR;
            continue;
          }
          if (n.readUInt32LE(E) === r.Constants.END64SIG) {
            y = _;
            continue;
          }
          if (n.readUInt32LE(E) === r.Constants.ZIP64SIG) {
            S = E, b = E + r.readBigUInt64LE(n, E + r.Constants.ZIP64SIZE) + r.Constants.ZIP64LEAD;
            break;
          }
        }
      if (S == -1) throw r.Errors.INVALID_FORMAT();
      c.loadFromBinary(n.slice(S, b)), c.commentLength && (o = n.slice(x + r.Constants.ENDHDR)), p && w();
    }
    function v() {
      s.length > 1 && !l && s.sort((p, E) => p.entryName.toLowerCase().localeCompare(E.entryName.toLowerCase()));
    }
    return {
      /**
       * Returns an array of ZipEntry objects existent in the current opened archive
       * @return Array
       */
      get entries() {
        return h || w(), s.filter((p) => !f.has(p));
      },
      /**
       * Archive comment
       * @return {String}
       */
      get comment() {
        return d.decode(o);
      },
      set comment(p) {
        o = r.toBuffer(p, d.encode), c.commentLength = o.length;
      },
      getEntryCount: function() {
        return h ? s.length : c.diskEntries;
      },
      forEach: function(p) {
        this.entries.forEach(p);
      },
      /**
       * Returns a reference to the entry with the given name or null if entry is inexistent
       *
       * @param entryName
       * @return ZipEntry
       */
      getEntry: function(p) {
        return h || w(), a[p] || null;
      },
      /**
       * Adds the given entry to the entry list
       *
       * @param entry
       */
      setEntry: function(p) {
        h || w(), s.push(p), a[p.entryName] = p, c.totalEntries = s.length;
      },
      /**
       * Removes the file with the given name from the entry list.
       *
       * If the entry is a directory, then all nested files and directories will be removed
       * @param entryName
       * @returns {void}
       */
      deleteFile: function(p, E = !0) {
        h || w();
        const _ = a[p];
        this.getEntryChildren(_, E).map((b) => b.entryName).forEach(this.deleteEntry);
      },
      /**
       * Removes the entry with the given name from the entry list.
       *
       * @param {string} entryName
       * @returns {void}
       */
      deleteEntry: function(p) {
        h || w();
        const E = a[p], _ = s.indexOf(E);
        _ >= 0 && (s.splice(_, 1), delete a[p], c.totalEntries = s.length);
      },
      /**
       *  Iterates and returns all nested files and directories of the given entry
       *
       * @param entry
       * @return Array
       */
      getEntryChildren: function(p, E = !0) {
        if (h || w(), typeof p == "object")
          if (p.isDirectory && E) {
            const _ = [], y = p.entryName;
            for (const b of s)
              b.entryName.startsWith(y) && _.push(b);
            return _;
          } else
            return [p];
        return [];
      },
      /**
       *  How many child elements entry has
       *
       * @param {ZipEntry} entry
       * @return {integer}
       */
      getChildCount: function(p) {
        if (p && p.isDirectory) {
          const E = this.getEntryChildren(p);
          return E.includes(p) ? E.length - 1 : E.length;
        }
        return 0;
      },
      /**
       * Returns the zip file
       *
       * @return Buffer
       */
      compressToBuffer: function() {
        h || w(), v();
        const p = [], E = [];
        let _ = 0, y = 0;
        c.size = 0, c.offset = 0;
        let b = 0;
        for (const M of this.entries) {
          const k = M.getCompressedData();
          M.header.offset = y;
          const $ = M.packLocalHeader(), O = $.length + k.length;
          y += O, p.push($), p.push(k);
          const T = M.packCentralHeader();
          E.push(T), c.size += T.length, _ += O + T.length, b++;
        }
        _ += c.mainHeaderSize, c.offset = y, c.totalEntries = b, y = 0;
        const S = Buffer.alloc(_);
        for (const M of p)
          M.copy(S, y), y += M.length;
        for (const M of E)
          M.copy(S, y), y += M.length;
        const x = c.toBinary();
        return o && o.copy(x, r.Constants.ENDHDR), x.copy(S, y), n = S, h = !1, S;
      },
      toAsyncBuffer: function(p, E, _, y) {
        try {
          h || w(), v();
          const b = [], S = [];
          let x = 0, M = 0, k = 0;
          c.size = 0, c.offset = 0;
          const $ = function(O) {
            if (O.length > 0) {
              const T = O.shift(), I = T.entryName + T.extra.toString();
              _ && _(I), T.getCompressedDataAsync(function(N) {
                y && y(I), T.header.offset = M;
                const j = T.packLocalHeader(), C = j.length + N.length;
                M += C, b.push(j), b.push(N);
                const F = T.packCentralHeader();
                S.push(F), c.size += F.length, x += C + F.length, k++, $(O);
              });
            } else {
              x += c.mainHeaderSize, c.offset = M, c.totalEntries = k, M = 0;
              const T = Buffer.alloc(x);
              b.forEach(function(N) {
                N.copy(T, M), M += N.length;
              }), S.forEach(function(N) {
                N.copy(T, M), M += N.length;
              });
              const I = c.toBinary();
              o && o.copy(I, r.Constants.ENDHDR), I.copy(T, M), n = T, h = !1, p(T);
            }
          };
          $(Array.from(this.entries));
        } catch (b) {
          E(b);
        }
      }
    };
  }, Dc;
}
var jc, Ud;
function G_() {
  if (Ud) return jc;
  Ud = 1;
  const t = fi(), e = lt, r = Vm(), n = F_(), i = (...c) => t.findLast(c, (h) => typeof h == "boolean"), s = (...c) => t.findLast(c, (h) => typeof h == "string"), a = (...c) => t.findLast(c, (h) => typeof h == "function"), o = {
    // option "noSort" : if true it disables files sorting
    noSort: !1,
    // read entries during load (initial loading may be slower)
    readEntries: !1,
    // default method is none
    method: t.Constants.NONE,
    // file system
    fs: null
  };
  return jc = function(c, h) {
    let f = null;
    const u = Object.assign(/* @__PURE__ */ Object.create(null), o);
    c && typeof c == "object" && (c instanceof Uint8Array || (Object.assign(u, c), c = u.input ? u.input : void 0, u.input && delete u.input), Buffer.isBuffer(c) && (f = c, u.method = t.Constants.BUFFER, c = void 0)), Object.assign(u, h);
    const l = new t(u);
    if ((typeof u.decoder != "object" || typeof u.decoder.encode != "function" || typeof u.decoder.decode != "function") && (u.decoder = t.decoder), c && typeof c == "string")
      if (l.fs.existsSync(c))
        u.method = t.Constants.FILE, u.filename = c, f = l.fs.readFileSync(c);
      else
        throw t.Errors.INVALID_FILENAME();
    const d = new n(f, u), { canonical: g, sanitize: w, zipnamefix: m } = t;
    function v(y) {
      if (y && d) {
        var b;
        if (typeof y == "string" && (b = d.getEntry(e.posix.normalize(y))), typeof y == "object" && typeof y.entryName < "u" && typeof y.header < "u" && (b = d.getEntry(y.entryName)), b)
          return b;
      }
      return null;
    }
    function p(y) {
      const { join: b, normalize: S, sep: x } = e.posix;
      return b(e.isAbsolute(y) ? "/" : ".", S(x + y.split("\\").join(x) + x));
    }
    function E(y) {
      return y instanceof RegExp ? /* @__PURE__ */ (function(b) {
        return function(S) {
          return b.test(S);
        };
      })(y) : typeof y != "function" ? () => !0 : y;
    }
    const _ = (y, b) => {
      let S = b.slice(-1);
      return S = S === l.sep ? l.sep : "", e.relative(y, b) + S;
    };
    return {
      /**
       * Extracts the given entry from the archive and returns the content as a Buffer object
       * @param {ZipEntry|string} entry ZipEntry object or String with the full path of the entry
       * @param {Buffer|string} [pass] - password
       * @return Buffer or Null in case of error
       */
      readFile: function(y, b) {
        var S = v(y);
        return S && S.getData(b) || null;
      },
      /**
       * Returns how many child elements has on entry (directories) on files it is always 0
       * @param {ZipEntry|string} entry ZipEntry object or String with the full path of the entry
       * @returns {integer}
       */
      childCount: function(y) {
        const b = v(y);
        if (b)
          return d.getChildCount(b);
      },
      /**
       * Asynchronous readFile
       * @param {ZipEntry|string} entry ZipEntry object or String with the full path of the entry
       * @param {callback} callback
       *
       * @return Buffer or Null in case of error
       */
      readFileAsync: function(y, b) {
        var S = v(y);
        S ? S.getDataAsync(b) : b(null, "getEntry failed for:" + y);
      },
      /**
       * Extracts the given entry from the archive and returns the content as plain text in the given encoding
       * @param {ZipEntry|string} entry - ZipEntry object or String with the full path of the entry
       * @param {string} encoding - Optional. If no encoding is specified utf8 is used
       *
       * @return String
       */
      readAsText: function(y, b) {
        var S = v(y);
        if (S) {
          var x = S.getData();
          if (x && x.length)
            return x.toString(b || "utf8");
        }
        return "";
      },
      /**
       * Asynchronous readAsText
       * @param {ZipEntry|string} entry ZipEntry object or String with the full path of the entry
       * @param {callback} callback
       * @param {string} [encoding] - Optional. If no encoding is specified utf8 is used
       *
       * @return String
       */
      readAsTextAsync: function(y, b, S) {
        var x = v(y);
        x ? x.getDataAsync(function(M, k) {
          if (k) {
            b(M, k);
            return;
          }
          M && M.length ? b(M.toString(S || "utf8")) : b("");
        }) : b("");
      },
      /**
       * Remove the entry from the file or the entry and all it's nested directories and files if the given entry is a directory
       *
       * @param {ZipEntry|string} entry
       * @returns {void}
       */
      deleteFile: function(y, b = !0) {
        var S = v(y);
        S && d.deleteFile(S.entryName, b);
      },
      /**
       * Remove the entry from the file or directory without affecting any nested entries
       *
       * @param {ZipEntry|string} entry
       * @returns {void}
       */
      deleteEntry: function(y) {
        var b = v(y);
        b && d.deleteEntry(b.entryName);
      },
      /**
       * Adds a comment to the zip. The zip must be rewritten after adding the comment.
       *
       * @param {string} comment
       */
      addZipComment: function(y) {
        d.comment = y;
      },
      /**
       * Returns the zip comment
       *
       * @return String
       */
      getZipComment: function() {
        return d.comment || "";
      },
      /**
       * Adds a comment to a specified zipEntry. The zip must be rewritten after adding the comment
       * The comment cannot exceed 65535 characters in length
       *
       * @param {ZipEntry} entry
       * @param {string} comment
       */
      addZipEntryComment: function(y, b) {
        var S = v(y);
        S && (S.comment = b);
      },
      /**
       * Returns the comment of the specified entry
       *
       * @param {ZipEntry} entry
       * @return String
       */
      getZipEntryComment: function(y) {
        var b = v(y);
        return b && b.comment || "";
      },
      /**
       * Updates the content of an existing entry inside the archive. The zip must be rewritten after updating the content
       *
       * @param {ZipEntry} entry
       * @param {Buffer} content
       */
      updateFile: function(y, b) {
        var S = v(y);
        S && S.setData(b);
      },
      /**
       * Adds a file from the disk to the archive
       *
       * @param {string} localPath File to add to zip
       * @param {string} [zipPath] Optional path inside the zip
       * @param {string} [zipName] Optional name for the file
       * @param {string} [comment] Optional file comment
       */
      addLocalFile: function(y, b, S, x) {
        if (l.fs.existsSync(y)) {
          b = b ? p(b) : "";
          const M = e.win32.basename(e.win32.normalize(y));
          b += S || M;
          const k = l.fs.statSync(y), $ = k.isFile() ? l.fs.readFileSync(y) : Buffer.alloc(0);
          k.isDirectory() && (b += l.sep), this.addFile(b, $, x, k);
        } else
          throw t.Errors.FILE_NOT_FOUND(y);
      },
      /**
       * Callback for showing if everything was done.
       *
       * @callback doneCallback
       * @param {Error} err - Error object
       * @param {boolean} done - was request fully completed
       */
      /**
       * Adds a file from the disk to the archive
       *
       * @param {(object|string)} options - options object, if it is string it us used as localPath.
       * @param {string} options.localPath - Local path to the file.
       * @param {string} [options.comment] - Optional file comment.
       * @param {string} [options.zipPath] - Optional path inside the zip
       * @param {string} [options.zipName] - Optional name for the file
       * @param {doneCallback} callback - The callback that handles the response.
       */
      addLocalFileAsync: function(y, b) {
        y = typeof y == "object" ? y : { localPath: y };
        const S = e.resolve(y.localPath), { comment: x } = y;
        let { zipPath: M, zipName: k } = y;
        const $ = this;
        l.fs.stat(S, function(O, T) {
          if (O) return b(O, !1);
          M = M ? p(M) : "";
          const I = e.win32.basename(e.win32.normalize(S));
          if (M += k || I, T.isFile())
            l.fs.readFile(S, function(N, j) {
              return N ? b(N, !1) : ($.addFile(M, j, x, T), setImmediate(b, void 0, !0));
            });
          else if (T.isDirectory())
            return M += l.sep, $.addFile(M, Buffer.alloc(0), x, T), setImmediate(b, void 0, !0);
        });
      },
      /**
       * Adds a local directory and all its nested files and directories to the archive
       *
       * @param {string} localPath - local path to the folder
       * @param {string} [zipPath] - optional path inside zip
       * @param {(RegExp|function)} [filter] - optional RegExp or Function if files match will be included.
       */
      addLocalFolder: function(y, b, S) {
        if (S = E(S), b = b ? p(b) : "", y = e.normalize(y), l.fs.existsSync(y)) {
          const x = l.findFiles(y), M = this;
          if (x.length)
            for (const k of x) {
              const $ = e.join(b, _(y, k));
              S($) && M.addLocalFile(k, e.dirname($));
            }
        } else
          throw t.Errors.FILE_NOT_FOUND(y);
      },
      /**
       * Asynchronous addLocalFolder
       * @param {string} localPath
       * @param {callback} callback
       * @param {string} [zipPath] optional path inside zip
       * @param {RegExp|function} [filter] optional RegExp or Function if files match will
       *               be included.
       */
      addLocalFolderAsync: function(y, b, S, x) {
        x = E(x), S = S ? p(S) : "", y = e.normalize(y);
        var M = this;
        l.fs.open(y, "r", function(k) {
          if (k && k.code === "ENOENT")
            b(void 0, t.Errors.FILE_NOT_FOUND(y));
          else if (k)
            b(void 0, k);
          else {
            var $ = l.findFiles(y), O = -1, T = function() {
              if (O += 1, O < $.length) {
                var I = $[O], N = _(y, I).split("\\").join("/");
                N = N.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, ""), x(N) ? l.fs.stat(I, function(j, C) {
                  j && b(void 0, j), C.isFile() ? l.fs.readFile(I, function(F, q) {
                    F ? b(void 0, F) : (M.addFile(S + N, q, "", C), T());
                  }) : (M.addFile(S + N + "/", Buffer.alloc(0), "", C), T());
                }) : process.nextTick(() => {
                  T();
                });
              } else
                b(!0, void 0);
            };
            T();
          }
        });
      },
      /**
       * Adds a local directory and all its nested files and directories to the archive
       *
       * @param {object | string} options - options object, if it is string it us used as localPath.
       * @param {string} options.localPath - Local path to the folder.
       * @param {string} [options.zipPath] - optional path inside zip.
       * @param {RegExp|function} [options.filter] - optional RegExp or Function if files match will be included.
       * @param {function|string} [options.namefix] - optional function to help fix filename
       * @param {doneCallback} callback - The callback that handles the response.
       *
       */
      addLocalFolderAsync2: function(y, b) {
        const S = this;
        y = typeof y == "object" ? y : { localPath: y }, localPath = e.resolve(p(y.localPath));
        let { zipPath: x, filter: M, namefix: k } = y;
        M instanceof RegExp ? M = /* @__PURE__ */ (function(T) {
          return function(I) {
            return T.test(I);
          };
        })(M) : typeof M != "function" && (M = function() {
          return !0;
        }), x = x ? p(x) : "", k == "latin1" && (k = (T) => T.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "")), typeof k != "function" && (k = (T) => T);
        const $ = (T) => e.join(x, k(_(localPath, T))), O = (T) => e.win32.basename(e.win32.normalize(k(T)));
        l.fs.open(localPath, "r", function(T) {
          T && T.code === "ENOENT" ? b(void 0, t.Errors.FILE_NOT_FOUND(localPath)) : T ? b(void 0, T) : l.findFilesAsync(localPath, function(I, N) {
            if (I) return b(I);
            N = N.filter((j) => M($(j))), N.length || b(void 0, !1), setImmediate(
              N.reverse().reduce(function(j, C) {
                return function(F, q) {
                  if (F || q === !1) return setImmediate(j, F, !1);
                  S.addLocalFileAsync(
                    {
                      localPath: C,
                      zipPath: e.dirname($(C)),
                      zipName: O(C)
                    },
                    j
                  );
                };
              }, b)
            );
          });
        });
      },
      /**
       * Adds a local directory and all its nested files and directories to the archive
       *
       * @param {string} localPath - path where files will be extracted
       * @param {object} props - optional properties
       * @param {string} [props.zipPath] - optional path inside zip
       * @param {RegExp|function} [props.filter] - optional RegExp or Function if files match will be included.
       * @param {function|string} [props.namefix] - optional function to help fix filename
       */
      addLocalFolderPromise: function(y, b) {
        return new Promise((S, x) => {
          this.addLocalFolderAsync2(Object.assign({ localPath: y }, b), (M, k) => {
            M && x(M), k && S(this);
          });
        });
      },
      /**
       * Allows you to create a entry (file or directory) in the zip file.
       * If you want to create a directory the entryName must end in / and a null buffer should be provided.
       * Comment and attributes are optional
       *
       * @param {string} entryName
       * @param {Buffer | string} content - file content as buffer or utf8 coded string
       * @param {string} [comment] - file comment
       * @param {number | object} [attr] - number as unix file permissions, object as filesystem Stats object
       */
      addFile: function(y, b, S, x) {
        y = m(y);
        let M = v(y);
        const k = M != null;
        k || (M = new r(u), M.entryName = y), M.comment = S || "";
        const $ = typeof x == "object" && x instanceof l.fs.Stats;
        $ && (M.header.time = x.mtime);
        var O = M.isDirectory ? 16 : 0;
        let T = M.isDirectory ? 16384 : 32768;
        return $ ? T |= 4095 & x.mode : typeof x == "number" ? T |= 4095 & x : T |= M.isDirectory ? 493 : 420, O = (O | T << 16) >>> 0, M.attr = O, M.setData(b), k || d.setEntry(M), M;
      },
      /**
       * Returns an array of ZipEntry objects representing the files and folders inside the archive
       *
       * @param {string} [password]
       * @returns Array
       */
      getEntries: function(y) {
        return d.password = y, d ? d.entries : [];
      },
      /**
       * Returns a ZipEntry object representing the file or folder specified by ``name``.
       *
       * @param {string} name
       * @return ZipEntry
       */
      getEntry: function(y) {
        return v(y);
      },
      getEntryCount: function() {
        return d.getEntryCount();
      },
      forEach: function(y) {
        return d.forEach(y);
      },
      /**
       * Extracts the given entry to the given targetPath
       * If the entry is a directory inside the archive, the entire directory and it's subdirectories will be extracted
       *
       * @param {string|ZipEntry} entry - ZipEntry object or String with the full path of the entry
       * @param {string} targetPath - Target folder where to write the file
       * @param {boolean} [maintainEntryPath=true] - If maintainEntryPath is true and the entry is inside a folder, the entry folder will be created in targetPath as well. Default is TRUE
       * @param {boolean} [overwrite=false] - If the file already exists at the target path, the file will be overwriten if this is true.
       * @param {boolean} [keepOriginalPermission=false] - The file will be set as the permission from the entry if this is true.
       * @param {string} [outFileName] - String If set will override the filename of the extracted file (Only works if the entry is a file)
       *
       * @return Boolean
       */
      extractEntryTo: function(y, b, S, x, M, k) {
        x = i(!1, x), M = i(!1, M), S = i(!0, S), k = s(M, k);
        var $ = v(y);
        if (!$)
          throw t.Errors.NO_ENTRY();
        var O = g($.entryName), T = w(b, k && !$.isDirectory ? k : S ? O : e.basename(O));
        if ($.isDirectory) {
          var I = d.getEntryChildren($);
          return I.forEach(function(C) {
            if (C.isDirectory) return;
            var F = C.getData();
            if (!F)
              throw t.Errors.CANT_EXTRACT_FILE();
            var q = g(C.entryName), R = w(b, S ? q : e.basename(q));
            const D = M ? C.header.fileAttr : void 0;
            l.writeFileTo(R, F, x, D);
          }), !0;
        }
        var N = $.getData(d.password);
        if (!N) throw t.Errors.CANT_EXTRACT_FILE();
        if (l.fs.existsSync(T) && !x)
          throw t.Errors.CANT_OVERRIDE();
        const j = M ? y.header.fileAttr : void 0;
        return l.writeFileTo(T, N, x, j), !0;
      },
      /**
       * Test the archive
       * @param {string} [pass]
       */
      test: function(y) {
        if (!d)
          return !1;
        for (var b in d.entries)
          try {
            if (b.isDirectory)
              continue;
            var S = d.entries[b].getData(y);
            if (!S)
              return !1;
          } catch {
            return !1;
          }
        return !0;
      },
      /**
       * Extracts the entire archive to the given location
       *
       * @param {string} targetPath Target location
       * @param {boolean} [overwrite=false] If the file already exists at the target path, the file will be overwriten if this is true.
       *                  Default is FALSE
       * @param {boolean} [keepOriginalPermission=false] The file will be set as the permission from the entry if this is true.
       *                  Default is FALSE
       * @param {string|Buffer} [pass] password
       */
      extractAllTo: function(y, b, S, x) {
        if (S = i(!1, S), x = s(S, x), b = i(!1, b), !d) throw t.Errors.NO_ZIP();
        d.entries.forEach(function(M) {
          var k = w(y, g(M.entryName));
          if (M.isDirectory) {
            l.makeDir(k);
            return;
          }
          var $ = M.getData(x);
          if (!$)
            throw t.Errors.CANT_EXTRACT_FILE();
          const O = S ? M.header.fileAttr : void 0;
          l.writeFileTo(k, $, b, O);
          try {
            l.fs.utimesSync(k, M.header.time, M.header.time);
          } catch {
            throw t.Errors.CANT_EXTRACT_FILE();
          }
        });
      },
      /**
       * Asynchronous extractAllTo
       *
       * @param {string} targetPath Target location
       * @param {boolean} [overwrite=false] If the file already exists at the target path, the file will be overwriten if this is true.
       *                  Default is FALSE
       * @param {boolean} [keepOriginalPermission=false] The file will be set as the permission from the entry if this is true.
       *                  Default is FALSE
       * @param {function} callback The callback will be executed when all entries are extracted successfully or any error is thrown.
       */
      extractAllToAsync: function(y, b, S, x) {
        if (x = a(b, S, x), S = i(!1, S), b = i(!1, b), !x)
          return new Promise((T, I) => {
            this.extractAllToAsync(y, b, S, function(N) {
              N ? I(N) : T(this);
            });
          });
        if (!d) {
          x(t.Errors.NO_ZIP());
          return;
        }
        y = e.resolve(y);
        const M = (T) => w(y, e.normalize(g(T.entryName))), k = (T, I) => new Error(T + ': "' + I + '"'), $ = [], O = [];
        d.entries.forEach((T) => {
          T.isDirectory ? $.push(T) : O.push(T);
        });
        for (const T of $) {
          const I = M(T), N = S ? T.header.fileAttr : void 0;
          try {
            l.makeDir(I), N && l.fs.chmodSync(I, N), l.fs.utimesSync(I, T.header.time, T.header.time);
          } catch {
            x(k("Unable to create folder", I));
          }
        }
        O.reverse().reduce(function(T, I) {
          return function(N) {
            if (N)
              T(N);
            else {
              const j = e.normalize(g(I.entryName)), C = w(y, j);
              I.getDataAsync(function(F, q) {
                if (q)
                  T(q);
                else if (!F)
                  T(t.Errors.CANT_EXTRACT_FILE());
                else {
                  const R = S ? I.header.fileAttr : void 0;
                  l.writeFileToAsync(C, F, b, R, function(D) {
                    D || T(k("Unable to write file", C)), l.fs.utimes(C, I.header.time, I.header.time, function(G) {
                      G ? T(k("Unable to set times", C)) : T();
                    });
                  });
                }
              });
            }
          };
        }, x)();
      },
      /**
       * Writes the newly created zip file to disk at the specified location or if a zip was opened and no ``targetFileName`` is provided, it will overwrite the opened zip
       *
       * @param {string} targetFileName
       * @param {function} callback
       */
      writeZip: function(y, b) {
        if (arguments.length === 1 && typeof y == "function" && (b = y, y = ""), !y && u.filename && (y = u.filename), !!y) {
          var S = d.compressToBuffer();
          if (S) {
            var x = l.writeFileTo(y, S, !0);
            typeof b == "function" && b(x ? null : new Error("failed"), "");
          }
        }
      },
      /**
      	         *
      	         * @param {string} targetFileName
      	         * @param {object} [props]
      	         * @param {boolean} [props.overwrite=true] If the file already exists at the target path, the file will be overwriten if this is true.
      	         * @param {boolean} [props.perm] The file will be set as the permission from the entry if this is true.
      
      	         * @returns {Promise<void>}
      	         */
      writeZipPromise: function(y, b) {
        const { overwrite: S, perm: x } = Object.assign({ overwrite: !0 }, b);
        return new Promise((M, k) => {
          !y && u.filename && (y = u.filename), y || k("ADM-ZIP: ZIP File Name Missing"), this.toBufferPromise().then(($) => {
            const O = (T) => T ? M(T) : k("ADM-ZIP: Wasn't able to write zip file");
            l.writeFileToAsync(y, $, S, x, O);
          }, k);
        });
      },
      /**
       * @returns {Promise<Buffer>} A promise to the Buffer.
       */
      toBufferPromise: function() {
        return new Promise((y, b) => {
          d.toAsyncBuffer(y, b);
        });
      },
      /**
       * Returns the content of the entire zip file as a Buffer object
       *
       * @prop {function} [onSuccess]
       * @prop {function} [onFail]
       * @prop {function} [onItemStart]
       * @prop {function} [onItemEnd]
       * @returns {Buffer}
       */
      toBuffer: function(y, b, S, x) {
        return typeof y == "function" ? (d.toAsyncBuffer(y, b, S, x), null) : d.compressToBuffer();
      }
    };
  }, jc;
}
var z_ = G_();
const Hm = /* @__PURE__ */ an(z_);
var Tc, Bd;
function Rh() {
  if (Bd) return Tc;
  Bd = 1;
  var t = Gr;
  function e(n, i) {
    var s = [], a = [];
    s.push(n), (function o(c) {
      if (!c.length) return i(null, s, a);
      var h = 0, f = [];
      for (let u of c)
        t.readdir(u, { withFileTypes: !0 }, function(l, d) {
          if (l) return i(l);
          for (var g of d) {
            var w = `${u}/${g.name}`;
            g.isDirectory() ? (f.push(w), s.push(w)) : a.push(w);
          }
          ++h === c.length && o(f);
        });
    })([n]);
  }
  function r(n) {
    var i = [], s = [];
    return i.push(n), (function a(o) {
      if (!o.length) return { dirs: i, files: s };
      var c = 0, h = [];
      for (var f of o) {
        var u = t.readdirSync(f, { withFileTypes: !0 });
        for (var l of u) {
          var d = `${f}/${l.name}`;
          l.isDirectory() ? (h.push(d), i.push(d)) : s.push(d);
        }
        if (++c === o.length)
          return a(h);
      }
    })([n]);
  }
  return Tc = { async: e, sync: r }, Tc;
}
var Cc, Zd;
function q_() {
  if (Zd) return Cc;
  Zd = 1;
  var t = Gr, e = lt, r = Rh();
  function n(a, o, c) {
    r.async(a, function(h, f, u) {
      if (h) return c(h);
      i(a, o, f, function(l) {
        if (l) return c(l);
        s(a, o, u, c);
      });
    });
  }
  function i(a, o, c, h) {
    c.sort(), (function f(u) {
      if (u == c.length) return h();
      var l = e.relative(a, c[u]);
      l = e.join(o, l), t.exists(l, function(d) {
        if (d) return f(++u);
        t.mkdir(l, function(g) {
          if (g) return h(g);
          f(++u);
        });
      });
    })(0);
  }
  function s(a, o, c, h) {
    (function f(u) {
      if (u == c.length) return h();
      t.readFile(c[u], function(l, d) {
        if (l) return h(l);
        var g = e.relative(a, c[u]);
        g = e.join(o, g), t.writeFile(g, d, function(w) {
          if (w) return h(w);
          f(++u);
        });
      });
    })(0);
  }
  return Cc = {
    async: n,
    cpdirs: i,
    cpfiles: s
  }, Cc;
}
var Lc, Vd;
function U_() {
  if (Vd) return Lc;
  Vd = 1;
  var t = Gr, e = Rh();
  function r(s, a) {
    e.async(s, function(o, c, h) {
      if (o) return a(o);
      n(h, function(f) {
        if (f) return a(f);
        i(c, a);
      });
    });
  }
  function n(s, a) {
    (function o(c) {
      if (c == s.length) return a();
      t.unlink(s[c], function(h) {
        if (h) return a(h);
        o(++c);
      });
    })(0);
  }
  function i(s, a) {
    s.sort((o, c) => o > c ? -1 : o < c ? 1 : 0), (function o(c) {
      if (c == s.length) return a();
      t.rmdir(s[c], function(h) {
        if (h) return a(h);
        o(++c);
      });
    })(0);
  }
  return Lc = {
    async: r,
    rmdirs: i,
    rmfiles: n
  }, Lc;
}
var Fc, Hd;
function B_() {
  if (Hd) return Fc;
  Hd = 1;
  var t = Gr;
  function e(n, i) {
    var s = 0, a = 100;
    (function o(c, h) {
      if (!h.length) return i(null, s);
      var f = 0;
      for (var u of h)
        t.stat(u, (l, d) => {
          if (l) return i(l);
          s += d.size, ++f === h.length && (c += a, o(c, n.slice(c, c + a)));
        });
    })(0, n.slice(0, a));
  }
  function r(n) {
    var i = 0;
    for (var s of n)
      i += t.statSync(s).size;
    return { size: i };
  }
  return Fc = { async: e, sync: r }, Fc;
}
var Gc, Kd;
function Z_() {
  if (Kd) return Gc;
  Kd = 1;
  var t = (n, i) => (...s) => typeof s.slice(-1)[0] == "function" ? n(...s) : new Promise((a, o) => n(
    ...s,
    (...c) => c[0] ? o(c[0]) : i === "read" ? a({ dirs: c[1], files: c[2] }) : i === "size" ? a({ size: c[1] }) : a()
  )), e = {
    read: Rh(),
    copy: q_(),
    remove: U_(),
    size: B_()
  }, r = {
    read: t(e.read.async, "read"),
    copy: t(e.copy.async),
    remove: t(e.remove.async),
    size: t(e.size.async, "size"),
    sync: {
      read: e.read.sync,
      size: e.size.sync
    }
  };
  return r.cpdirs = t(e.copy.cpdirs), r.cpfiles = t(e.copy.cpfiles), r.rmfiles = t(e.remove.rmfiles), r.rmdirs = t(e.remove.rmdirs), r.readdirr = r.read, r.cpdirr = r.copy, r.rmdirr = r.remove, Gc = r, Gc;
}
var V_ = Z_();
const H_ = /* @__PURE__ */ an(V_);
var zc, Xd;
function K_() {
  if (Xd) return zc;
  Xd = 1;
  const { Transform: t } = ca, [e] = Buffer.from("\r"), [r] = Buffer.from(`
`), n = {
    escape: '"',
    headers: null,
    mapHeaders: ({ header: s }) => s,
    mapValues: ({ value: s }) => s,
    newline: `
`,
    quote: '"',
    raw: !1,
    separator: ",",
    skipComments: !1,
    skipLines: null,
    maxRowBytes: Number.MAX_SAFE_INTEGER,
    strict: !1,
    outputByteOffset: !1
  };
  class i extends t {
    constructor(a = {}) {
      super({ objectMode: !0, highWaterMark: 16 }), Array.isArray(a) && (a = { headers: a });
      const o = Object.assign({}, n, a);
      o.customNewline = o.newline !== n.newline;
      for (const c of ["newline", "quote", "separator"])
        typeof o[c] < "u" && ([o[c]] = Buffer.from(o[c]));
      o.escape = (a || {}).escape ? Buffer.from(o.escape)[0] : o.quote, this.state = {
        empty: o.raw ? Buffer.alloc(0) : "",
        escaped: !1,
        first: !0,
        lineNumber: 0,
        previousEnd: 0,
        rowLength: 0,
        quoted: !1
      }, this._prev = null, o.headers === !1 && (o.strict = !1), (o.headers || o.headers === !1) && (this.state.first = !1), this.options = o, this.headers = o.headers, this.bytesRead = 0;
    }
    parseCell(a, o, c) {
      const { escape: h, quote: f } = this.options;
      a[o] === f && a[c - 1] === f && (o++, c--);
      let u = o;
      for (let l = o; l < c; l++)
        a[l] === h && l + 1 < c && a[l + 1] === f && l++, u !== l && (a[u] = a[l]), u++;
      return this.parseValue(a, o, u);
    }
    parseLine(a, o, c) {
      const { customNewline: h, escape: f, mapHeaders: u, mapValues: l, quote: d, separator: g, skipComments: w, skipLines: m } = this.options;
      c--, !h && a.length && a[c - 1] === e && c--;
      const v = g, p = [];
      let E = !1, _ = o;
      if (w) {
        const S = typeof w == "string" ? w : "#";
        if (a[o] === Buffer.from(S)[0])
          return;
      }
      const y = (S) => {
        if (this.state.first)
          return S;
        const x = p.length, M = this.headers[x];
        return l({ header: M, index: x, value: S });
      };
      for (let S = o; S < c; S++) {
        const x = !E && a[S] === d, M = E && a[S] === d && S + 1 <= c && a[S + 1] === v, k = E && a[S] === f && S + 1 < c && a[S + 1] === d;
        if (x || M) {
          E = !E;
          continue;
        } else if (k) {
          S++;
          continue;
        }
        if (a[S] === v && !E) {
          let $ = this.parseCell(a, _, S);
          $ = y($), p.push($), _ = S + 1;
        }
      }
      if (_ < c) {
        let S = this.parseCell(a, _, c);
        S = y(S), p.push(S);
      }
      a[c - 1] === v && p.push(y(this.state.empty));
      const b = m && m > this.state.lineNumber;
      if (this.state.lineNumber++, this.state.first && !b) {
        this.state.first = !1, this.headers = p.map((S, x) => u({ header: S, index: x })), this.emit("headers", this.headers);
        return;
      }
      if (!b && this.options.strict && p.length !== this.headers.length) {
        const S = new RangeError("Row length does not match headers");
        this.emit("error", S);
      } else if (!b) {
        const S = this.bytesRead - a.length + o;
        this.writeRow(p, S);
      }
    }
    parseValue(a, o, c) {
      return this.options.raw ? a.slice(o, c) : a.toString("utf-8", o, c);
    }
    writeRow(a, o) {
      const c = this.headers === !1 ? a.map((f, u) => u) : this.headers, h = a.reduce((f, u, l) => {
        const d = c[l];
        return d === null || (d !== void 0 ? f[d] = u : f[`_${l}`] = u), f;
      }, {});
      this.options.outputByteOffset ? this.push({ row: h, byteOffset: o }) : this.push(h);
    }
    _flush(a) {
      if (this.state.escaped || !this._prev) return a();
      this.parseLine(this._prev, this.state.previousEnd, this._prev.length + 1), a();
    }
    _transform(a, o, c) {
      typeof a == "string" && (a = Buffer.from(a));
      const { escape: h, quote: f } = this.options;
      let u = 0, l = a;
      this.bytesRead += a.byteLength, this._prev && (u = this._prev.length, l = Buffer.concat([this._prev, a]), this._prev = null);
      const d = l.length;
      for (let g = u; g < d; g++) {
        const w = l[g], m = g + 1 < d ? l[g + 1] : null;
        if (this.state.rowLength++, this.state.rowLength > this.options.maxRowBytes)
          return c(new Error("Row exceeds the maximum size"));
        if (!this.state.escaped && w === h && m === f && g !== u) {
          this.state.escaped = !0;
          continue;
        } else if (w === f) {
          this.state.escaped ? this.state.escaped = !1 : this.state.quoted = !this.state.quoted;
          continue;
        }
        this.state.quoted || (this.state.first && !this.options.customNewline && (w === r ? this.options.newline = r : w === e && m !== r && (this.options.newline = e)), w === this.options.newline && (this.parseLine(l, this.state.previousEnd, g + 1), this.state.previousEnd = g + 1, this.state.rowLength = 0));
      }
      if (this.state.previousEnd === d)
        return this.state.previousEnd = 0, c();
      if (d - this.state.previousEnd < a.length)
        return this._prev = a, this.state.previousEnd -= d - a.length, c();
      this._prev = l, c();
    }
  }
  return zc = (s) => new i(s), zc;
}
var X_ = K_();
const W_ = /* @__PURE__ */ an(X_);
function J_(t) {
  t("EPSG:4326", "+title=WGS 84 (long/lat) +proj=longlat +ellps=WGS84 +datum=WGS84 +units=degrees"), t("EPSG:4269", "+title=NAD83 (long/lat) +proj=longlat +a=6378137.0 +b=6356752.31414036 +ellps=GRS80 +datum=NAD83 +units=degrees"), t("EPSG:3857", "+title=WGS 84 / Pseudo-Mercator +proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs");
  for (var e = 1; e <= 60; ++e)
    t("EPSG:" + (32600 + e), "+proj=utm +zone=" + e + " +datum=WGS84 +units=m"), t("EPSG:" + (32700 + e), "+proj=utm +zone=" + e + " +south +datum=WGS84 +units=m");
  t("EPSG:5041", "+title=WGS 84 / UPS North (E,N) +proj=stere +lat_0=90 +lon_0=0 +k=0.994 +x_0=2000000 +y_0=2000000 +datum=WGS84 +units=m"), t("EPSG:5042", "+title=WGS 84 / UPS South (E,N) +proj=stere +lat_0=-90 +lon_0=0 +k=0.994 +x_0=2000000 +y_0=2000000 +datum=WGS84 +units=m"), t.WGS84 = t["EPSG:4326"], t["EPSG:3785"] = t["EPSG:3857"], t.GOOGLE = t["EPSG:3857"], t["EPSG:900913"] = t["EPSG:3857"], t["EPSG:102113"] = t["EPSG:3857"];
}
var nn = 1, sn = 2, xn = 3, Y_ = 4, ih = 5, Wd = 6378137, Q_ = 6356752314e-3, Jd = 0.0066943799901413165, Wn = 484813681109536e-20, st = Math.PI / 2, tv = 0.16666666666666666, ev = 0.04722222222222222, rv = 0.022156084656084655, pt = 1e-10, Yt = 0.017453292519943295, Ne = 57.29577951308232, zt = Math.PI / 4, ei = Math.PI * 2, Qt = 3.14159265359, Re = {};
Re.greenwich = 0;
Re.lisbon = -9.131906111111;
Re.paris = 2.337229166667;
Re.bogota = -74.080916666667;
Re.madrid = -3.687938888889;
Re.rome = 12.452333333333;
Re.bern = 7.439583333333;
Re.jakarta = 106.807719444444;
Re.ferro = -17.666666666667;
Re.brussels = 4.367975;
Re.stockholm = 18.058277777778;
Re.athens = 23.7163375;
Re.oslo = 10.722916666667;
const nv = {
  mm: { to_meter: 1e-3 },
  cm: { to_meter: 0.01 },
  ft: { to_meter: 0.3048 },
  "us-ft": { to_meter: 1200 / 3937 },
  fath: { to_meter: 1.8288 },
  kmi: { to_meter: 1852 },
  "us-ch": { to_meter: 20.1168402336805 },
  "us-mi": { to_meter: 1609.34721869444 },
  km: { to_meter: 1e3 },
  "ind-ft": { to_meter: 0.30479841 },
  "ind-yd": { to_meter: 0.91439523 },
  mi: { to_meter: 1609.344 },
  yd: { to_meter: 0.9144 },
  ch: { to_meter: 20.1168 },
  link: { to_meter: 0.201168 },
  dm: { to_meter: 0.1 },
  in: { to_meter: 0.0254 },
  "ind-ch": { to_meter: 20.11669506 },
  "us-in": { to_meter: 0.025400050800101 },
  "us-yd": { to_meter: 0.914401828803658 }
};
var Yd = /[\s_\-\/\(\)]/g;
function Lr(t, e) {
  if (t[e])
    return t[e];
  for (var r = Object.keys(t), n = e.toLowerCase().replace(Yd, ""), i = -1, s, a; ++i < r.length; )
    if (s = r[i], a = s.toLowerCase().replace(Yd, ""), a === n)
      return t[s];
}
function sh(t) {
  var e = {}, r = t.split("+").map(function(o) {
    return o.trim();
  }).filter(function(o) {
    return o;
  }).reduce(function(o, c) {
    var h = c.split("=");
    return h.push(!0), o[h[0].toLowerCase()] = h[1], o;
  }, {}), n, i, s, a = {
    proj: "projName",
    datum: "datumCode",
    rf: function(o) {
      e.rf = parseFloat(o);
    },
    lat_0: function(o) {
      e.lat0 = o * Yt;
    },
    lat_1: function(o) {
      e.lat1 = o * Yt;
    },
    lat_2: function(o) {
      e.lat2 = o * Yt;
    },
    lat_ts: function(o) {
      e.lat_ts = o * Yt;
    },
    lon_0: function(o) {
      e.long0 = o * Yt;
    },
    lon_1: function(o) {
      e.long1 = o * Yt;
    },
    lon_2: function(o) {
      e.long2 = o * Yt;
    },
    alpha: function(o) {
      e.alpha = parseFloat(o) * Yt;
    },
    gamma: function(o) {
      e.rectified_grid_angle = parseFloat(o) * Yt;
    },
    lonc: function(o) {
      e.longc = o * Yt;
    },
    x_0: function(o) {
      e.x0 = parseFloat(o);
    },
    y_0: function(o) {
      e.y0 = parseFloat(o);
    },
    k_0: function(o) {
      e.k0 = parseFloat(o);
    },
    k: function(o) {
      e.k0 = parseFloat(o);
    },
    a: function(o) {
      e.a = parseFloat(o);
    },
    b: function(o) {
      e.b = parseFloat(o);
    },
    r: function(o) {
      e.a = e.b = parseFloat(o);
    },
    r_a: function() {
      e.R_A = !0;
    },
    zone: function(o) {
      e.zone = parseInt(o, 10);
    },
    south: function() {
      e.utmSouth = !0;
    },
    towgs84: function(o) {
      e.datum_params = o.split(",").map(function(c) {
        return parseFloat(c);
      });
    },
    to_meter: function(o) {
      e.to_meter = parseFloat(o);
    },
    units: function(o) {
      e.units = o;
      var c = Lr(nv, o);
      c && (e.to_meter = c.to_meter);
    },
    from_greenwich: function(o) {
      e.from_greenwich = o * Yt;
    },
    pm: function(o) {
      var c = Lr(Re, o);
      e.from_greenwich = (c || parseFloat(o)) * Yt;
    },
    nadgrids: function(o) {
      o === "@null" ? e.datumCode = "none" : e.nadgrids = o;
    },
    axis: function(o) {
      var c = "ewnsud";
      o.length === 3 && c.indexOf(o.substr(0, 1)) !== -1 && c.indexOf(o.substr(1, 1)) !== -1 && c.indexOf(o.substr(2, 1)) !== -1 && (e.axis = o);
    },
    approx: function() {
      e.approx = !0;
    },
    over: function() {
      e.over = !0;
    }
  };
  for (n in r)
    i = r[n], n in a ? (s = a[n], typeof s == "function" ? s(i) : e[s] = i) : e[n] = i;
  return typeof e.datumCode == "string" && e.datumCode !== "WGS84" && (e.datumCode = e.datumCode.toLowerCase()), e.projStr = t, e;
}
class Km {
  static getId(e) {
    const r = e.find((n) => Array.isArray(n) && n[0] === "ID");
    return r && r.length >= 3 ? {
      authority: r[1],
      code: parseInt(r[2], 10)
    } : null;
  }
  static convertUnit(e, r = "unit") {
    if (!e || e.length < 3)
      return { type: r, name: "unknown", conversion_factor: null };
    const n = e[1], i = parseFloat(e[2]) || null, s = e.find((o) => Array.isArray(o) && o[0] === "ID"), a = s ? {
      authority: s[1],
      code: parseInt(s[2], 10)
    } : null;
    return {
      type: r,
      name: n,
      conversion_factor: i,
      id: a
    };
  }
  static convertAxis(e) {
    const r = e[1] || "Unknown";
    let n;
    const i = r.match(/^\((.)\)$/);
    if (i) {
      const h = i[1].toUpperCase();
      if (h === "E") n = "east";
      else if (h === "N") n = "north";
      else if (h === "U") n = "up";
      else if (e[2]) n = e[2];
      else throw new Error(`Unknown axis abbreviation: ${h}`);
    } else
      n = e[2] || "unknown";
    const s = e.find((h) => Array.isArray(h) && h[0] === "ORDER"), a = s ? parseInt(s[1], 10) : null, o = e.find(
      (h) => Array.isArray(h) && (h[0] === "LENGTHUNIT" || h[0] === "ANGLEUNIT" || h[0] === "SCALEUNIT")
    ), c = this.convertUnit(o);
    return {
      name: r,
      direction: n,
      // Use the valid PROJJSON direction value
      unit: c,
      order: a
    };
  }
  static extractAxes(e) {
    return e.filter((r) => Array.isArray(r) && r[0] === "AXIS").map((r) => this.convertAxis(r)).sort((r, n) => (r.order || 0) - (n.order || 0));
  }
  static convert(e, r = {}) {
    switch (e[0]) {
      case "PROJCRS":
        r.type = "ProjectedCRS", r.name = e[1], r.base_crs = e.find((l) => Array.isArray(l) && l[0] === "BASEGEOGCRS") ? this.convert(e.find((l) => Array.isArray(l) && l[0] === "BASEGEOGCRS")) : null, r.conversion = e.find((l) => Array.isArray(l) && l[0] === "CONVERSION") ? this.convert(e.find((l) => Array.isArray(l) && l[0] === "CONVERSION")) : null;
        const n = e.find((l) => Array.isArray(l) && l[0] === "CS");
        n && (r.coordinate_system = {
          type: n[1],
          axis: this.extractAxes(e)
        });
        const i = e.find((l) => Array.isArray(l) && l[0] === "LENGTHUNIT");
        if (i) {
          const l = this.convertUnit(i);
          r.coordinate_system.unit = l;
        }
        r.id = this.getId(e);
        break;
      case "BASEGEOGCRS":
      case "GEOGCRS":
      case "GEODCRS":
        r.type = e[0] === "GEODCRS" ? "GeodeticCRS" : "GeographicCRS", r.name = e[1];
        const s = e.find(
          (l) => Array.isArray(l) && (l[0] === "DATUM" || l[0] === "ENSEMBLE")
        );
        if (s) {
          const l = this.convert(s);
          s[0] === "ENSEMBLE" ? r.datum_ensemble = l : r.datum = l;
          const d = e.find((g) => Array.isArray(g) && g[0] === "PRIMEM");
          d && d[1] !== "Greenwich" && (l.prime_meridian = {
            name: d[1],
            longitude: parseFloat(d[2])
          });
        }
        r.coordinate_system = {
          type: "ellipsoidal",
          axis: this.extractAxes(e)
        }, r.id = this.getId(e);
        break;
      case "DATUM":
        r.type = "GeodeticReferenceFrame", r.name = e[1], r.ellipsoid = e.find((l) => Array.isArray(l) && l[0] === "ELLIPSOID") ? this.convert(e.find((l) => Array.isArray(l) && l[0] === "ELLIPSOID")) : null;
        break;
      case "ENSEMBLE":
        r.type = "DatumEnsemble", r.name = e[1], r.members = e.filter((l) => Array.isArray(l) && l[0] === "MEMBER").map((l) => ({
          type: "DatumEnsembleMember",
          name: l[1],
          id: this.getId(l)
          // Extract ID as { authority, code }
        }));
        const a = e.find((l) => Array.isArray(l) && l[0] === "ENSEMBLEACCURACY");
        a && (r.accuracy = parseFloat(a[1]));
        const o = e.find((l) => Array.isArray(l) && l[0] === "ELLIPSOID");
        o && (r.ellipsoid = this.convert(o)), r.id = this.getId(e);
        break;
      case "ELLIPSOID":
        r.type = "Ellipsoid", r.name = e[1], r.semi_major_axis = parseFloat(e[2]), r.inverse_flattening = parseFloat(e[3]), e.find((l) => Array.isArray(l) && l[0] === "LENGTHUNIT") && this.convert(e.find((l) => Array.isArray(l) && l[0] === "LENGTHUNIT"), r);
        break;
      case "CONVERSION":
        r.type = "Conversion", r.name = e[1], r.method = e.find((l) => Array.isArray(l) && l[0] === "METHOD") ? this.convert(e.find((l) => Array.isArray(l) && l[0] === "METHOD")) : null, r.parameters = e.filter((l) => Array.isArray(l) && l[0] === "PARAMETER").map((l) => this.convert(l));
        break;
      case "METHOD":
        r.type = "Method", r.name = e[1], r.id = this.getId(e);
        break;
      case "PARAMETER":
        r.type = "Parameter", r.name = e[1], r.value = parseFloat(e[2]), r.unit = this.convertUnit(
          e.find(
            (l) => Array.isArray(l) && (l[0] === "LENGTHUNIT" || l[0] === "ANGLEUNIT" || l[0] === "SCALEUNIT")
          )
        ), r.id = this.getId(e);
        break;
      case "BOUNDCRS":
        r.type = "BoundCRS";
        const c = e.find((l) => Array.isArray(l) && l[0] === "SOURCECRS");
        if (c) {
          const l = c.find((d) => Array.isArray(d));
          r.source_crs = l ? this.convert(l) : null;
        }
        const h = e.find((l) => Array.isArray(l) && l[0] === "TARGETCRS");
        if (h) {
          const l = h.find((d) => Array.isArray(d));
          r.target_crs = l ? this.convert(l) : null;
        }
        const f = e.find((l) => Array.isArray(l) && l[0] === "ABRIDGEDTRANSFORMATION");
        f ? r.transformation = this.convert(f) : r.transformation = null;
        break;
      case "ABRIDGEDTRANSFORMATION":
        if (r.type = "Transformation", r.name = e[1], r.method = e.find((l) => Array.isArray(l) && l[0] === "METHOD") ? this.convert(e.find((l) => Array.isArray(l) && l[0] === "METHOD")) : null, r.parameters = e.filter((l) => Array.isArray(l) && (l[0] === "PARAMETER" || l[0] === "PARAMETERFILE")).map((l) => {
          if (l[0] === "PARAMETER")
            return this.convert(l);
          if (l[0] === "PARAMETERFILE")
            return {
              name: l[1],
              value: l[2],
              id: {
                authority: "EPSG",
                code: 8656
              }
            };
        }), r.parameters.length === 7) {
          const l = r.parameters[6];
          l.name === "Scale difference" && (l.value = Math.round((l.value - 1) * 1e12) / 1e6);
        }
        r.id = this.getId(e);
        break;
      case "AXIS":
        r.coordinate_system || (r.coordinate_system = { type: "unspecified", axis: [] }), r.coordinate_system.axis.push(this.convertAxis(e));
        break;
      case "LENGTHUNIT":
        const u = this.convertUnit(e, "LinearUnit");
        r.coordinate_system && r.coordinate_system.axis && r.coordinate_system.axis.forEach((l) => {
          l.unit || (l.unit = u);
        }), u.conversion_factor && u.conversion_factor !== 1 && r.semi_major_axis && (r.semi_major_axis = {
          value: r.semi_major_axis,
          unit: u
        });
        break;
      default:
        r.keyword = e[0];
        break;
    }
    return r;
  }
}
class iv extends Km {
  static convert(e, r = {}) {
    return super.convert(e, r), r.coordinate_system && r.coordinate_system.subtype === "Cartesian" && delete r.coordinate_system, r.usage && delete r.usage, r;
  }
}
class sv extends Km {
  static convert(e, r = {}) {
    super.convert(e, r);
    const n = e.find((s) => Array.isArray(s) && s[0] === "CS");
    n && (r.coordinate_system = {
      subtype: n[1],
      axis: this.extractAxes(e)
    });
    const i = e.find((s) => Array.isArray(s) && s[0] === "USAGE");
    if (i) {
      const s = i.find((c) => Array.isArray(c) && c[0] === "SCOPE"), a = i.find((c) => Array.isArray(c) && c[0] === "AREA"), o = i.find((c) => Array.isArray(c) && c[0] === "BBOX");
      r.usage = {}, s && (r.usage.scope = s[1]), a && (r.usage.area = a[1]), o && (r.usage.bbox = o.slice(1));
    }
    return r;
  }
}
function av(t) {
  return t.find((e) => Array.isArray(e) && e[0] === "USAGE") ? "2019" : (t.find((e) => Array.isArray(e) && e[0] === "CS") || t[0] === "BOUNDCRS" || t[0] === "PROJCRS" || t[0] === "GEOGCRS", "2015");
}
function ov(t) {
  return (av(t) === "2019" ? sv : iv).convert(t);
}
function cv(t) {
  const e = t.toUpperCase();
  return e.includes("PROJCRS") || e.includes("GEOGCRS") || e.includes("BOUNDCRS") || e.includes("VERTCRS") || e.includes("LENGTHUNIT") || e.includes("ANGLEUNIT") || e.includes("SCALEUNIT") ? "WKT2" : (e.includes("PROJCS") || e.includes("GEOGCS") || e.includes("LOCAL_CS") || e.includes("VERT_CS") || e.includes("UNIT"), "WKT1");
}
var ri = 1, Xm = 2, Wm = 3, Qs = 4, Jm = 5, Dh = -1, hv = /\s/, lv = /[A-Za-z]/, uv = /[A-Za-z84_]/, ba = /[,\]]/, Ym = /[\d\.E\-\+]/;
function Sr(t) {
  if (typeof t != "string")
    throw new Error("not a string");
  this.text = t.trim(), this.level = 0, this.place = 0, this.root = null, this.stack = [], this.currentObject = null, this.state = ri;
}
Sr.prototype.readCharicter = function() {
  var t = this.text[this.place++];
  if (this.state !== Qs)
    for (; hv.test(t); ) {
      if (this.place >= this.text.length)
        return;
      t = this.text[this.place++];
    }
  switch (this.state) {
    case ri:
      return this.neutral(t);
    case Xm:
      return this.keyword(t);
    case Qs:
      return this.quoted(t);
    case Jm:
      return this.afterquote(t);
    case Wm:
      return this.number(t);
    case Dh:
      return;
  }
};
Sr.prototype.afterquote = function(t) {
  if (t === '"') {
    this.word += '"', this.state = Qs;
    return;
  }
  if (ba.test(t)) {
    this.word = this.word.trim(), this.afterItem(t);
    return;
  }
  throw new Error(`havn't handled "` + t + '" in afterquote yet, index ' + this.place);
};
Sr.prototype.afterItem = function(t) {
  if (t === ",") {
    this.word !== null && this.currentObject.push(this.word), this.word = null, this.state = ri;
    return;
  }
  if (t === "]") {
    this.level--, this.word !== null && (this.currentObject.push(this.word), this.word = null), this.state = ri, this.currentObject = this.stack.pop(), this.currentObject || (this.state = Dh);
    return;
  }
};
Sr.prototype.number = function(t) {
  if (Ym.test(t)) {
    this.word += t;
    return;
  }
  if (ba.test(t)) {
    this.word = parseFloat(this.word), this.afterItem(t);
    return;
  }
  throw new Error(`havn't handled "` + t + '" in number yet, index ' + this.place);
};
Sr.prototype.quoted = function(t) {
  if (t === '"') {
    this.state = Jm;
    return;
  }
  this.word += t;
};
Sr.prototype.keyword = function(t) {
  if (uv.test(t)) {
    this.word += t;
    return;
  }
  if (t === "[") {
    var e = [];
    e.push(this.word), this.level++, this.root === null ? this.root = e : this.currentObject.push(e), this.stack.push(this.currentObject), this.currentObject = e, this.state = ri;
    return;
  }
  if (ba.test(t)) {
    this.afterItem(t);
    return;
  }
  throw new Error(`havn't handled "` + t + '" in keyword yet, index ' + this.place);
};
Sr.prototype.neutral = function(t) {
  if (lv.test(t)) {
    this.word = t, this.state = Xm;
    return;
  }
  if (t === '"') {
    this.word = "", this.state = Qs;
    return;
  }
  if (Ym.test(t)) {
    this.word = t, this.state = Wm;
    return;
  }
  if (ba.test(t)) {
    this.afterItem(t);
    return;
  }
  throw new Error(`havn't handled "` + t + '" in neutral yet, index ' + this.place);
};
Sr.prototype.output = function() {
  for (; this.place < this.text.length; )
    this.readCharicter();
  if (this.state === Dh)
    return this.root;
  throw new Error('unable to parse string "' + this.text + '". State is ' + this.state);
};
function fv(t) {
  var e = new Sr(t);
  return e.output();
}
function qc(t, e, r) {
  Array.isArray(e) && (r.unshift(e), e = null);
  var n = e ? {} : t, i = r.reduce(function(s, a) {
    return vn(a, s), s;
  }, n);
  e && (t[e] = i);
}
function vn(t, e) {
  if (!Array.isArray(t)) {
    e[t] = !0;
    return;
  }
  var r = t.shift();
  if (r === "PARAMETER" && (r = t.shift()), t.length === 1) {
    if (Array.isArray(t[0])) {
      e[r] = {}, vn(t[0], e[r]);
      return;
    }
    e[r] = t[0];
    return;
  }
  if (!t.length) {
    e[r] = !0;
    return;
  }
  if (r === "TOWGS84") {
    e[r] = t;
    return;
  }
  if (r === "AXIS") {
    r in e || (e[r] = []), e[r].push(t);
    return;
  }
  Array.isArray(r) || (e[r] = {});
  var n;
  switch (r) {
    case "UNIT":
    case "PRIMEM":
    case "VERT_DATUM":
      e[r] = {
        name: t[0].toLowerCase(),
        convert: t[1]
      }, t.length === 3 && vn(t[2], e[r]);
      return;
    case "SPHEROID":
    case "ELLIPSOID":
      e[r] = {
        name: t[0],
        a: t[1],
        rf: t[2]
      }, t.length === 4 && vn(t[3], e[r]);
      return;
    case "EDATUM":
    case "ENGINEERINGDATUM":
    case "LOCAL_DATUM":
    case "DATUM":
    case "VERT_CS":
    case "VERTCRS":
    case "VERTICALCRS":
      t[0] = ["name", t[0]], qc(e, r, t);
      return;
    case "COMPD_CS":
    case "COMPOUNDCRS":
    case "FITTED_CS":
    // the followings are the crs defined in
    // https://github.com/proj4js/proj4js/blob/1da4ed0b865d0fcb51c136090569210cdcc9019e/lib/parseCode.js#L11
    case "PROJECTEDCRS":
    case "PROJCRS":
    case "GEOGCS":
    case "GEOCCS":
    case "PROJCS":
    case "LOCAL_CS":
    case "GEODCRS":
    case "GEODETICCRS":
    case "GEODETICDATUM":
    case "ENGCRS":
    case "ENGINEERINGCRS":
      t[0] = ["name", t[0]], qc(e, r, t), e[r].type = r;
      return;
    default:
      for (n = -1; ++n < t.length; )
        if (!Array.isArray(t[n]))
          return vn(t, e[r]);
      return qc(e, r, t);
  }
}
var dv = 0.017453292519943295;
function Ke(t) {
  return t * dv;
}
function Qm(t) {
  const e = (t.projName || "").toLowerCase().replace(/_/g, " ");
  !t.long0 && t.longc && (e === "albers conic equal area" || e === "lambert azimuthal equal area") && (t.long0 = t.longc), !t.lat_ts && t.lat1 && (e === "stereographic south pole" || e === "polar stereographic (variant b)") ? (t.lat0 = Ke(t.lat1 > 0 ? 90 : -90), t.lat_ts = t.lat1, delete t.lat1) : !t.lat_ts && t.lat0 && (e === "polar stereographic" || e === "polar stereographic (variant a)") && (t.lat_ts = t.lat0, t.lat0 = Ke(t.lat0 > 0 ? 90 : -90), delete t.lat1);
}
function Qd(t) {
  let e = { units: null, to_meter: void 0 };
  return typeof t == "string" ? (e.units = t.toLowerCase(), e.units === "metre" && (e.units = "meter"), e.units === "meter" && (e.to_meter = 1)) : t && t.name && (e.units = t.name.toLowerCase(), e.units === "metre" && (e.units = "meter"), e.to_meter = t.conversion_factor), e;
}
function t0(t) {
  return typeof t == "object" ? t.value * t.unit.conversion_factor : t;
}
function e0(t, e) {
  t.ellipsoid.radius ? (e.a = t.ellipsoid.radius, e.rf = 0) : (e.a = t0(t.ellipsoid.semi_major_axis), t.ellipsoid.inverse_flattening !== void 0 ? e.rf = t.ellipsoid.inverse_flattening : t.ellipsoid.semi_major_axis !== void 0 && t.ellipsoid.semi_minor_axis !== void 0 && (e.rf = e.a / (e.a - t0(t.ellipsoid.semi_minor_axis))));
}
function ta(t, e = {}) {
  return !t || typeof t != "object" ? t : t.type === "BoundCRS" ? (ta(t.source_crs, e), t.transformation && (t.transformation.method && t.transformation.method.name === "NTv2" ? e.nadgrids = t.transformation.parameters[0].value : e.datum_params = t.transformation.parameters.map((r) => r.value)), e) : (Object.keys(t).forEach((r) => {
    const n = t[r];
    if (n !== null)
      switch (r) {
        case "name":
          if (e.srsCode)
            break;
          e.name = n, e.srsCode = n;
          break;
        case "type":
          n === "GeographicCRS" ? e.projName = "longlat" : n === "GeodeticCRS" ? t.coordinate_system && t.coordinate_system.subtype === "Cartesian" ? e.projName = "geocent" : e.projName = "longlat" : n === "ProjectedCRS" && t.conversion && t.conversion.method && (e.projName = t.conversion.method.name);
          break;
        case "datum":
        case "datum_ensemble":
          n.ellipsoid && (e.ellps = n.ellipsoid.name, e0(n, e)), n.prime_meridian && (e.from_greenwich = n.prime_meridian.longitude * Math.PI / 180);
          break;
        case "ellipsoid":
          e.ellps = n.name, e0(n, e);
          break;
        case "prime_meridian":
          e.long0 = (n.longitude || 0) * Math.PI / 180;
          break;
        case "coordinate_system":
          if (n.axis) {
            const i = {
              east: "e",
              north: "n",
              west: "w",
              south: "s",
              up: "u",
              down: "d",
              geocentricx: "e",
              geocentricy: "n",
              geocentricz: "u"
            }, s = n.axis.map((a) => i[a.direction.toLowerCase()]);
            if (s.every(Boolean) && (e.axis = s.join(""), e.axis.length === 2 && (e.axis += "u")), n.unit) {
              const { units: a, to_meter: o } = Qd(n.unit);
              e.units = a, e.to_meter = o;
            } else if (n.axis[0] && n.axis[0].unit) {
              const { units: a, to_meter: o } = Qd(n.axis[0].unit);
              e.units = a, e.to_meter = o;
            }
          }
          break;
        case "id":
          n.authority && n.code && (e.title = n.authority + ":" + n.code);
          break;
        case "conversion":
          n.method && n.method.name && (e.projName = n.method.name), n.parameters && n.parameters.forEach((i) => {
            const s = i.name.toLowerCase().replace(/\s+/g, "_"), a = i.value;
            i.unit && i.unit.conversion_factor ? e[s] = a * i.unit.conversion_factor : i.unit === "degree" ? e[s] = a * Math.PI / 180 : e[s] = a;
          });
          break;
        case "unit":
          n.name && (e.units = n.name.toLowerCase(), e.units === "metre" && (e.units = "meter")), n.conversion_factor && (e.to_meter = n.conversion_factor);
          break;
        case "base_crs":
          ta(n, e), e.datumCode = n.id ? n.id.authority + "_" + n.id.code : n.name;
          break;
      }
  }), e.latitude_of_false_origin !== void 0 && (e.lat0 = e.latitude_of_false_origin), e.longitude_of_false_origin !== void 0 && (e.long0 = e.longitude_of_false_origin), e.latitude_of_standard_parallel !== void 0 && (e.lat0 = e.latitude_of_standard_parallel, e.lat1 = e.latitude_of_standard_parallel), e.latitude_of_1st_standard_parallel !== void 0 && (e.lat1 = e.latitude_of_1st_standard_parallel), e.latitude_of_2nd_standard_parallel !== void 0 && (e.lat2 = e.latitude_of_2nd_standard_parallel), e.latitude_of_projection_centre !== void 0 && (e.lat0 = e.latitude_of_projection_centre), e.longitude_of_projection_centre !== void 0 && (e.longc = e.longitude_of_projection_centre), e.easting_at_false_origin !== void 0 && (e.x0 = e.easting_at_false_origin), e.northing_at_false_origin !== void 0 && (e.y0 = e.northing_at_false_origin), e.latitude_of_natural_origin !== void 0 && (e.lat0 = e.latitude_of_natural_origin), e.longitude_of_natural_origin !== void 0 && (e.long0 = e.longitude_of_natural_origin), e.longitude_of_origin !== void 0 && (e.long0 = e.longitude_of_origin), e.false_easting !== void 0 && (e.x0 = e.false_easting), e.easting_at_projection_centre && (e.x0 = e.easting_at_projection_centre), e.false_northing !== void 0 && (e.y0 = e.false_northing), e.northing_at_projection_centre && (e.y0 = e.northing_at_projection_centre), e.standard_parallel_1 !== void 0 && (e.lat1 = e.standard_parallel_1), e.standard_parallel_2 !== void 0 && (e.lat2 = e.standard_parallel_2), e.scale_factor_at_natural_origin !== void 0 && (e.k0 = e.scale_factor_at_natural_origin), e.scale_factor_at_projection_centre !== void 0 && (e.k0 = e.scale_factor_at_projection_centre), e.scale_factor_on_pseudo_standard_parallel !== void 0 && (e.k0 = e.scale_factor_on_pseudo_standard_parallel), e.azimuth !== void 0 && (e.alpha = e.azimuth), e.azimuth_at_projection_centre !== void 0 && (e.alpha = e.azimuth_at_projection_centre), e.angle_from_rectified_to_skew_grid && (e.rectified_grid_angle = e.angle_from_rectified_to_skew_grid), Qm(e), e);
}
var mv = [
  "PROJECTEDCRS",
  "PROJCRS",
  "GEOGCS",
  "GEOCCS",
  "PROJCS",
  "LOCAL_CS",
  "GEODCRS",
  "GEODETICCRS",
  "GEODETICDATUM",
  "ENGCRS",
  "ENGINEERINGCRS"
];
function pv(t, e) {
  var r = e[0], n = e[1];
  !(r in t) && n in t && (t[r] = t[n], e.length === 3 && (t[r] = e[2](t[r])));
}
function tp(t) {
  for (var e = Object.keys(t), r = 0, n = e.length; r < n; ++r) {
    var i = e[r];
    mv.indexOf(i) !== -1 && yv(t[i]), typeof t[i] == "object" && tp(t[i]);
  }
}
function yv(t) {
  if (t.AUTHORITY) {
    var e = Object.keys(t.AUTHORITY)[0];
    e && e in t.AUTHORITY && (t.title = e + ":" + t.AUTHORITY[e]);
  }
  if (t.type === "GEOGCS" ? t.projName = "longlat" : t.type === "LOCAL_CS" ? (t.projName = "identity", t.local = !0) : typeof t.PROJECTION == "object" ? t.projName = Object.keys(t.PROJECTION)[0] : t.projName = t.PROJECTION, t.AXIS) {
    for (var r = "", n = 0, i = t.AXIS.length; n < i; ++n) {
      var s = [t.AXIS[n][0].toLowerCase(), t.AXIS[n][1].toLowerCase()];
      s[0].indexOf("north") !== -1 || (s[0] === "y" || s[0] === "lat") && s[1] === "north" ? r += "n" : s[0].indexOf("south") !== -1 || (s[0] === "y" || s[0] === "lat") && s[1] === "south" ? r += "s" : s[0].indexOf("east") !== -1 || (s[0] === "x" || s[0] === "lon") && s[1] === "east" ? r += "e" : (s[0].indexOf("west") !== -1 || (s[0] === "x" || s[0] === "lon") && s[1] === "west") && (r += "w");
    }
    r.length === 2 && (r += "u"), r.length === 3 && (t.axis = r);
  }
  t.UNIT && (t.units = t.UNIT.name.toLowerCase(), t.units === "metre" && (t.units = "meter"), t.UNIT.convert && (t.type === "GEOGCS" ? t.DATUM && t.DATUM.SPHEROID && (t.to_meter = t.UNIT.convert * t.DATUM.SPHEROID.a) : t.to_meter = t.UNIT.convert));
  var a = t.GEOGCS;
  t.type === "GEOGCS" && (a = t), a && (a.DATUM ? t.datumCode = a.DATUM.name.toLowerCase() : t.datumCode = a.name.toLowerCase(), t.datumCode.slice(0, 2) === "d_" && (t.datumCode = t.datumCode.slice(2)), t.datumCode === "new_zealand_1949" && (t.datumCode = "nzgd49"), (t.datumCode === "wgs_1984" || t.datumCode === "world_geodetic_system_1984") && (t.PROJECTION === "Mercator_Auxiliary_Sphere" && (t.sphere = !0), t.datumCode = "wgs84"), t.datumCode === "belge_1972" && (t.datumCode = "rnb72"), a.DATUM && a.DATUM.SPHEROID && (t.ellps = a.DATUM.SPHEROID.name.replace("_19", "").replace(/[Cc]larke\_18/, "clrk"), t.ellps.toLowerCase().slice(0, 13) === "international" && (t.ellps = "intl"), t.a = a.DATUM.SPHEROID.a, t.rf = parseFloat(a.DATUM.SPHEROID.rf)), a.DATUM && a.DATUM.TOWGS84 && (t.datum_params = a.DATUM.TOWGS84), ~t.datumCode.indexOf("osgb_1936") && (t.datumCode = "osgb36"), ~t.datumCode.indexOf("osni_1952") && (t.datumCode = "osni52"), (~t.datumCode.indexOf("tm65") || ~t.datumCode.indexOf("geodetic_datum_of_1965")) && (t.datumCode = "ire65"), t.datumCode === "ch1903+" && (t.datumCode = "ch1903"), ~t.datumCode.indexOf("israel") && (t.datumCode = "isr93")), t.b && !isFinite(t.b) && (t.b = t.a), t.rectified_grid_angle && (t.rectified_grid_angle = Ke(t.rectified_grid_angle));
  function o(f) {
    var u = t.to_meter || 1;
    return f * u;
  }
  var c = function(f) {
    return pv(t, f);
  }, h = [
    ["standard_parallel_1", "Standard_Parallel_1"],
    ["standard_parallel_1", "Latitude of 1st standard parallel"],
    ["standard_parallel_2", "Standard_Parallel_2"],
    ["standard_parallel_2", "Latitude of 2nd standard parallel"],
    ["false_easting", "False_Easting"],
    ["false_easting", "False easting"],
    ["false-easting", "Easting at false origin"],
    ["false_northing", "False_Northing"],
    ["false_northing", "False northing"],
    ["false_northing", "Northing at false origin"],
    ["central_meridian", "Central_Meridian"],
    ["central_meridian", "Longitude of natural origin"],
    ["central_meridian", "Longitude of false origin"],
    ["latitude_of_origin", "Latitude_Of_Origin"],
    ["latitude_of_origin", "Central_Parallel"],
    ["latitude_of_origin", "Latitude of natural origin"],
    ["latitude_of_origin", "Latitude of false origin"],
    ["scale_factor", "Scale_Factor"],
    ["k0", "scale_factor"],
    ["latitude_of_center", "Latitude_Of_Center"],
    ["latitude_of_center", "Latitude_of_center"],
    ["lat0", "latitude_of_center", Ke],
    ["longitude_of_center", "Longitude_Of_Center"],
    ["longitude_of_center", "Longitude_of_center"],
    ["longc", "longitude_of_center", Ke],
    ["x0", "false_easting", o],
    ["y0", "false_northing", o],
    ["long0", "central_meridian", Ke],
    ["lat0", "latitude_of_origin", Ke],
    ["lat0", "standard_parallel_1", Ke],
    ["lat1", "standard_parallel_1", Ke],
    ["lat2", "standard_parallel_2", Ke],
    ["azimuth", "Azimuth"],
    ["alpha", "azimuth", Ke],
    ["srsCode", "name"]
  ];
  h.forEach(c), Qm(t);
}
function ea(t) {
  if (typeof t == "object")
    return ta(t);
  const e = cv(t);
  var r = fv(t);
  if (e === "WKT2") {
    const s = ov(r);
    return ta(s);
  }
  var n = r[0], i = {};
  return vn(r, i), tp(i), i[n];
}
function ce(t) {
  var e = this;
  if (arguments.length === 2) {
    var r = arguments[1];
    typeof r == "string" ? r.charAt(0) === "+" ? ce[
      /** @type {string} */
      t
    ] = sh(arguments[1]) : ce[
      /** @type {string} */
      t
    ] = ea(arguments[1]) : r && typeof r == "object" && !("projName" in r) ? ce[
      /** @type {string} */
      t
    ] = ea(arguments[1]) : (ce[
      /** @type {string} */
      t
    ] = r, r || delete ce[
      /** @type {string} */
      t
    ]);
  } else if (arguments.length === 1) {
    if (Array.isArray(t))
      return t.map(function(n) {
        return Array.isArray(n) ? ce.apply(e, n) : ce(n);
      });
    if (typeof t == "string") {
      if (t in ce)
        return ce[t];
    } else "EPSG" in t ? ce["EPSG:" + t.EPSG] = t : "ESRI" in t ? ce["ESRI:" + t.ESRI] = t : "IAU2000" in t ? ce["IAU2000:" + t.IAU2000] = t : console.log(t);
    return;
  }
}
J_(ce);
function gv(t) {
  return typeof t == "string";
}
function wv(t) {
  return t in ce;
}
function _v(t) {
  return t.indexOf("+") !== 0 && t.indexOf("[") !== -1 || typeof t == "object" && !("srsCode" in t);
}
var r0 = ["3857", "900913", "3785", "102113"];
function vv(t) {
  if (t.title)
    return t.title.toLowerCase().indexOf("epsg:") === 0 && r0.indexOf(t.title.substr(5)) > -1;
  var e = Lr(t, "authority");
  if (e) {
    var r = Lr(e, "epsg");
    return r && r0.indexOf(r) > -1;
  }
}
function Ev(t) {
  var e = Lr(t, "extension");
  if (e)
    return Lr(e, "proj4");
}
function bv(t) {
  return t[0] === "+";
}
function Sv(t) {
  let e;
  if (gv(t))
    if (wv(t))
      e = ce[t];
    else if (_v(t)) {
      e = ea(t);
      var r = Ev(e);
      r && (e = sh(r));
    } else bv(t) && (e = sh(t));
  else "projName" in t ? e = t : e = ea(t);
  return e && vv(e) ? ce["EPSG:3857"] : e;
}
function n0(t, e) {
  t = t || {};
  var r, n;
  if (!e)
    return t;
  for (n in e)
    r = e[n], r !== void 0 && (t[n] = r);
  return t;
}
function lr(t, e, r) {
  var n = t * e;
  return r / Math.sqrt(1 - n * n);
}
function di(t) {
  return t < 0 ? -1 : 1;
}
function wt(t, e) {
  return e || Math.abs(t) <= Qt ? t : t - di(t) * ei;
}
function Je(t, e, r) {
  var n = t * r, i = 0.5 * t;
  return n = Math.pow((1 - n) / (1 + n), i), Math.tan(0.5 * (st - e)) / n;
}
function ni(t, e) {
  for (var r = 0.5 * t, n, i, s = st - 2 * Math.atan(e), a = 0; a <= 15; a++)
    if (n = t * Math.sin(s), i = st - 2 * Math.atan(e * Math.pow((1 - n) / (1 + n), r)) - s, s += i, Math.abs(i) <= 1e-10)
      return s;
  return -9999;
}
function Mv() {
  var t = this.b / this.a;
  this.es = 1 - t * t, "x0" in this || (this.x0 = 0), "y0" in this || (this.y0 = 0), this.e = Math.sqrt(this.es), this.lat_ts ? this.sphere ? this.k0 = Math.cos(this.lat_ts) : this.k0 = lr(this.e, Math.sin(this.lat_ts), Math.cos(this.lat_ts)) : this.k0 || (this.k ? this.k0 = this.k : this.k0 = 1);
}
function xv(t) {
  var e = t.x, r = t.y;
  if (r * Ne > 90 && r * Ne < -90 && e * Ne > 180 && e * Ne < -180)
    return null;
  var n, i;
  if (Math.abs(Math.abs(r) - st) <= pt)
    return null;
  if (this.sphere)
    n = this.x0 + this.a * this.k0 * wt(e - this.long0, this.over), i = this.y0 + this.a * this.k0 * Math.log(Math.tan(zt + 0.5 * r));
  else {
    var s = Math.sin(r), a = Je(this.e, r, s);
    n = this.x0 + this.a * this.k0 * wt(e - this.long0, this.over), i = this.y0 - this.a * this.k0 * Math.log(a);
  }
  return t.x = n, t.y = i, t;
}
function kv(t) {
  var e = t.x - this.x0, r = t.y - this.y0, n, i;
  if (this.sphere)
    i = st - 2 * Math.atan(Math.exp(-r / (this.a * this.k0)));
  else {
    var s = Math.exp(-r / (this.a * this.k0));
    if (i = ni(this.e, s), i === -9999)
      return null;
  }
  return n = wt(this.long0 + e / (this.a * this.k0), this.over), t.x = n, t.y = i, t;
}
var $v = ["Mercator", "Popular Visualisation Pseudo Mercator", "Mercator_1SP", "Mercator_Auxiliary_Sphere", "Mercator_Variant_A", "merc"];
const Iv = {
  init: Mv,
  forward: xv,
  inverse: kv,
  names: $v
};
function Pv() {
}
function i0(t) {
  return t;
}
var ep = ["longlat", "identity"];
const Av = {
  init: Pv,
  forward: i0,
  inverse: i0,
  names: ep
};
var Nv = [Iv, Av], en = {}, En = [];
function rp(t, e) {
  var r = En.length;
  return t.names ? (En[r] = t, t.names.forEach(function(n) {
    en[n.toLowerCase()] = r;
  }), this) : (console.log(e), !0);
}
function np(t) {
  return t.replace(/[-\(\)\s]+/g, " ").trim().replace(/ /g, "_");
}
function Ov(t) {
  if (!t)
    return !1;
  var e = t.toLowerCase();
  if (typeof en[e] < "u" && En[en[e]] || (e = np(e), e in en && En[en[e]]))
    return En[en[e]];
}
function Rv() {
  Nv.forEach(rp);
}
const Dv = {
  start: Rv,
  add: rp,
  get: Ov
};
var ip = {
  MERIT: {
    a: 6378137,
    rf: 298.257,
    ellipseName: "MERIT 1983"
  },
  SGS85: {
    a: 6378136,
    rf: 298.257,
    ellipseName: "Soviet Geodetic System 85"
  },
  GRS80: {
    a: 6378137,
    rf: 298.257222101,
    ellipseName: "GRS 1980(IUGG, 1980)"
  },
  IAU76: {
    a: 6378140,
    rf: 298.257,
    ellipseName: "IAU 1976"
  },
  airy: {
    a: 6377563396e-3,
    b: 635625691e-2,
    ellipseName: "Airy 1830"
  },
  APL4: {
    a: 6378137,
    rf: 298.25,
    ellipseName: "Appl. Physics. 1965"
  },
  NWL9D: {
    a: 6378145,
    rf: 298.25,
    ellipseName: "Naval Weapons Lab., 1965"
  },
  mod_airy: {
    a: 6377340189e-3,
    b: 6356034446e-3,
    ellipseName: "Modified Airy"
  },
  andrae: {
    a: 637710443e-2,
    rf: 300,
    ellipseName: "Andrae 1876 (Den., Iclnd.)"
  },
  aust_SA: {
    a: 6378160,
    rf: 298.25,
    ellipseName: "Australian Natl & S. Amer. 1969"
  },
  GRS67: {
    a: 6378160,
    rf: 298.247167427,
    ellipseName: "GRS 67(IUGG 1967)"
  },
  bessel: {
    a: 6377397155e-3,
    rf: 299.1528128,
    ellipseName: "Bessel 1841"
  },
  bess_nam: {
    a: 6377483865e-3,
    rf: 299.1528128,
    ellipseName: "Bessel 1841 (Namibia)"
  },
  clrk66: {
    a: 63782064e-1,
    b: 63565838e-1,
    ellipseName: "Clarke 1866"
  },
  clrk80: {
    a: 6378249145e-3,
    rf: 293.4663,
    ellipseName: "Clarke 1880 mod."
  },
  clrk80ign: {
    a: 63782492e-1,
    b: 6356515,
    rf: 293.4660213,
    ellipseName: "Clarke 1880 (IGN)"
  },
  clrk58: {
    a: 6378293645208759e-9,
    rf: 294.2606763692654,
    ellipseName: "Clarke 1858"
  },
  CPM: {
    a: 63757387e-1,
    rf: 334.29,
    ellipseName: "Comm. des Poids et Mesures 1799"
  },
  delmbr: {
    a: 6376428,
    rf: 311.5,
    ellipseName: "Delambre 1810 (Belgium)"
  },
  engelis: {
    a: 637813605e-2,
    rf: 298.2566,
    ellipseName: "Engelis 1985"
  },
  evrst30: {
    a: 6377276345e-3,
    rf: 300.8017,
    ellipseName: "Everest 1830"
  },
  evrst48: {
    a: 6377304063e-3,
    rf: 300.8017,
    ellipseName: "Everest 1948"
  },
  evrst56: {
    a: 6377301243e-3,
    rf: 300.8017,
    ellipseName: "Everest 1956"
  },
  evrst69: {
    a: 6377295664e-3,
    rf: 300.8017,
    ellipseName: "Everest 1969"
  },
  evrstSS: {
    a: 6377298556e-3,
    rf: 300.8017,
    ellipseName: "Everest (Sabah & Sarawak)"
  },
  fschr60: {
    a: 6378166,
    rf: 298.3,
    ellipseName: "Fischer (Mercury Datum) 1960"
  },
  fschr60m: {
    a: 6378155,
    rf: 298.3,
    ellipseName: "Fischer 1960"
  },
  fschr68: {
    a: 6378150,
    rf: 298.3,
    ellipseName: "Fischer 1968"
  },
  helmert: {
    a: 6378200,
    rf: 298.3,
    ellipseName: "Helmert 1906"
  },
  hough: {
    a: 6378270,
    rf: 297,
    ellipseName: "Hough"
  },
  intl: {
    a: 6378388,
    rf: 297,
    ellipseName: "International 1909 (Hayford)"
  },
  kaula: {
    a: 6378163,
    rf: 298.24,
    ellipseName: "Kaula 1961"
  },
  lerch: {
    a: 6378139,
    rf: 298.257,
    ellipseName: "Lerch 1979"
  },
  mprts: {
    a: 6397300,
    rf: 191,
    ellipseName: "Maupertius 1738"
  },
  new_intl: {
    a: 63781575e-1,
    b: 63567722e-1,
    ellipseName: "New International 1967"
  },
  plessis: {
    a: 6376523,
    rf: 6355863,
    ellipseName: "Plessis 1817 (France)"
  },
  krass: {
    a: 6378245,
    rf: 298.3,
    ellipseName: "Krassovsky, 1942"
  },
  SEasia: {
    a: 6378155,
    b: 63567733205e-4,
    ellipseName: "Southeast Asia"
  },
  walbeck: {
    a: 6376896,
    b: 63558348467e-4,
    ellipseName: "Walbeck"
  },
  WGS60: {
    a: 6378165,
    rf: 298.3,
    ellipseName: "WGS 60"
  },
  WGS66: {
    a: 6378145,
    rf: 298.25,
    ellipseName: "WGS 66"
  },
  WGS7: {
    a: 6378135,
    rf: 298.26,
    ellipseName: "WGS 72"
  },
  WGS84: {
    a: 6378137,
    rf: 298.257223563,
    ellipseName: "WGS 84"
  },
  sphere: {
    a: 6370997,
    b: 6370997,
    ellipseName: "Normal Sphere (r=6370997)"
  }
};
const jv = ip.WGS84;
function Tv(t, e, r, n) {
  var i = t * t, s = e * e, a = (i - s) / i, o = 0;
  n ? (t *= 1 - a * (tv + a * (ev + a * rv)), i = t * t, a = 0) : o = Math.sqrt(a);
  var c = (i - s) / s;
  return {
    es: a,
    e: o,
    ep2: c
  };
}
function Cv(t, e, r, n, i) {
  if (!t) {
    var s = Lr(ip, n);
    s || (s = jv), t = s.a, e = s.b, r = s.rf;
  }
  return r && !e && (e = (1 - 1 / r) * t), (r === 0 || Math.abs(t - e) < pt) && (i = !0, e = t), {
    a: t,
    b: e,
    rf: r,
    sphere: i
  };
}
var Zs = {
  wgs84: {
    towgs84: "0,0,0",
    ellipse: "WGS84",
    datumName: "WGS84"
  },
  ch1903: {
    towgs84: "674.374,15.056,405.346",
    ellipse: "bessel",
    datumName: "swiss"
  },
  ggrs87: {
    towgs84: "-199.87,74.79,246.62",
    ellipse: "GRS80",
    datumName: "Greek_Geodetic_Reference_System_1987"
  },
  nad83: {
    towgs84: "0,0,0",
    ellipse: "GRS80",
    datumName: "North_American_Datum_1983"
  },
  nad27: {
    nadgrids: "@conus,@alaska,@ntv2_0.gsb,@ntv1_can.dat",
    ellipse: "clrk66",
    datumName: "North_American_Datum_1927"
  },
  potsdam: {
    towgs84: "598.1,73.7,418.2,0.202,0.045,-2.455,6.7",
    ellipse: "bessel",
    datumName: "Potsdam Rauenberg 1950 DHDN"
  },
  carthage: {
    towgs84: "-263.0,6.0,431.0",
    ellipse: "clark80",
    datumName: "Carthage 1934 Tunisia"
  },
  hermannskogel: {
    towgs84: "577.326,90.129,463.919,5.137,1.474,5.297,2.4232",
    ellipse: "bessel",
    datumName: "Hermannskogel"
  },
  mgi: {
    towgs84: "577.326,90.129,463.919,5.137,1.474,5.297,2.4232",
    ellipse: "bessel",
    datumName: "Militar-Geographische Institut"
  },
  osni52: {
    towgs84: "482.530,-130.596,564.557,-1.042,-0.214,-0.631,8.15",
    ellipse: "airy",
    datumName: "Irish National"
  },
  ire65: {
    towgs84: "482.530,-130.596,564.557,-1.042,-0.214,-0.631,8.15",
    ellipse: "mod_airy",
    datumName: "Ireland 1965"
  },
  rassadiran: {
    towgs84: "-133.63,-157.5,-158.62",
    ellipse: "intl",
    datumName: "Rassadiran"
  },
  nzgd49: {
    towgs84: "59.47,-5.04,187.44,0.47,-0.1,1.024,-4.5993",
    ellipse: "intl",
    datumName: "New Zealand Geodetic Datum 1949"
  },
  osgb36: {
    towgs84: "446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894",
    ellipse: "airy",
    datumName: "Ordnance Survey of Great Britain 1936"
  },
  s_jtsk: {
    towgs84: "589,76,480",
    ellipse: "bessel",
    datumName: "S-JTSK (Ferro)"
  },
  beduaram: {
    towgs84: "-106,-87,188",
    ellipse: "clrk80",
    datumName: "Beduaram"
  },
  gunung_segara: {
    towgs84: "-403,684,41",
    ellipse: "bessel",
    datumName: "Gunung Segara Jakarta"
  },
  rnb72: {
    towgs84: "106.869,-52.2978,103.724,-0.33657,0.456955,-1.84218,1",
    ellipse: "intl",
    datumName: "Reseau National Belge 1972"
  },
  EPSG_5451: {
    towgs84: "6.41,-49.05,-11.28,1.5657,0.5242,6.9718,-5.7649"
  },
  IGNF_LURESG: {
    towgs84: "-192.986,13.673,-39.309,-0.4099,-2.9332,2.6881,0.43"
  },
  EPSG_4614: {
    towgs84: "-119.4248,-303.65872,-11.00061,1.164298,0.174458,1.096259,3.657065"
  },
  EPSG_4615: {
    towgs84: "-494.088,-312.129,279.877,-1.423,-1.013,1.59,-0.748"
  },
  ESRI_37241: {
    towgs84: "-76.822,257.457,-12.817,2.136,-0.033,-2.392,-0.031"
  },
  ESRI_37249: {
    towgs84: "-440.296,58.548,296.265,1.128,10.202,4.559,-0.438"
  },
  ESRI_37245: {
    towgs84: "-511.151,-181.269,139.609,1.05,2.703,1.798,3.071"
  },
  EPSG_4178: {
    towgs84: "24.9,-126.4,-93.2,-0.063,-0.247,-0.041,1.01"
  },
  EPSG_4622: {
    towgs84: "-472.29,-5.63,-304.12,0.4362,-0.8374,0.2563,1.8984"
  },
  EPSG_4625: {
    towgs84: "126.93,547.94,130.41,-2.7867,5.1612,-0.8584,13.8227"
  },
  EPSG_5252: {
    towgs84: "0.023,0.036,-0.068,0.00176,0.00912,-0.01136,0.00439"
  },
  EPSG_4314: {
    towgs84: "597.1,71.4,412.1,0.894,0.068,-1.563,7.58"
  },
  EPSG_4282: {
    towgs84: "-178.3,-316.7,-131.5,5.278,6.077,10.979,19.166"
  },
  EPSG_4231: {
    towgs84: "-83.11,-97.38,-117.22,0.005693,-0.044698,0.044285,0.1218"
  },
  EPSG_4274: {
    towgs84: "-230.994,102.591,25.199,0.633,-0.239,0.9,1.95"
  },
  EPSG_4134: {
    towgs84: "-180.624,-225.516,173.919,-0.81,-1.898,8.336,16.71006"
  },
  EPSG_4254: {
    towgs84: "18.38,192.45,96.82,0.056,-0.142,-0.2,-0.0013"
  },
  EPSG_4159: {
    towgs84: "-194.513,-63.978,-25.759,-3.4027,3.756,-3.352,-0.9175"
  },
  EPSG_4687: {
    towgs84: "0.072,-0.507,-0.245,0.0183,-0.0003,0.007,-0.0093"
  },
  EPSG_4227: {
    towgs84: "-83.58,-397.54,458.78,-17.595,-2.847,4.256,3.225"
  },
  EPSG_4746: {
    towgs84: "599.4,72.4,419.2,-0.062,-0.022,-2.723,6.46"
  },
  EPSG_4745: {
    towgs84: "612.4,77,440.2,-0.054,0.057,-2.797,2.55"
  },
  EPSG_6311: {
    towgs84: "8.846,-4.394,-1.122,-0.00237,-0.146528,0.130428,0.783926"
  },
  EPSG_4289: {
    towgs84: "565.7381,50.4018,465.2904,-0.395026,0.330772,-1.876073,4.07244"
  },
  EPSG_4230: {
    towgs84: "-68.863,-134.888,-111.49,-0.53,-0.14,0.57,-3.4"
  },
  EPSG_4154: {
    towgs84: "-123.02,-158.95,-168.47"
  },
  EPSG_4156: {
    towgs84: "570.8,85.7,462.8,4.998,1.587,5.261,3.56"
  },
  EPSG_4299: {
    towgs84: "482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15"
  },
  EPSG_4179: {
    towgs84: "33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84"
  },
  EPSG_4313: {
    towgs84: "-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747"
  },
  EPSG_4194: {
    towgs84: "163.511,127.533,-159.789"
  },
  EPSG_4195: {
    towgs84: "105,326,-102.5"
  },
  EPSG_4196: {
    towgs84: "-45,417,-3.5"
  },
  EPSG_4611: {
    towgs84: "-162.619,-276.959,-161.764,0.067753,-2.243648,-1.158828,-1.094246"
  },
  EPSG_4633: {
    towgs84: "137.092,131.66,91.475,-1.9436,-11.5993,-4.3321,-7.4824"
  },
  EPSG_4641: {
    towgs84: "-408.809,366.856,-412.987,1.8842,-0.5308,2.1655,-121.0993"
  },
  EPSG_4643: {
    towgs84: "-480.26,-438.32,-643.429,16.3119,20.1721,-4.0349,-111.7002"
  },
  EPSG_4300: {
    towgs84: "482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15"
  },
  EPSG_4188: {
    towgs84: "482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15"
  },
  EPSG_4660: {
    towgs84: "982.6087,552.753,-540.873,6.681627,-31.611492,-19.848161,16.805"
  },
  EPSG_4662: {
    towgs84: "97.295,-263.247,310.882,-1.5999,0.8386,3.1409,13.3259"
  },
  EPSG_3906: {
    towgs84: "577.88891,165.22205,391.18289,4.9145,-0.94729,-13.05098,7.78664"
  },
  EPSG_4307: {
    towgs84: "-209.3622,-87.8162,404.6198,0.0046,3.4784,0.5805,-1.4547"
  },
  EPSG_6892: {
    towgs84: "-76.269,-16.683,68.562,-6.275,10.536,-4.286,-13.686"
  },
  EPSG_4690: {
    towgs84: "221.597,152.441,176.523,2.403,1.3893,0.884,11.4648"
  },
  EPSG_4691: {
    towgs84: "218.769,150.75,176.75,3.5231,2.0037,1.288,10.9817"
  },
  EPSG_4629: {
    towgs84: "72.51,345.411,79.241,-1.5862,-0.8826,-0.5495,1.3653"
  },
  EPSG_4630: {
    towgs84: "165.804,216.213,180.26,-0.6251,-0.4515,-0.0721,7.4111"
  },
  EPSG_4692: {
    towgs84: "217.109,86.452,23.711,0.0183,-0.0003,0.007,-0.0093"
  },
  EPSG_9333: {
    towgs84: "0,0,0,-0.008393,0.000749,-0.010276,0"
  },
  EPSG_9059: {
    towgs84: "0,0,0"
  },
  EPSG_4312: {
    towgs84: "601.705,84.263,485.227,4.7354,1.3145,5.393,-2.3887"
  },
  EPSG_4123: {
    towgs84: "-96.062,-82.428,-121.753,4.801,0.345,-1.376,1.496"
  },
  EPSG_4309: {
    towgs84: "-124.45,183.74,44.64,-0.4384,0.5446,-0.9706,-2.1365"
  },
  ESRI_104106: {
    towgs84: "-283.088,-70.693,117.445,-1.157,0.059,-0.652,-4.058"
  },
  EPSG_4281: {
    towgs84: "-219.247,-73.802,269.529"
  },
  EPSG_4322: {
    towgs84: "0,0,4.5"
  },
  EPSG_4324: {
    towgs84: "0,0,1.9"
  },
  EPSG_4284: {
    towgs84: "43.822,-108.842,-119.585,1.455,-0.761,0.737,0.549"
  },
  EPSG_4277: {
    towgs84: "446.448,-125.157,542.06,0.15,0.247,0.842,-20.489"
  },
  EPSG_4207: {
    towgs84: "-282.1,-72.2,120,-1.529,0.145,-0.89,-4.46"
  },
  EPSG_4688: {
    towgs84: "347.175,1077.618,2623.677,33.9058,-70.6776,9.4013,186.0647"
  },
  EPSG_4689: {
    towgs84: "410.793,54.542,80.501,-2.5596,-2.3517,-0.6594,17.3218"
  },
  EPSG_4720: {
    towgs84: "0,0,4.5"
  },
  EPSG_4273: {
    towgs84: "278.3,93,474.5,7.889,0.05,-6.61,6.21"
  },
  EPSG_4240: {
    towgs84: "204.64,834.74,293.8"
  },
  EPSG_4817: {
    towgs84: "278.3,93,474.5,7.889,0.05,-6.61,6.21"
  },
  ESRI_104131: {
    towgs84: "426.62,142.62,460.09,4.98,4.49,-12.42,-17.1"
  },
  EPSG_4265: {
    towgs84: "-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68"
  },
  EPSG_4263: {
    towgs84: "-111.92,-87.85,114.5,1.875,0.202,0.219,0.032"
  },
  EPSG_4298: {
    towgs84: "-689.5937,623.84046,-65.93566,-0.02331,1.17094,-0.80054,5.88536"
  },
  EPSG_4270: {
    towgs84: "-253.4392,-148.452,386.5267,0.15605,0.43,-0.1013,-0.0424"
  },
  EPSG_4229: {
    towgs84: "-121.8,98.1,-10.7"
  },
  EPSG_4220: {
    towgs84: "-55.5,-348,-229.2"
  },
  EPSG_4214: {
    towgs84: "12.646,-155.176,-80.863"
  },
  EPSG_4232: {
    towgs84: "-345,3,223"
  },
  EPSG_4238: {
    towgs84: "-1.977,-13.06,-9.993,0.364,0.254,0.689,-1.037"
  },
  EPSG_4168: {
    towgs84: "-170,33,326"
  },
  EPSG_4131: {
    towgs84: "199,931,318.9"
  },
  EPSG_4152: {
    towgs84: "-0.9102,2.0141,0.5602,0.029039,0.010065,0.010101,0"
  },
  EPSG_5228: {
    towgs84: "572.213,85.334,461.94,4.9732,1.529,5.2484,3.5378"
  },
  EPSG_8351: {
    towgs84: "485.021,169.465,483.839,7.786342,4.397554,4.102655,0"
  },
  EPSG_4683: {
    towgs84: "-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06"
  },
  EPSG_4133: {
    towgs84: "0,0,0"
  },
  EPSG_7373: {
    towgs84: "0.819,-0.5762,-1.6446,-0.00378,-0.03317,0.00318,0.0693"
  },
  EPSG_9075: {
    towgs84: "-0.9102,2.0141,0.5602,0.029039,0.010065,0.010101,0"
  },
  EPSG_9072: {
    towgs84: "-0.9102,2.0141,0.5602,0.029039,0.010065,0.010101,0"
  },
  EPSG_9294: {
    towgs84: "1.16835,-1.42001,-2.24431,-0.00822,-0.05508,0.01818,0.23388"
  },
  EPSG_4212: {
    towgs84: "-267.434,173.496,181.814,-13.4704,8.7154,7.3926,14.7492"
  },
  EPSG_4191: {
    towgs84: "-44.183,-0.58,-38.489,2.3867,2.7072,-3.5196,-8.2703"
  },
  EPSG_4237: {
    towgs84: "52.684,-71.194,-13.975,-0.312,-0.1063,-0.3729,1.0191"
  },
  EPSG_4740: {
    towgs84: "-1.08,-0.27,-0.9"
  },
  EPSG_4124: {
    towgs84: "419.3836,99.3335,591.3451,0.850389,1.817277,-7.862238,-0.99496"
  },
  EPSG_5681: {
    towgs84: "584.9636,107.7175,413.8067,1.1155,0.2824,-3.1384,7.9922"
  },
  EPSG_4141: {
    towgs84: "23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262"
  },
  EPSG_4204: {
    towgs84: "-85.645,-273.077,-79.708,2.289,-1.421,2.532,3.194"
  },
  EPSG_4319: {
    towgs84: "226.702,-193.337,-35.371,-2.229,-4.391,9.238,0.9798"
  },
  EPSG_4200: {
    towgs84: "24.82,-131.21,-82.66"
  },
  EPSG_4130: {
    towgs84: "0,0,0"
  },
  EPSG_4127: {
    towgs84: "-82.875,-57.097,-156.768,-2.158,1.524,-0.982,-0.359"
  },
  EPSG_4149: {
    towgs84: "674.374,15.056,405.346"
  },
  EPSG_4617: {
    towgs84: "-0.991,1.9072,0.5129,0.02579,0.00965,0.01166,0"
  },
  EPSG_4663: {
    towgs84: "-210.502,-66.902,-48.476,2.094,-15.067,-5.817,0.485"
  },
  EPSG_4664: {
    towgs84: "-211.939,137.626,58.3,-0.089,0.251,0.079,0.384"
  },
  EPSG_4665: {
    towgs84: "-105.854,165.589,-38.312,-0.003,-0.026,0.024,-0.048"
  },
  EPSG_4666: {
    towgs84: "631.392,-66.551,481.442,1.09,-4.445,-4.487,-4.43"
  },
  EPSG_4756: {
    towgs84: "-192.873,-39.382,-111.202,-0.00205,-0.0005,0.00335,0.0188"
  },
  EPSG_4723: {
    towgs84: "-179.483,-69.379,-27.584,-7.862,8.163,6.042,-13.925"
  },
  EPSG_4726: {
    towgs84: "8.853,-52.644,180.304,-0.393,-2.323,2.96,-24.081"
  },
  EPSG_4267: {
    towgs84: "-8.0,160.0,176.0"
  },
  EPSG_5365: {
    towgs84: "-0.16959,0.35312,0.51846,0.03385,-0.16325,0.03446,0.03693"
  },
  EPSG_4218: {
    towgs84: "304.5,306.5,-318.1"
  },
  EPSG_4242: {
    towgs84: "-33.722,153.789,94.959,-8.581,-4.478,4.54,8.95"
  },
  EPSG_4216: {
    towgs84: "-292.295,248.758,429.447,4.9971,2.99,6.6906,1.0289"
  },
  ESRI_104105: {
    towgs84: "631.392,-66.551,481.442,1.09,-4.445,-4.487,-4.43"
  },
  ESRI_104129: {
    towgs84: "0,0,0"
  },
  EPSG_4673: {
    towgs84: "174.05,-25.49,112.57"
  },
  EPSG_4202: {
    towgs84: "-124,-60,154"
  },
  EPSG_4203: {
    towgs84: "-117.763,-51.51,139.061,0.292,0.443,0.277,-0.191"
  },
  EPSG_3819: {
    towgs84: "595.48,121.69,515.35,4.115,-2.9383,0.853,-3.408"
  },
  EPSG_8694: {
    towgs84: "-93.799,-132.737,-219.073,-1.844,0.648,-6.37,-0.169"
  },
  EPSG_4145: {
    towgs84: "275.57,676.78,229.6"
  },
  EPSG_4283: {
    towgs84: "0.06155,-0.01087,-0.04019,0.039492,0.032722,0.032898,-0.009994"
  },
  EPSG_4317: {
    towgs84: "2.3287,-147.0425,-92.0802,-0.309248,0.324822,0.497299,5.689063"
  },
  EPSG_4272: {
    towgs84: "59.47,-5.04,187.44,0.47,-0.1,1.024,-4.5993"
  },
  EPSG_4248: {
    towgs84: "-307.7,265.3,-363.5"
  },
  EPSG_5561: {
    towgs84: "24,-121,-76"
  },
  EPSG_5233: {
    towgs84: "-0.293,766.95,87.713,0.195704,1.695068,3.473016,-0.039338"
  },
  ESRI_104130: {
    towgs84: "-86,-98,-119"
  },
  ESRI_104102: {
    towgs84: "682,-203,480"
  },
  ESRI_37207: {
    towgs84: "7,-10,-26"
  },
  EPSG_4675: {
    towgs84: "59.935,118.4,-10.871"
  },
  ESRI_104109: {
    towgs84: "-89.121,-348.182,260.871"
  },
  ESRI_104112: {
    towgs84: "-185.583,-230.096,281.361"
  },
  ESRI_104113: {
    towgs84: "25.1,-275.6,222.6"
  },
  IGNF_WGS72G: {
    towgs84: "0,12,6"
  },
  IGNF_NTFG: {
    towgs84: "-168,-60,320"
  },
  IGNF_EFATE57G: {
    towgs84: "-127,-769,472"
  },
  IGNF_PGP50G: {
    towgs84: "324.8,153.6,172.1"
  },
  IGNF_REUN47G: {
    towgs84: "94,-948,-1262"
  },
  IGNF_CSG67G: {
    towgs84: "-186,230,110"
  },
  IGNF_GUAD48G: {
    towgs84: "-467,-16,-300"
  },
  IGNF_TAHI51G: {
    towgs84: "162,117,154"
  },
  IGNF_TAHAAG: {
    towgs84: "65,342,77"
  },
  IGNF_NUKU72G: {
    towgs84: "84,274,65"
  },
  IGNF_PETRELS72G: {
    towgs84: "365,194,166"
  },
  IGNF_WALL78G: {
    towgs84: "253,-133,-127"
  },
  IGNF_MAYO50G: {
    towgs84: "-382,-59,-262"
  },
  IGNF_TANNAG: {
    towgs84: "-139,-967,436"
  },
  IGNF_IGN72G: {
    towgs84: "-13,-348,292"
  },
  IGNF_ATIGG: {
    towgs84: "1118,23,66"
  },
  IGNF_FANGA84G: {
    towgs84: "150.57,158.33,118.32"
  },
  IGNF_RUSAT84G: {
    towgs84: "202.13,174.6,-15.74"
  },
  IGNF_KAUE70G: {
    towgs84: "126.74,300.1,-75.49"
  },
  IGNF_MOP90G: {
    towgs84: "-10.8,-1.8,12.77"
  },
  IGNF_MHPF67G: {
    towgs84: "338.08,212.58,-296.17"
  },
  IGNF_TAHI79G: {
    towgs84: "160.61,116.05,153.69"
  },
  IGNF_ANAA92G: {
    towgs84: "1.5,3.84,4.81"
  },
  IGNF_MARQUI72G: {
    towgs84: "330.91,-13.92,58.56"
  },
  IGNF_APAT86G: {
    towgs84: "143.6,197.82,74.05"
  },
  IGNF_TUBU69G: {
    towgs84: "237.17,171.61,-77.84"
  },
  IGNF_STPM50G: {
    towgs84: "11.363,424.148,373.13"
  },
  EPSG_4150: {
    towgs84: "674.374,15.056,405.346"
  },
  EPSG_4754: {
    towgs84: "-208.4058,-109.8777,-2.5764"
  },
  ESRI_104101: {
    towgs84: "372.87,149.23,585.29"
  },
  EPSG_4693: {
    towgs84: "0,-0.15,0.68"
  },
  EPSG_6207: {
    towgs84: "293.17,726.18,245.36"
  },
  EPSG_4153: {
    towgs84: "-133.63,-157.5,-158.62"
  },
  EPSG_4132: {
    towgs84: "-241.54,-163.64,396.06"
  },
  EPSG_4221: {
    towgs84: "-154.5,150.7,100.4"
  },
  EPSG_4266: {
    towgs84: "-80.7,-132.5,41.1"
  },
  EPSG_4193: {
    towgs84: "-70.9,-151.8,-41.4"
  },
  EPSG_5340: {
    towgs84: "-0.41,0.46,-0.35"
  },
  EPSG_4246: {
    towgs84: "-294.7,-200.1,525.5"
  },
  EPSG_4318: {
    towgs84: "-3.2,-5.7,2.8"
  },
  EPSG_4121: {
    towgs84: "-199.87,74.79,246.62"
  },
  EPSG_4223: {
    towgs84: "-260.1,5.5,432.2"
  },
  EPSG_4158: {
    towgs84: "-0.465,372.095,171.736"
  },
  EPSG_4285: {
    towgs84: "-128.16,-282.42,21.93"
  },
  EPSG_4613: {
    towgs84: "-404.78,685.68,45.47"
  },
  EPSG_4607: {
    towgs84: "195.671,332.517,274.607"
  },
  EPSG_4475: {
    towgs84: "-381.788,-57.501,-256.673"
  },
  EPSG_4208: {
    towgs84: "-157.84,308.54,-146.6"
  },
  EPSG_4743: {
    towgs84: "70.995,-335.916,262.898"
  },
  EPSG_4710: {
    towgs84: "-323.65,551.39,-491.22"
  },
  EPSG_7881: {
    towgs84: "-0.077,0.079,0.086"
  },
  EPSG_4682: {
    towgs84: "283.729,735.942,261.143"
  },
  EPSG_4739: {
    towgs84: "-156,-271,-189"
  },
  EPSG_4679: {
    towgs84: "-80.01,253.26,291.19"
  },
  EPSG_4750: {
    towgs84: "-56.263,16.136,-22.856"
  },
  EPSG_4644: {
    towgs84: "-10.18,-350.43,291.37"
  },
  EPSG_4695: {
    towgs84: "-103.746,-9.614,-255.95"
  },
  EPSG_4292: {
    towgs84: "-355,21,72"
  },
  EPSG_4302: {
    towgs84: "-61.702,284.488,472.052"
  },
  EPSG_4143: {
    towgs84: "-124.76,53,466.79"
  },
  EPSG_4606: {
    towgs84: "-153,153,307"
  },
  EPSG_4699: {
    towgs84: "-770.1,158.4,-498.2"
  },
  EPSG_4247: {
    towgs84: "-273.5,110.6,-357.9"
  },
  EPSG_4160: {
    towgs84: "8.88,184.86,106.69"
  },
  EPSG_4161: {
    towgs84: "-233.43,6.65,173.64"
  },
  EPSG_9251: {
    towgs84: "-9.5,122.9,138.2"
  },
  EPSG_9253: {
    towgs84: "-78.1,101.6,133.3"
  },
  EPSG_4297: {
    towgs84: "-198.383,-240.517,-107.909"
  },
  EPSG_4269: {
    towgs84: "0,0,0"
  },
  EPSG_4301: {
    towgs84: "-147,506,687"
  },
  EPSG_4618: {
    towgs84: "-59,-11,-52"
  },
  EPSG_4612: {
    towgs84: "0,0,0"
  },
  EPSG_4678: {
    towgs84: "44.585,-131.212,-39.544"
  },
  EPSG_4250: {
    towgs84: "-130,29,364"
  },
  EPSG_4144: {
    towgs84: "214,804,268"
  },
  EPSG_4147: {
    towgs84: "-17.51,-108.32,-62.39"
  },
  EPSG_4259: {
    towgs84: "-254.1,-5.36,-100.29"
  },
  EPSG_4164: {
    towgs84: "-76,-138,67"
  },
  EPSG_4211: {
    towgs84: "-378.873,676.002,-46.255"
  },
  EPSG_4182: {
    towgs84: "-422.651,-172.995,84.02"
  },
  EPSG_4224: {
    towgs84: "-143.87,243.37,-33.52"
  },
  EPSG_4225: {
    towgs84: "-205.57,168.77,-4.12"
  },
  EPSG_5527: {
    towgs84: "-67.35,3.88,-38.22"
  },
  EPSG_4752: {
    towgs84: "98,390,-22"
  },
  EPSG_4310: {
    towgs84: "-30,190,89"
  },
  EPSG_9248: {
    towgs84: "-192.26,65.72,132.08"
  },
  EPSG_4680: {
    towgs84: "124.5,-63.5,-281"
  },
  EPSG_4701: {
    towgs84: "-79.9,-158,-168.9"
  },
  EPSG_4706: {
    towgs84: "-146.21,112.63,4.05"
  },
  EPSG_4805: {
    towgs84: "682,-203,480"
  },
  EPSG_4201: {
    towgs84: "-165,-11,206"
  },
  EPSG_4210: {
    towgs84: "-157,-2,-299"
  },
  EPSG_4183: {
    towgs84: "-104,167,-38"
  },
  EPSG_4139: {
    towgs84: "11,72,-101"
  },
  EPSG_4668: {
    towgs84: "-86,-98,-119"
  },
  EPSG_4717: {
    towgs84: "-2,151,181"
  },
  EPSG_4732: {
    towgs84: "102,52,-38"
  },
  EPSG_4280: {
    towgs84: "-377,681,-50"
  },
  EPSG_4209: {
    towgs84: "-138,-105,-289"
  },
  EPSG_4261: {
    towgs84: "31,146,47"
  },
  EPSG_4658: {
    towgs84: "-73,46,-86"
  },
  EPSG_4721: {
    towgs84: "265.025,384.929,-194.046"
  },
  EPSG_4222: {
    towgs84: "-136,-108,-292"
  },
  EPSG_4601: {
    towgs84: "-255,-15,71"
  },
  EPSG_4602: {
    towgs84: "725,685,536"
  },
  EPSG_4603: {
    towgs84: "72,213.7,93"
  },
  EPSG_4605: {
    towgs84: "9,183,236"
  },
  EPSG_4621: {
    towgs84: "137,248,-430"
  },
  EPSG_4657: {
    towgs84: "-28,199,5"
  },
  EPSG_4316: {
    towgs84: "103.25,-100.4,-307.19"
  },
  EPSG_4642: {
    towgs84: "-13,-348,292"
  },
  EPSG_4698: {
    towgs84: "145,-187,103"
  },
  EPSG_4192: {
    towgs84: "-206.1,-174.7,-87.7"
  },
  EPSG_4311: {
    towgs84: "-265,120,-358"
  },
  EPSG_4135: {
    towgs84: "58,-283,-182"
  },
  ESRI_104138: {
    towgs84: "198,-226,-347"
  },
  EPSG_4245: {
    towgs84: "-11,851,5"
  },
  EPSG_4142: {
    towgs84: "-125,53,467"
  },
  EPSG_4213: {
    towgs84: "-106,-87,188"
  },
  EPSG_4253: {
    towgs84: "-133,-77,-51"
  },
  EPSG_4129: {
    towgs84: "-132,-110,-335"
  },
  EPSG_4713: {
    towgs84: "-77,-128,142"
  },
  EPSG_4239: {
    towgs84: "217,823,299"
  },
  EPSG_4146: {
    towgs84: "295,736,257"
  },
  EPSG_4155: {
    towgs84: "-83,37,124"
  },
  EPSG_4165: {
    towgs84: "-173,253,27"
  },
  EPSG_4672: {
    towgs84: "175,-38,113"
  },
  EPSG_4236: {
    towgs84: "-637,-549,-203"
  },
  EPSG_4251: {
    towgs84: "-90,40,88"
  },
  EPSG_4271: {
    towgs84: "-2,374,172"
  },
  EPSG_4175: {
    towgs84: "-88,4,101"
  },
  EPSG_4716: {
    towgs84: "298,-304,-375"
  },
  EPSG_4315: {
    towgs84: "-23,259,-9"
  },
  EPSG_4744: {
    towgs84: "-242.2,-144.9,370.3"
  },
  EPSG_4244: {
    towgs84: "-97,787,86"
  },
  EPSG_4293: {
    towgs84: "616,97,-251"
  },
  EPSG_4714: {
    towgs84: "-127,-769,472"
  },
  EPSG_4736: {
    towgs84: "260,12,-147"
  },
  EPSG_6883: {
    towgs84: "-235,-110,393"
  },
  EPSG_6894: {
    towgs84: "-63,176,185"
  },
  EPSG_4205: {
    towgs84: "-43,-163,45"
  },
  EPSG_4256: {
    towgs84: "41,-220,-134"
  },
  EPSG_4262: {
    towgs84: "639,405,60"
  },
  EPSG_4604: {
    towgs84: "174,359,365"
  },
  EPSG_4169: {
    towgs84: "-115,118,426"
  },
  EPSG_4620: {
    towgs84: "-106,-129,165"
  },
  EPSG_4184: {
    towgs84: "-203,141,53"
  },
  EPSG_4616: {
    towgs84: "-289,-124,60"
  },
  EPSG_9403: {
    towgs84: "-307,-92,127"
  },
  EPSG_4684: {
    towgs84: "-133,-321,50"
  },
  EPSG_4708: {
    towgs84: "-491,-22,435"
  },
  EPSG_4707: {
    towgs84: "114,-116,-333"
  },
  EPSG_4709: {
    towgs84: "145,75,-272"
  },
  EPSG_4712: {
    towgs84: "-205,107,53"
  },
  EPSG_4711: {
    towgs84: "124,-234,-25"
  },
  EPSG_4718: {
    towgs84: "230,-199,-752"
  },
  EPSG_4719: {
    towgs84: "211,147,111"
  },
  EPSG_4724: {
    towgs84: "208,-435,-229"
  },
  EPSG_4725: {
    towgs84: "189,-79,-202"
  },
  EPSG_4735: {
    towgs84: "647,1777,-1124"
  },
  EPSG_4722: {
    towgs84: "-794,119,-298"
  },
  EPSG_4728: {
    towgs84: "-307,-92,127"
  },
  EPSG_4734: {
    towgs84: "-632,438,-609"
  },
  EPSG_4727: {
    towgs84: "912,-58,1227"
  },
  EPSG_4729: {
    towgs84: "185,165,42"
  },
  EPSG_4730: {
    towgs84: "170,42,84"
  },
  EPSG_4733: {
    towgs84: "276,-57,149"
  },
  ESRI_37218: {
    towgs84: "230,-199,-752"
  },
  ESRI_37240: {
    towgs84: "-7,215,225"
  },
  ESRI_37221: {
    towgs84: "252,-209,-751"
  },
  ESRI_4305: {
    towgs84: "-123,-206,219"
  },
  ESRI_104139: {
    towgs84: "-73,-247,227"
  },
  EPSG_4748: {
    towgs84: "51,391,-36"
  },
  EPSG_4219: {
    towgs84: "-384,664,-48"
  },
  EPSG_4255: {
    towgs84: "-333,-222,114"
  },
  EPSG_4257: {
    towgs84: "-587.8,519.75,145.76"
  },
  EPSG_4646: {
    towgs84: "-963,510,-359"
  },
  EPSG_6881: {
    towgs84: "-24,-203,268"
  },
  EPSG_6882: {
    towgs84: "-183,-15,273"
  },
  EPSG_4715: {
    towgs84: "-104,-129,239"
  },
  IGNF_RGF93GDD: {
    towgs84: "0,0,0"
  },
  IGNF_RGM04GDD: {
    towgs84: "0,0,0"
  },
  IGNF_RGSPM06GDD: {
    towgs84: "0,0,0"
  },
  IGNF_RGTAAF07GDD: {
    towgs84: "0,0,0"
  },
  IGNF_RGFG95GDD: {
    towgs84: "0,0,0"
  },
  IGNF_RGNCG: {
    towgs84: "0,0,0"
  },
  IGNF_RGPFGDD: {
    towgs84: "0,0,0"
  },
  IGNF_ETRS89G: {
    towgs84: "0,0,0"
  },
  IGNF_RGR92GDD: {
    towgs84: "0,0,0"
  },
  EPSG_4173: {
    towgs84: "0,0,0"
  },
  EPSG_4180: {
    towgs84: "0,0,0"
  },
  EPSG_4619: {
    towgs84: "0,0,0"
  },
  EPSG_4667: {
    towgs84: "0,0,0"
  },
  EPSG_4075: {
    towgs84: "0,0,0"
  },
  EPSG_6706: {
    towgs84: "0,0,0"
  },
  EPSG_7798: {
    towgs84: "0,0,0"
  },
  EPSG_4661: {
    towgs84: "0,0,0"
  },
  EPSG_4669: {
    towgs84: "0,0,0"
  },
  EPSG_8685: {
    towgs84: "0,0,0"
  },
  EPSG_4151: {
    towgs84: "0,0,0"
  },
  EPSG_9702: {
    towgs84: "0,0,0"
  },
  EPSG_4758: {
    towgs84: "0,0,0"
  },
  EPSG_4761: {
    towgs84: "0,0,0"
  },
  EPSG_4765: {
    towgs84: "0,0,0"
  },
  EPSG_8997: {
    towgs84: "0,0,0"
  },
  EPSG_4023: {
    towgs84: "0,0,0"
  },
  EPSG_4670: {
    towgs84: "0,0,0"
  },
  EPSG_4694: {
    towgs84: "0,0,0"
  },
  EPSG_4148: {
    towgs84: "0,0,0"
  },
  EPSG_4163: {
    towgs84: "0,0,0"
  },
  EPSG_4167: {
    towgs84: "0,0,0"
  },
  EPSG_4189: {
    towgs84: "0,0,0"
  },
  EPSG_4190: {
    towgs84: "0,0,0"
  },
  EPSG_4176: {
    towgs84: "0,0,0"
  },
  EPSG_4659: {
    towgs84: "0,0,0"
  },
  EPSG_3824: {
    towgs84: "0,0,0"
  },
  EPSG_3889: {
    towgs84: "0,0,0"
  },
  EPSG_4046: {
    towgs84: "0,0,0"
  },
  EPSG_4081: {
    towgs84: "0,0,0"
  },
  EPSG_4558: {
    towgs84: "0,0,0"
  },
  EPSG_4483: {
    towgs84: "0,0,0"
  },
  EPSG_5013: {
    towgs84: "0,0,0"
  },
  EPSG_5264: {
    towgs84: "0,0,0"
  },
  EPSG_5324: {
    towgs84: "0,0,0"
  },
  EPSG_5354: {
    towgs84: "0,0,0"
  },
  EPSG_5371: {
    towgs84: "0,0,0"
  },
  EPSG_5373: {
    towgs84: "0,0,0"
  },
  EPSG_5381: {
    towgs84: "0,0,0"
  },
  EPSG_5393: {
    towgs84: "0,0,0"
  },
  EPSG_5489: {
    towgs84: "0,0,0"
  },
  EPSG_5593: {
    towgs84: "0,0,0"
  },
  EPSG_6135: {
    towgs84: "0,0,0"
  },
  EPSG_6365: {
    towgs84: "0,0,0"
  },
  EPSG_5246: {
    towgs84: "0,0,0"
  },
  EPSG_7886: {
    towgs84: "0,0,0"
  },
  EPSG_8431: {
    towgs84: "0,0,0"
  },
  EPSG_8427: {
    towgs84: "0,0,0"
  },
  EPSG_8699: {
    towgs84: "0,0,0"
  },
  EPSG_8818: {
    towgs84: "0,0,0"
  },
  EPSG_4757: {
    towgs84: "0,0,0"
  },
  EPSG_9140: {
    towgs84: "0,0,0"
  },
  EPSG_8086: {
    towgs84: "0,0,0"
  },
  EPSG_4686: {
    towgs84: "0,0,0"
  },
  EPSG_4737: {
    towgs84: "0,0,0"
  },
  EPSG_4702: {
    towgs84: "0,0,0"
  },
  EPSG_4747: {
    towgs84: "0,0,0"
  },
  EPSG_4749: {
    towgs84: "0,0,0"
  },
  EPSG_4674: {
    towgs84: "0,0,0"
  },
  EPSG_4755: {
    towgs84: "0,0,0"
  },
  EPSG_4759: {
    towgs84: "0,0,0"
  },
  EPSG_4762: {
    towgs84: "0,0,0"
  },
  EPSG_4763: {
    towgs84: "0,0,0"
  },
  EPSG_4764: {
    towgs84: "0,0,0"
  },
  EPSG_4166: {
    towgs84: "0,0,0"
  },
  EPSG_4170: {
    towgs84: "0,0,0"
  },
  EPSG_5546: {
    towgs84: "0,0,0"
  },
  EPSG_7844: {
    towgs84: "0,0,0"
  },
  EPSG_4818: {
    towgs84: "589,76,480"
  },
  EPSG_10328: {
    towgs84: "0,0,0"
  },
  EPSG_9782: {
    towgs84: "0,0,0"
  },
  EPSG_9777: {
    towgs84: "0,0,0"
  },
  EPSG_10690: {
    towgs84: "0,0,0"
  },
  EPSG_10639: {
    towgs84: "0,0,0"
  },
  EPSG_10739: {
    towgs84: "0,0,0"
  },
  EPSG_7686: {
    towgs84: "0,0,0"
  },
  EPSG_8900: {
    towgs84: "0,0,0"
  },
  EPSG_5886: {
    towgs84: "0,0,0"
  },
  EPSG_7683: {
    towgs84: "0,0,0"
  },
  EPSG_6668: {
    towgs84: "0,0,0"
  },
  EPSG_20046: {
    towgs84: "0,0,0"
  },
  EPSG_10299: {
    towgs84: "0,0,0"
  },
  EPSG_10310: {
    towgs84: "0,0,0"
  },
  EPSG_10475: {
    towgs84: "0,0,0"
  },
  EPSG_4742: {
    towgs84: "0,0,0"
  },
  EPSG_10671: {
    towgs84: "0,0,0"
  },
  EPSG_10762: {
    towgs84: "0,0,0"
  },
  EPSG_10725: {
    towgs84: "0,0,0"
  },
  EPSG_10791: {
    towgs84: "0,0,0"
  },
  EPSG_10800: {
    towgs84: "0,0,0"
  },
  EPSG_10305: {
    towgs84: "0,0,0"
  },
  EPSG_10941: {
    towgs84: "0,0,0"
  },
  EPSG_10968: {
    towgs84: "0,0,0"
  },
  EPSG_10875: {
    towgs84: "0,0,0"
  },
  EPSG_6318: {
    towgs84: "0,0,0"
  },
  EPSG_10910: {
    towgs84: "0,0,0"
  }
};
for (var Lv in Zs) {
  var Uc = Zs[Lv];
  Uc.datumName && (Zs[Uc.datumName] = Uc);
}
function Fv(t, e, r, n, i, s, a) {
  var o = {};
  return t === void 0 || t === "none" ? o.datum_type = ih : o.datum_type = Y_, e && (o.datum_params = e.map(parseFloat), (o.datum_params[0] !== 0 || o.datum_params[1] !== 0 || o.datum_params[2] !== 0) && (o.datum_type = nn), o.datum_params.length > 3 && (o.datum_params[3] !== 0 || o.datum_params[4] !== 0 || o.datum_params[5] !== 0 || o.datum_params[6] !== 0) && (o.datum_type = sn, o.datum_params[3] *= Wn, o.datum_params[4] *= Wn, o.datum_params[5] *= Wn, o.datum_params[6] = o.datum_params[6] / 1e6 + 1)), a && (o.datum_type = xn, o.grids = a), o.a = r, o.b = n, o.es = i, o.ep2 = s, o;
}
var jh = {};
function Gv(t, e, r) {
  return e instanceof ArrayBuffer ? zv(t, e, r) : { ready: qv(t, e) };
}
function zv(t, e, r) {
  var n = !0;
  r !== void 0 && r.includeErrorFields === !1 && (n = !1);
  var i = new DataView(e), s = Zv(i), a = Vv(i, s), o = Hv(i, a, s, n), c = { header: a, subgrids: o };
  return jh[t] = c, c;
}
async function qv(t, e) {
  for (var r = [], n = await e.getImageCount(), i = n - 1; i >= 0; i--) {
    var s = await e.getImage(i), a = await s.readRasters(), o = a, c = [s.getWidth(), s.getHeight()], h = s.getBoundingBox().map(s0), f = [s.fileDirectory.ModelPixelScale[0], s.fileDirectory.ModelPixelScale[1]].map(s0), u = h[0] + (c[0] - 1) * f[0], l = h[3] - (c[1] - 1) * f[1], d = o[0], g = o[1], w = [];
    for (let p = c[1] - 1; p >= 0; p--)
      for (let E = c[0] - 1; E >= 0; E--) {
        var m = p * c[0] + E;
        w.push([-jr(g[m]), jr(d[m])]);
      }
    r.push({
      del: f,
      lim: c,
      ll: [-u, l],
      cvs: w
    });
  }
  var v = {
    header: {
      nSubgrids: n
    },
    subgrids: r
  };
  return jh[t] = v, v;
}
function Uv(t) {
  if (t === void 0)
    return null;
  var e = t.split(",");
  return e.map(Bv);
}
function Bv(t) {
  if (t.length === 0)
    return null;
  var e = t[0] === "@";
  return e && (t = t.slice(1)), t === "null" ? { name: "null", mandatory: !e, grid: null, isNull: !0 } : {
    name: t,
    mandatory: !e,
    grid: jh[t] || null,
    isNull: !1
  };
}
function s0(t) {
  return t * Math.PI / 180;
}
function jr(t) {
  return t / 3600 * Math.PI / 180;
}
function Zv(t) {
  var e = t.getInt32(8, !1);
  return e === 11 ? !1 : (e = t.getInt32(8, !0), e !== 11 && console.warn("Failed to detect nadgrid endian-ness, defaulting to little-endian"), !0);
}
function Vv(t, e) {
  return {
    nFields: t.getInt32(8, e),
    nSubgridFields: t.getInt32(24, e),
    nSubgrids: t.getInt32(40, e),
    shiftType: ah(t, 56, 64).trim(),
    fromSemiMajorAxis: t.getFloat64(120, e),
    fromSemiMinorAxis: t.getFloat64(136, e),
    toSemiMajorAxis: t.getFloat64(152, e),
    toSemiMinorAxis: t.getFloat64(168, e)
  };
}
function ah(t, e, r) {
  return String.fromCharCode.apply(null, new Uint8Array(t.buffer.slice(e, r)));
}
function Hv(t, e, r, n) {
  for (var i = 176, s = [], a = 0; a < e.nSubgrids; a++) {
    var o = Xv(t, i, r), c = Wv(t, i, o, r, n), h = Math.round(
      1 + (o.upperLongitude - o.lowerLongitude) / o.longitudeInterval
    ), f = Math.round(
      1 + (o.upperLatitude - o.lowerLatitude) / o.latitudeInterval
    );
    s.push({
      ll: [jr(o.lowerLongitude), jr(o.lowerLatitude)],
      del: [jr(o.longitudeInterval), jr(o.latitudeInterval)],
      lim: [h, f],
      count: o.gridNodeCount,
      cvs: Kv(c)
    });
    var u = 16;
    n === !1 && (u = 8), i += 176 + o.gridNodeCount * u;
  }
  return s;
}
function Kv(t) {
  return t.map(function(e) {
    return [jr(e.longitudeShift), jr(e.latitudeShift)];
  });
}
function Xv(t, e, r) {
  return {
    name: ah(t, e + 8, e + 16).trim(),
    parent: ah(t, e + 24, e + 24 + 8).trim(),
    lowerLatitude: t.getFloat64(e + 72, r),
    upperLatitude: t.getFloat64(e + 88, r),
    lowerLongitude: t.getFloat64(e + 104, r),
    upperLongitude: t.getFloat64(e + 120, r),
    latitudeInterval: t.getFloat64(e + 136, r),
    longitudeInterval: t.getFloat64(e + 152, r),
    gridNodeCount: t.getInt32(e + 168, r)
  };
}
function Wv(t, e, r, n, i) {
  var s = e + 176, a = 16;
  i === !1 && (a = 8);
  for (var o = [], c = 0; c < r.gridNodeCount; c++) {
    var h = {
      latitudeShift: t.getFloat32(s + c * a, n),
      longitudeShift: t.getFloat32(s + c * a + 4, n)
    };
    i !== !1 && (h.latitudeAccuracy = t.getFloat32(s + c * a + 8, n), h.longitudeAccuracy = t.getFloat32(s + c * a + 12, n)), o.push(h);
  }
  return o;
}
function qe(t, e) {
  if (!(this instanceof qe))
    return new qe(t);
  this.forward = null, this.inverse = null, this.init = null, this.name, this.names = null, this.title, e = e || function(h) {
    if (h)
      throw h;
  };
  var r = Sv(t);
  if (typeof r != "object") {
    e("Could not parse to valid json: " + t);
    return;
  }
  var n = qe.projections.get(r.projName);
  if (!n) {
    e("Could not get projection name from: " + t);
    return;
  }
  if (r.datumCode && r.datumCode !== "none") {
    var i = Lr(Zs, r.datumCode);
    i && (r.datum_params = r.datum_params || (i.towgs84 ? i.towgs84.split(",") : null), r.ellps = i.ellipse, r.datumName = i.datumName ? i.datumName : r.datumCode);
  }
  r.k0 = r.k0 || 1, r.axis = r.axis || "enu", r.ellps = r.ellps || "wgs84", r.lat1 = r.lat1 || r.lat0;
  var s = Cv(r.a, r.b, r.rf, r.ellps, r.sphere), a = Tv(s.a, s.b, s.rf, r.R_A), o = Uv(r.nadgrids), c = r.datum || Fv(
    r.datumCode,
    r.datum_params,
    s.a,
    s.b,
    a.es,
    a.ep2,
    o
  );
  n0(this, r), n0(this, n), this.a = s.a, this.b = s.b, this.rf = s.rf, this.sphere = s.sphere, this.es = a.es, this.e = a.e, this.ep2 = a.ep2, this.datum = c, "init" in this && typeof this.init == "function" && this.init(), e(null, this);
}
qe.projections = Dv;
qe.projections.start();
function Jv(t, e) {
  return t.datum_type !== e.datum_type || t.a !== e.a || Math.abs(t.es - e.es) > 5e-11 ? !1 : t.datum_type === nn ? t.datum_params[0] === e.datum_params[0] && t.datum_params[1] === e.datum_params[1] && t.datum_params[2] === e.datum_params[2] : t.datum_type === sn ? t.datum_params[0] === e.datum_params[0] && t.datum_params[1] === e.datum_params[1] && t.datum_params[2] === e.datum_params[2] && t.datum_params[3] === e.datum_params[3] && t.datum_params[4] === e.datum_params[4] && t.datum_params[5] === e.datum_params[5] && t.datum_params[6] === e.datum_params[6] : !0;
}
function sp(t, e, r) {
  var n = t.x, i = t.y, s = t.z ? t.z : 0, a, o, c, h;
  if (i < -st && i > -1.001 * st)
    i = -st;
  else if (i > st && i < 1.001 * st)
    i = st;
  else {
    if (i < -st)
      return { x: -1 / 0, y: -1 / 0, z: t.z };
    if (i > st)
      return { x: 1 / 0, y: 1 / 0, z: t.z };
  }
  return n > Math.PI && (n -= 2 * Math.PI), o = Math.sin(i), h = Math.cos(i), c = o * o, a = r / Math.sqrt(1 - e * c), {
    x: (a + s) * h * Math.cos(n),
    y: (a + s) * h * Math.sin(n),
    z: (a * (1 - e) + s) * o
  };
}
function ap(t, e, r, n) {
  var i = 1e-12, s = i * i, a = 30, o, c, h, f, u, l, d, g, w, m, v, p, E, _ = t.x, y = t.y, b = t.z ? t.z : 0, S, x, M;
  if (o = Math.sqrt(_ * _ + y * y), c = Math.sqrt(_ * _ + y * y + b * b), o / r < i) {
    if (S = 0, c / r < i)
      return x = st, M = -n, {
        x: t.x,
        y: t.y,
        z: t.z
      };
  } else
    S = Math.atan2(y, _);
  h = b / c, f = o / c, u = 1 / Math.sqrt(1 - e * (2 - e) * f * f), g = f * (1 - e) * u, w = h * u, E = 0;
  do
    E++, d = r / Math.sqrt(1 - e * w * w), M = o * g + b * w - d * (1 - e * w * w), l = e * d / (d + M), u = 1 / Math.sqrt(1 - l * (2 - l) * f * f), m = f * (1 - l) * u, v = h * u, p = v * g - m * w, g = m, w = v;
  while (p * p > s && E < a);
  return x = Math.atan(v / Math.abs(m)), {
    x: S,
    y: x,
    z: M
  };
}
function Yv(t, e, r) {
  if (e === nn)
    return {
      x: t.x + r[0],
      y: t.y + r[1],
      z: t.z + r[2]
    };
  if (e === sn) {
    var n = r[0], i = r[1], s = r[2], a = r[3], o = r[4], c = r[5], h = r[6];
    return {
      x: h * (t.x - c * t.y + o * t.z) + n,
      y: h * (c * t.x + t.y - a * t.z) + i,
      z: h * (-o * t.x + a * t.y + t.z) + s
    };
  }
}
function Qv(t, e, r) {
  if (e === nn)
    return {
      x: t.x - r[0],
      y: t.y - r[1],
      z: t.z - r[2]
    };
  if (e === sn) {
    var n = r[0], i = r[1], s = r[2], a = r[3], o = r[4], c = r[5], h = r[6], f = (t.x - n) / h, u = (t.y - i) / h, l = (t.z - s) / h;
    return {
      x: f + c * u - o * l,
      y: -c * f + u + a * l,
      z: o * f - a * u + l
    };
  }
}
function $s(t) {
  return t === nn || t === sn;
}
function t2(t, e, r) {
  if (Jv(t, e) || t.datum_type === ih || e.datum_type === ih)
    return r;
  var n = t.a, i = t.es;
  if (t.datum_type === xn) {
    var s = a0(t, !1, r);
    if (s !== 0)
      return;
    n = Wd, i = Jd;
  }
  var a = e.a, o = e.b, c = e.es;
  if (e.datum_type === xn && (a = Wd, o = Q_, c = Jd), i === c && n === a && !$s(t.datum_type) && !$s(e.datum_type))
    return r;
  if (r = sp(r, i, n), $s(t.datum_type) && (r = Yv(r, t.datum_type, t.datum_params)), $s(e.datum_type) && (r = Qv(r, e.datum_type, e.datum_params)), r = ap(r, c, a, o), e.datum_type === xn) {
    var h = a0(e, !0, r);
    if (h !== 0)
      return;
  }
  return r;
}
function a0(t, e, r) {
  if (t.grids === null || t.grids.length === 0)
    return console.log("Grid shift grids not found"), -1;
  var n = { x: -r.x, y: r.y }, i = { x: Number.NaN, y: Number.NaN }, s = [];
  t:
    for (var a = 0; a < t.grids.length; a++) {
      var o = t.grids[a];
      if (s.push(o.name), o.isNull) {
        i = n;
        break;
      }
      if (o.grid === null) {
        if (o.mandatory)
          return console.log("Unable to find mandatory grid '" + o.name + "'"), -1;
        continue;
      }
      for (var c = o.grid.subgrids, h = 0, f = c.length; h < f; h++) {
        var u = c[h], l = (Math.abs(u.del[1]) + Math.abs(u.del[0])) / 1e4, d = u.ll[0] - l, g = u.ll[1] - l, w = u.ll[0] + (u.lim[0] - 1) * u.del[0] + l, m = u.ll[1] + (u.lim[1] - 1) * u.del[1] + l;
        if (!(g > n.y || d > n.x || m < n.y || w < n.x) && (i = e2(n, e, u), !isNaN(i.x)))
          break t;
      }
    }
  return isNaN(i.x) ? (console.log("Failed to find a grid shift table for location '" + -n.x * Ne + " " + n.y * Ne + " tried: '" + s + "'"), -1) : (r.x = -i.x, r.y = i.y, 0);
}
function e2(t, e, r) {
  var n = { x: Number.NaN, y: Number.NaN };
  if (isNaN(t.x))
    return n;
  var i = { x: t.x, y: t.y };
  i.x -= r.ll[0], i.y -= r.ll[1], i.x = wt(i.x - Math.PI) + Math.PI;
  var s = o0(i, r);
  if (e) {
    if (isNaN(s.x))
      return n;
    s.x = i.x - s.x, s.y = i.y - s.y;
    var a = 9, o = 1e-12, c, h;
    do {
      if (h = o0(s, r), isNaN(h.x)) {
        console.log("Inverse grid shift iteration failed, presumably at grid edge.  Using first approximation.");
        break;
      }
      c = { x: i.x - (h.x + s.x), y: i.y - (h.y + s.y) }, s.x += c.x, s.y += c.y;
    } while (a-- && Math.abs(c.x) > o && Math.abs(c.y) > o);
    if (a < 0)
      return console.log("Inverse grid shift iterator failed to converge."), n;
    n.x = wt(s.x + r.ll[0]), n.y = s.y + r.ll[1];
  } else
    isNaN(s.x) || (n.x = t.x + s.x, n.y = t.y + s.y);
  return n;
}
function o0(t, e) {
  var r = { x: t.x / e.del[0], y: t.y / e.del[1] }, n = { x: Math.floor(r.x), y: Math.floor(r.y) }, i = { x: r.x - 1 * n.x, y: r.y - 1 * n.y }, s = { x: Number.NaN, y: Number.NaN }, a;
  if (n.x < 0 || n.x >= e.lim[0] || n.y < 0 || n.y >= e.lim[1])
    return s;
  a = n.y * e.lim[0] + n.x;
  var o = { x: e.cvs[a][0], y: e.cvs[a][1] };
  a++;
  var c = { x: e.cvs[a][0], y: e.cvs[a][1] };
  a += e.lim[0];
  var h = { x: e.cvs[a][0], y: e.cvs[a][1] };
  a--;
  var f = { x: e.cvs[a][0], y: e.cvs[a][1] }, u = i.x * i.y, l = i.x * (1 - i.y), d = (1 - i.x) * (1 - i.y), g = (1 - i.x) * i.y;
  return s.x = d * o.x + l * c.x + g * f.x + u * h.x, s.y = d * o.y + l * c.y + g * f.y + u * h.y, s;
}
function c0(t, e, r) {
  var n = r.x, i = r.y, s = r.z || 0, a, o, c, h = {};
  for (c = 0; c < 3; c++)
    if (!(e && c === 2 && r.z === void 0))
      switch (c === 0 ? (a = n, "ew".indexOf(t.axis[c]) !== -1 ? o = "x" : o = "y") : c === 1 ? (a = i, "ns".indexOf(t.axis[c]) !== -1 ? o = "y" : o = "x") : (a = s, o = "z"), t.axis[c]) {
        case "e":
          h[o] = a;
          break;
        case "w":
          h[o] = -a;
          break;
        case "n":
          h[o] = a;
          break;
        case "s":
          h[o] = -a;
          break;
        case "u":
          r[o] !== void 0 && (h.z = a);
          break;
        case "d":
          r[o] !== void 0 && (h.z = -a);
          break;
        default:
          return null;
      }
  return h;
}
function op(t) {
  var e = {
    x: t[0],
    y: t[1]
  };
  return t.length > 2 && (e.z = t[2]), t.length > 3 && (e.m = t[3]), e;
}
function r2(t) {
  h0(t.x), h0(t.y);
}
function h0(t) {
  if (typeof Number.isFinite == "function") {
    if (Number.isFinite(t))
      return;
    throw new TypeError("coordinates must be finite numbers");
  }
  if (typeof t != "number" || t !== t || !isFinite(t))
    throw new TypeError("coordinates must be finite numbers");
}
function n2(t, e) {
  return (t.datum.datum_type === nn || t.datum.datum_type === sn || t.datum.datum_type === xn) && e.datumCode !== "WGS84" || (e.datum.datum_type === nn || e.datum.datum_type === sn || e.datum.datum_type === xn) && t.datumCode !== "WGS84";
}
function ra(t, e, r, n) {
  var i;
  Array.isArray(r) ? r = op(r) : r = {
    x: r.x,
    y: r.y,
    z: r.z,
    m: r.m
  };
  var s = r.z !== void 0;
  if (r2(r), t.datum && e.datum && n2(t, e) && (i = new qe("WGS84"), r = ra(t, i, r, n), t = i), n && t.axis !== "enu" && (r = c0(t, !1, r)), t.projName === "longlat")
    r = {
      x: r.x * Yt,
      y: r.y * Yt,
      z: r.z || 0
    };
  else if (t.to_meter && (r = {
    x: r.x * t.to_meter,
    y: r.y * t.to_meter,
    z: r.z || 0
  }), r = t.inverse(r), !r)
    return;
  if (t.from_greenwich && (r.x += t.from_greenwich), r = t2(t.datum, e.datum, r), !!r)
    return r = /** @type {import('./core').InterfaceCoordinates} */
    r, e.from_greenwich && (r = {
      x: r.x - e.from_greenwich,
      y: r.y,
      z: r.z || 0
    }), e.projName === "longlat" ? r = {
      x: r.x * Ne,
      y: r.y * Ne,
      z: r.z || 0
    } : (r = e.forward(r), e.to_meter && (r = {
      x: r.x / e.to_meter,
      y: r.y / e.to_meter,
      z: r.z || 0
    })), n && e.axis !== "enu" ? c0(e, !0, r) : (r && !s && delete r.z, r);
}
var l0 = qe("WGS84");
function Bc(t, e, r, n) {
  var i, s, a;
  return Array.isArray(r) ? (i = ra(t, e, r, n) || { x: NaN, y: NaN }, r.length > 2 ? typeof t.name < "u" && t.name === "geocent" || typeof e.name < "u" && e.name === "geocent" ? typeof i.z == "number" ? (
    /** @type {T} */
    [i.x, i.y, i.z].concat(r.slice(3))
  ) : (
    /** @type {T} */
    [i.x, i.y, r[2]].concat(r.slice(3))
  ) : (
    /** @type {T} */
    [i.x, i.y].concat(r.slice(2))
  ) : (
    /** @type {T} */
    [i.x, i.y]
  )) : (s = ra(t, e, r, n), a = Object.keys(r), a.length === 2 || a.forEach(function(o) {
    if (typeof t.name < "u" && t.name === "geocent" || typeof e.name < "u" && e.name === "geocent") {
      if (o === "x" || o === "y" || o === "z")
        return;
    } else if (o === "x" || o === "y")
      return;
    s[o] = r[o];
  }), /** @type {T} */
  s);
}
function Is(t) {
  return t instanceof qe ? t : typeof t == "object" && "oProj" in t ? t.oProj : qe(
    /** @type {string | PROJJSONDefinition} */
    t
  );
}
function i2(t, e, r) {
  var n, i, s = !1, a;
  return typeof e > "u" ? (i = Is(t), n = l0, s = !0) : (typeof /** @type {?} */
  e.x < "u" || Array.isArray(e)) && (r = /** @type {T} */
  /** @type {?} */
  e, i = Is(t), n = l0, s = !0), n || (n = Is(t)), i || (i = Is(
    /** @type {string | PROJJSONDefinition | proj } */
    e
  )), r ? Bc(n, i, r) : (a = {
    /**
     * @template {TemplateCoordinates} T
     * @param {T} coords
     * @param {boolean=} enforceAxis
     * @returns {T}
     */
    forward: function(o, c) {
      return Bc(n, i, o, c);
    },
    /**
     * @template {TemplateCoordinates} T
     * @param {T} coords
     * @param {boolean=} enforceAxis
     * @returns {T}
     */
    inverse: function(o, c) {
      return Bc(i, n, o, c);
    }
  }, s && (a.oProj = i), a);
}
var u0 = 6, cp = "AJSAJS", hp = "AFAFAF", bn = 65, Ie = 73, Ge = 79, Zn = 86, Vn = 90;
const s2 = {
  forward: lp,
  inverse: a2,
  toPoint: up
};
function lp(t, e) {
  return e = e || 5, h2(o2({
    lat: t[1],
    lon: t[0]
  }), e);
}
function a2(t) {
  var e = Th(dp(t.toUpperCase()));
  return e.lat && e.lon ? [e.lon, e.lat, e.lon, e.lat] : [e.left, e.bottom, e.right, e.top];
}
function up(t) {
  var e = Th(dp(t.toUpperCase()));
  return e.lat && e.lon ? [e.lon, e.lat] : [(e.left + e.right) / 2, (e.top + e.bottom) / 2];
}
function Zc(t) {
  return t * (Math.PI / 180);
}
function f0(t) {
  return 180 * (t / Math.PI);
}
function o2(t) {
  var e = t.lat, r = t.lon, n = 6378137, i = 669438e-8, s = 0.9996, a, o, c, h, f, u, l, d = Zc(e), g = Zc(r), w, m;
  m = Math.floor((r + 180) / 6) + 1, r === 180 && (m = 60), e >= 56 && e < 64 && r >= 3 && r < 12 && (m = 32), e >= 72 && e < 84 && (r >= 0 && r < 9 ? m = 31 : r >= 9 && r < 21 ? m = 33 : r >= 21 && r < 33 ? m = 35 : r >= 33 && r < 42 && (m = 37)), a = (m - 1) * 6 - 180 + 3, w = Zc(a), o = i / (1 - i), c = n / Math.sqrt(1 - i * Math.sin(d) * Math.sin(d)), h = Math.tan(d) * Math.tan(d), f = o * Math.cos(d) * Math.cos(d), u = Math.cos(d) * (g - w), l = n * ((1 - i / 4 - 3 * i * i / 64 - 5 * i * i * i / 256) * d - (3 * i / 8 + 3 * i * i / 32 + 45 * i * i * i / 1024) * Math.sin(2 * d) + (15 * i * i / 256 + 45 * i * i * i / 1024) * Math.sin(4 * d) - 35 * i * i * i / 3072 * Math.sin(6 * d));
  var v = s * c * (u + (1 - h + f) * u * u * u / 6 + (5 - 18 * h + h * h + 72 * f - 58 * o) * u * u * u * u * u / 120) + 5e5, p = s * (l + c * Math.tan(d) * (u * u / 2 + (5 - h + 9 * f + 4 * f * f) * u * u * u * u / 24 + (61 - 58 * h + h * h + 600 * f - 330 * o) * u * u * u * u * u * u / 720));
  return e < 0 && (p += 1e7), {
    northing: Math.round(p),
    easting: Math.round(v),
    zoneNumber: m,
    zoneLetter: c2(e)
  };
}
function Th(t) {
  var e = t.northing, r = t.easting, n = t.zoneLetter, i = t.zoneNumber;
  if (i < 0 || i > 60)
    return null;
  var s = 0.9996, a = 6378137, o = 669438e-8, c, h = (1 - Math.sqrt(1 - o)) / (1 + Math.sqrt(1 - o)), f, u, l, d, g, w, m, v, p, E = r - 5e5, _ = e;
  n < "N" && (_ -= 1e7), m = (i - 1) * 6 - 180 + 3, c = o / (1 - o), w = _ / s, v = w / (a * (1 - o / 4 - 3 * o * o / 64 - 5 * o * o * o / 256)), p = v + (3 * h / 2 - 27 * h * h * h / 32) * Math.sin(2 * v) + (21 * h * h / 16 - 55 * h * h * h * h / 32) * Math.sin(4 * v) + 151 * h * h * h / 96 * Math.sin(6 * v), f = a / Math.sqrt(1 - o * Math.sin(p) * Math.sin(p)), u = Math.tan(p) * Math.tan(p), l = c * Math.cos(p) * Math.cos(p), d = a * (1 - o) / Math.pow(1 - o * Math.sin(p) * Math.sin(p), 1.5), g = E / (f * s);
  var y = p - f * Math.tan(p) / d * (g * g / 2 - (5 + 3 * u + 10 * l - 4 * l * l - 9 * c) * g * g * g * g / 24 + (61 + 90 * u + 298 * l + 45 * u * u - 252 * c - 3 * l * l) * g * g * g * g * g * g / 720);
  y = f0(y);
  var b = (g - (1 + 2 * u + l) * g * g * g / 6 + (5 - 2 * l + 28 * u - 3 * l * l + 8 * c + 24 * u * u) * g * g * g * g * g / 120) / Math.cos(p);
  b = m + f0(b);
  var S;
  if (t.accuracy) {
    var x = Th({
      northing: t.northing + t.accuracy,
      easting: t.easting + t.accuracy,
      zoneLetter: t.zoneLetter,
      zoneNumber: t.zoneNumber
    });
    S = {
      top: x.lat,
      right: x.lon,
      bottom: y,
      left: b
    };
  } else
    S = {
      lat: y,
      lon: b
    };
  return S;
}
function c2(t) {
  var e = "Z";
  return 84 >= t && t >= 72 ? e = "X" : 72 > t && t >= 64 ? e = "W" : 64 > t && t >= 56 ? e = "V" : 56 > t && t >= 48 ? e = "U" : 48 > t && t >= 40 ? e = "T" : 40 > t && t >= 32 ? e = "S" : 32 > t && t >= 24 ? e = "R" : 24 > t && t >= 16 ? e = "Q" : 16 > t && t >= 8 ? e = "P" : 8 > t && t >= 0 ? e = "N" : 0 > t && t >= -8 ? e = "M" : -8 > t && t >= -16 ? e = "L" : -16 > t && t >= -24 ? e = "K" : -24 > t && t >= -32 ? e = "J" : -32 > t && t >= -40 ? e = "H" : -40 > t && t >= -48 ? e = "G" : -48 > t && t >= -56 ? e = "F" : -56 > t && t >= -64 ? e = "E" : -64 > t && t >= -72 ? e = "D" : -72 > t && t >= -80 && (e = "C"), e;
}
function h2(t, e) {
  var r = "00000" + t.easting, n = "00000" + t.northing;
  return t.zoneNumber + t.zoneLetter + l2(t.easting, t.northing, t.zoneNumber) + r.substr(r.length - 5, e) + n.substr(n.length - 5, e);
}
function l2(t, e, r) {
  var n = fp(r), i = Math.floor(t / 1e5), s = Math.floor(e / 1e5) % 20;
  return u2(i, s, n);
}
function fp(t) {
  var e = t % u0;
  return e === 0 && (e = u0), e;
}
function u2(t, e, r) {
  var n = r - 1, i = cp.charCodeAt(n), s = hp.charCodeAt(n), a = i + t - 1, o = s + e, c = !1;
  a > Vn && (a = a - Vn + bn - 1, c = !0), (a === Ie || i < Ie && a > Ie || (a > Ie || i < Ie) && c) && a++, (a === Ge || i < Ge && a > Ge || (a > Ge || i < Ge) && c) && (a++, a === Ie && a++), a > Vn && (a = a - Vn + bn - 1), o > Zn ? (o = o - Zn + bn - 1, c = !0) : c = !1, (o === Ie || s < Ie && o > Ie || (o > Ie || s < Ie) && c) && o++, (o === Ge || s < Ge && o > Ge || (o > Ge || s < Ge) && c) && (o++, o === Ie && o++), o > Zn && (o = o - Zn + bn - 1);
  var h = String.fromCharCode(a) + String.fromCharCode(o);
  return h;
}
function dp(t) {
  if (t && t.length === 0)
    throw "MGRSPoint coverting from nothing";
  for (var e = t.length, r = null, n = "", i, s = 0; !/[A-Z]/.test(i = t.charAt(s)); ) {
    if (s >= 2)
      throw "MGRSPoint bad conversion from: " + t;
    n += i, s++;
  }
  var a = parseInt(n, 10);
  if (s === 0 || s + 3 > e)
    throw "MGRSPoint bad conversion from: " + t;
  var o = t.charAt(s++);
  if (o <= "A" || o === "B" || o === "Y" || o >= "Z" || o === "I" || o === "O")
    throw "MGRSPoint zone letter " + o + " not handled: " + t;
  r = t.substring(s, s += 2);
  for (var c = fp(a), h = f2(r.charAt(0), c), f = d2(r.charAt(1), c); f < m2(o); )
    f += 2e6;
  var u = e - s;
  if (u % 2 !== 0)
    throw `MGRSPoint has to have an even number 
of digits after the zone letter and two 100km letters - front 
half for easting meters, second half for 
northing meters` + t;
  var l = u / 2, d = 0, g = 0, w, m, v, p, E;
  return l > 0 && (w = 1e5 / Math.pow(10, l), m = t.substring(s, s + l), d = parseFloat(m) * w, v = t.substring(s + l), g = parseFloat(v) * w), p = d + h, E = g + f, {
    easting: p,
    northing: E,
    zoneLetter: o,
    zoneNumber: a,
    accuracy: w
  };
}
function f2(t, e) {
  for (var r = cp.charCodeAt(e - 1), n = 1e5, i = !1; r !== t.charCodeAt(0); ) {
    if (r++, r === Ie && r++, r === Ge && r++, r > Vn) {
      if (i)
        throw "Bad character: " + t;
      r = bn, i = !0;
    }
    n += 1e5;
  }
  return n;
}
function d2(t, e) {
  if (t > "V")
    throw "MGRSPoint given invalid Northing " + t;
  for (var r = hp.charCodeAt(e - 1), n = 0, i = !1; r !== t.charCodeAt(0); ) {
    if (r++, r === Ie && r++, r === Ge && r++, r > Zn) {
      if (i)
        throw "Bad character: " + t;
      r = bn, i = !0;
    }
    n += 1e5;
  }
  return n;
}
function m2(t) {
  var e;
  switch (t) {
    case "C":
      e = 11e5;
      break;
    case "D":
      e = 2e6;
      break;
    case "E":
      e = 28e5;
      break;
    case "F":
      e = 37e5;
      break;
    case "G":
      e = 46e5;
      break;
    case "H":
      e = 55e5;
      break;
    case "J":
      e = 64e5;
      break;
    case "K":
      e = 73e5;
      break;
    case "L":
      e = 82e5;
      break;
    case "M":
      e = 91e5;
      break;
    case "N":
      e = 0;
      break;
    case "P":
      e = 8e5;
      break;
    case "Q":
      e = 17e5;
      break;
    case "R":
      e = 26e5;
      break;
    case "S":
      e = 35e5;
      break;
    case "T":
      e = 44e5;
      break;
    case "U":
      e = 53e5;
      break;
    case "V":
      e = 62e5;
      break;
    case "W":
      e = 7e6;
      break;
    case "X":
      e = 79e5;
      break;
    default:
      e = -1;
  }
  if (e >= 0)
    return e;
  throw "Invalid zone letter: " + t;
}
function Pn(t, e, r) {
  if (!(this instanceof Pn))
    return new Pn(t, e, r);
  if (Array.isArray(t))
    this.x = t[0], this.y = t[1], this.z = t[2] || 0;
  else if (typeof t == "object")
    this.x = t.x, this.y = t.y, this.z = t.z || 0;
  else if (typeof t == "string" && typeof e > "u") {
    var n = t.split(",");
    this.x = parseFloat(n[0]), this.y = parseFloat(n[1]), this.z = parseFloat(n[2]) || 0;
  } else
    this.x = t, this.y = e, this.z = r || 0;
  console.warn("proj4.Point will be removed in version 3, use proj4.toPoint");
}
Pn.fromMGRS = function(t) {
  return new Pn(up(t));
};
Pn.prototype.toMGRS = function(t) {
  return lp([this.x, this.y], t);
};
var p2 = 1, y2 = 0.25, d0 = 0.046875, m0 = 0.01953125, p0 = 0.01068115234375, g2 = 0.75, w2 = 0.46875, _2 = 0.013020833333333334, v2 = 0.007120768229166667, E2 = 0.3645833333333333, b2 = 0.005696614583333333, S2 = 0.3076171875;
function Ch(t) {
  var e = [];
  e[0] = p2 - t * (y2 + t * (d0 + t * (m0 + t * p0))), e[1] = t * (g2 - t * (d0 + t * (m0 + t * p0)));
  var r = t * t;
  return e[2] = r * (w2 - t * (_2 + t * v2)), r *= t, e[3] = r * (E2 - t * b2), e[4] = r * t * S2, e;
}
function Rn(t, e, r, n) {
  return r *= e, e *= e, n[0] * t - r * (n[1] + e * (n[2] + e * (n[3] + e * n[4])));
}
var M2 = 20;
function Lh(t, e, r) {
  for (var n = 1 / (1 - e), i = t, s = M2; s; --s) {
    var a = Math.sin(i), o = 1 - e * a * a;
    if (o = (Rn(i, a, Math.cos(i), r) - t) * (o * Math.sqrt(o)) * n, i -= o, Math.abs(o) < pt)
      return i;
  }
  return i;
}
function x2() {
  this.x0 = this.x0 !== void 0 ? this.x0 : 0, this.y0 = this.y0 !== void 0 ? this.y0 : 0, this.long0 = this.long0 !== void 0 ? this.long0 : 0, this.lat0 = this.lat0 !== void 0 ? this.lat0 : 0, this.es && (this.en = Ch(this.es), this.ml0 = Rn(this.lat0, Math.sin(this.lat0), Math.cos(this.lat0), this.en));
}
function k2(t) {
  var e = t.x, r = t.y, n = wt(e - this.long0, this.over), i, s, a, o = Math.sin(r), c = Math.cos(r);
  if (this.es) {
    var f = c * n, u = Math.pow(f, 2), l = this.ep2 * Math.pow(c, 2), d = Math.pow(l, 2), g = Math.abs(c) > pt ? Math.tan(r) : 0, w = Math.pow(g, 2), m = Math.pow(w, 2);
    i = 1 - this.es * Math.pow(o, 2), f = f / Math.sqrt(i);
    var v = Rn(r, o, c, this.en);
    s = this.a * (this.k0 * f * (1 + u / 6 * (1 - w + l + u / 20 * (5 - 18 * w + m + 14 * l - 58 * w * l + u / 42 * (61 + 179 * m - m * w - 479 * w))))) + this.x0, a = this.a * (this.k0 * (v - this.ml0 + o * n * f / 2 * (1 + u / 12 * (5 - w + 9 * l + 4 * d + u / 30 * (61 + m - 58 * w + 270 * l - 330 * w * l + u / 56 * (1385 + 543 * m - m * w - 3111 * w)))))) + this.y0;
  } else {
    var h = c * Math.sin(n);
    if (Math.abs(Math.abs(h) - 1) < pt)
      return 93;
    if (s = 0.5 * this.a * this.k0 * Math.log((1 + h) / (1 - h)) + this.x0, a = c * Math.cos(n) / Math.sqrt(1 - Math.pow(h, 2)), h = Math.abs(a), h >= 1) {
      if (h - 1 > pt)
        return 93;
      a = 0;
    } else
      a = Math.acos(a);
    r < 0 && (a = -a), a = this.a * this.k0 * (a - this.lat0) + this.y0;
  }
  return t.x = s, t.y = a, t;
}
function $2(t) {
  var e, r, n, i, s = (t.x - this.x0) * (1 / this.a), a = (t.y - this.y0) * (1 / this.a);
  if (this.es)
    if (e = this.ml0 + a / this.k0, r = Lh(e, this.es, this.en), Math.abs(r) < st) {
      var u = Math.sin(r), l = Math.cos(r), d = Math.abs(l) > pt ? Math.tan(r) : 0, g = this.ep2 * Math.pow(l, 2), w = Math.pow(g, 2), m = Math.pow(d, 2), v = Math.pow(m, 2);
      e = 1 - this.es * Math.pow(u, 2);
      var p = s * Math.sqrt(e) / this.k0, E = Math.pow(p, 2);
      e = e * d, n = r - e * E / (1 - this.es) * 0.5 * (1 - E / 12 * (5 + 3 * m - 9 * g * m + g - 4 * w - E / 30 * (61 + 90 * m - 252 * g * m + 45 * v + 46 * g - E / 56 * (1385 + 3633 * m + 4095 * v + 1574 * v * m)))), i = wt(this.long0 + p * (1 - E / 6 * (1 + 2 * m + g - E / 20 * (5 + 28 * m + 24 * v + 8 * g * m + 6 * g - E / 42 * (61 + 662 * m + 1320 * v + 720 * v * m)))) / l, this.over);
    } else
      n = st * di(a), i = 0;
  else {
    var o = Math.exp(s / this.k0), c = 0.5 * (o - 1 / o), h = this.lat0 + a / this.k0, f = Math.cos(h);
    e = Math.sqrt((1 - Math.pow(f, 2)) / (1 + Math.pow(c, 2))), n = Math.asin(e), a < 0 && (n = -n), c === 0 && f === 0 ? i = 0 : i = wt(Math.atan2(c, f) + this.long0, this.over);
  }
  return t.x = i, t.y = n, t;
}
var I2 = ["Fast_Transverse_Mercator", "Fast Transverse Mercator"];
const Vs = {
  init: x2,
  forward: k2,
  inverse: $2,
  names: I2
};
function mp(t) {
  var e = Math.exp(t);
  return e = (e - 1 / e) / 2, e;
}
function Ae(t, e) {
  t = Math.abs(t), e = Math.abs(e);
  var r = Math.max(t, e), n = Math.min(t, e) / (r || 1);
  return r * Math.sqrt(1 + Math.pow(n, 2));
}
function P2(t) {
  var e = 1 + t, r = e - 1;
  return r === 0 ? t : t * Math.log(e) / r;
}
function A2(t) {
  var e = Math.abs(t);
  return e = P2(e * (1 + e / (Ae(1, e) + 1))), t < 0 ? -e : e;
}
function Fh(t, e) {
  for (var r = 2 * Math.cos(2 * e), n = t.length - 1, i = t[n], s = 0, a; --n >= 0; )
    a = -s + r * i + t[n], s = i, i = a;
  return e + a * Math.sin(2 * e);
}
function N2(t, e) {
  for (var r = 2 * Math.cos(e), n = t.length - 1, i = t[n], s = 0, a; --n >= 0; )
    a = -s + r * i + t[n], s = i, i = a;
  return Math.sin(e) * a;
}
function O2(t) {
  var e = Math.exp(t);
  return e = (e + 1 / e) / 2, e;
}
function pp(t, e, r) {
  for (var n = Math.sin(e), i = Math.cos(e), s = mp(r), a = O2(r), o = 2 * i * a, c = -2 * n * s, h = t.length - 1, f = t[h], u = 0, l = 0, d = 0, g, w; --h >= 0; )
    g = l, w = u, l = f, u = d, f = -g + o * l - c * u + t[h], d = -w + c * l + o * u;
  return o = n * a, c = i * s, [o * f - c * d, o * d + c * f];
}
function R2() {
  if (!this.approx && (isNaN(this.es) || this.es <= 0))
    throw new Error('Incorrect elliptical usage. Try using the +approx option in the proj string, or PROJECTION["Fast_Transverse_Mercator"] in the WKT.');
  this.approx && (Vs.init.apply(this), this.forward = Vs.forward, this.inverse = Vs.inverse), this.x0 = this.x0 !== void 0 ? this.x0 : 0, this.y0 = this.y0 !== void 0 ? this.y0 : 0, this.long0 = this.long0 !== void 0 ? this.long0 : 0, this.lat0 = this.lat0 !== void 0 ? this.lat0 : 0, this.cgb = [], this.cbg = [], this.utg = [], this.gtu = [];
  var t = this.es / (1 + Math.sqrt(1 - this.es)), e = t / (2 - t), r = e;
  this.cgb[0] = e * (2 + e * (-2 / 3 + e * (-2 + e * (116 / 45 + e * (26 / 45 + e * (-2854 / 675)))))), this.cbg[0] = e * (-2 + e * (2 / 3 + e * (4 / 3 + e * (-82 / 45 + e * (32 / 45 + e * (4642 / 4725)))))), r = r * e, this.cgb[1] = r * (7 / 3 + e * (-8 / 5 + e * (-227 / 45 + e * (2704 / 315 + e * (2323 / 945))))), this.cbg[1] = r * (5 / 3 + e * (-16 / 15 + e * (-13 / 9 + e * (904 / 315 + e * (-1522 / 945))))), r = r * e, this.cgb[2] = r * (56 / 15 + e * (-136 / 35 + e * (-1262 / 105 + e * (73814 / 2835)))), this.cbg[2] = r * (-26 / 15 + e * (34 / 21 + e * (8 / 5 + e * (-12686 / 2835)))), r = r * e, this.cgb[3] = r * (4279 / 630 + e * (-332 / 35 + e * (-399572 / 14175))), this.cbg[3] = r * (1237 / 630 + e * (-12 / 5 + e * (-24832 / 14175))), r = r * e, this.cgb[4] = r * (4174 / 315 + e * (-144838 / 6237)), this.cbg[4] = r * (-734 / 315 + e * (109598 / 31185)), r = r * e, this.cgb[5] = r * (601676 / 22275), this.cbg[5] = r * (444337 / 155925), r = Math.pow(e, 2), this.Qn = this.k0 / (1 + e) * (1 + r * (1 / 4 + r * (1 / 64 + r / 256))), this.utg[0] = e * (-0.5 + e * (2 / 3 + e * (-37 / 96 + e * (1 / 360 + e * (81 / 512 + e * (-96199 / 604800)))))), this.gtu[0] = e * (0.5 + e * (-2 / 3 + e * (5 / 16 + e * (41 / 180 + e * (-127 / 288 + e * (7891 / 37800)))))), this.utg[1] = r * (-1 / 48 + e * (-1 / 15 + e * (437 / 1440 + e * (-46 / 105 + e * (1118711 / 3870720))))), this.gtu[1] = r * (13 / 48 + e * (-3 / 5 + e * (557 / 1440 + e * (281 / 630 + e * (-1983433 / 1935360))))), r = r * e, this.utg[2] = r * (-17 / 480 + e * (37 / 840 + e * (209 / 4480 + e * (-5569 / 90720)))), this.gtu[2] = r * (61 / 240 + e * (-103 / 140 + e * (15061 / 26880 + e * (167603 / 181440)))), r = r * e, this.utg[3] = r * (-4397 / 161280 + e * (11 / 504 + e * (830251 / 7257600))), this.gtu[3] = r * (49561 / 161280 + e * (-179 / 168 + e * (6601661 / 7257600))), r = r * e, this.utg[4] = r * (-4583 / 161280 + e * (108847 / 3991680)), this.gtu[4] = r * (34729 / 80640 + e * (-3418889 / 1995840)), r = r * e, this.utg[5] = r * (-20648693 / 638668800), this.gtu[5] = r * (212378941 / 319334400);
  var n = Fh(this.cbg, this.lat0);
  this.Zb = -this.Qn * (n + N2(this.gtu, 2 * n));
}
function D2(t) {
  var e = wt(t.x - this.long0, this.over), r = t.y;
  r = Fh(this.cbg, r);
  var n = Math.sin(r), i = Math.cos(r), s = Math.sin(e), a = Math.cos(e);
  r = Math.atan2(n, a * i), e = Math.atan2(s * i, Ae(n, i * a)), e = A2(Math.tan(e));
  var o = pp(this.gtu, 2 * r, 2 * e);
  r = r + o[0], e = e + o[1];
  var c, h;
  return Math.abs(e) <= 2.623395162778 ? (c = this.a * (this.Qn * e) + this.x0, h = this.a * (this.Qn * r + this.Zb) + this.y0) : (c = 1 / 0, h = 1 / 0), t.x = c, t.y = h, t;
}
function j2(t) {
  var e = (t.x - this.x0) * (1 / this.a), r = (t.y - this.y0) * (1 / this.a);
  r = (r - this.Zb) / this.Qn, e = e / this.Qn;
  var n, i;
  if (Math.abs(e) <= 2.623395162778) {
    var s = pp(this.utg, 2 * r, 2 * e);
    r = r + s[0], e = e + s[1], e = Math.atan(mp(e));
    var a = Math.sin(r), o = Math.cos(r), c = Math.sin(e), h = Math.cos(e);
    r = Math.atan2(a * h, Ae(c, h * o)), e = Math.atan2(c, h * o), n = wt(e + this.long0, this.over), i = Fh(this.cgb, r);
  } else
    n = 1 / 0, i = 1 / 0;
  return t.x = n, t.y = i, t;
}
var T2 = ["Extended_Transverse_Mercator", "Extended Transverse Mercator", "etmerc", "Transverse_Mercator", "Transverse Mercator", "Gauss Kruger", "Gauss_Kruger", "tmerc"];
const Hs = {
  init: R2,
  forward: D2,
  inverse: j2,
  names: T2
};
function C2(t, e) {
  if (t === void 0) {
    if (t = Math.floor((wt(e) + Math.PI) * 30 / Math.PI) + 1, t < 0)
      return 0;
    if (t > 60)
      return 60;
  }
  return t;
}
var L2 = "etmerc";
function F2() {
  var t = C2(this.zone, this.long0);
  if (t === void 0)
    throw new Error("unknown utm zone");
  this.lat0 = 0, this.long0 = (6 * Math.abs(t) - 183) * Yt, this.x0 = 5e5, this.y0 = this.utmSouth ? 1e7 : 0, this.k0 = 0.9996, Hs.init.apply(this), this.forward = Hs.forward, this.inverse = Hs.inverse;
}
var G2 = ["Universal Transverse Mercator System", "utm"];
const z2 = {
  init: F2,
  names: G2,
  dependsOn: L2
};
function Gh(t, e) {
  return Math.pow((1 - t) / (1 + t), e);
}
var q2 = 20;
function U2() {
  var t = Math.sin(this.lat0), e = Math.cos(this.lat0);
  e *= e, this.rc = Math.sqrt(1 - this.es) / (1 - this.es * t * t), this.C = Math.sqrt(1 + this.es * e * e / (1 - this.es)), this.phic0 = Math.asin(t / this.C), this.ratexp = 0.5 * this.C * this.e, this.K = Math.tan(0.5 * this.phic0 + zt) / (Math.pow(Math.tan(0.5 * this.lat0 + zt), this.C) * Gh(this.e * t, this.ratexp));
}
function B2(t) {
  var e = t.x, r = t.y;
  return t.y = 2 * Math.atan(this.K * Math.pow(Math.tan(0.5 * r + zt), this.C) * Gh(this.e * Math.sin(r), this.ratexp)) - st, t.x = this.C * e, t;
}
function Z2(t) {
  for (var e = 1e-14, r = t.x / this.C, n = t.y, i = Math.pow(Math.tan(0.5 * n + zt) / this.K, 1 / this.C), s = q2; s > 0 && (n = 2 * Math.atan(i * Gh(this.e * Math.sin(t.y), -0.5 * this.e)) - st, !(Math.abs(n - t.y) < e)); --s)
    t.y = n;
  return s ? (t.x = r, t.y = n, t) : null;
}
const zh = {
  init: U2,
  forward: B2,
  inverse: Z2
};
function V2() {
  zh.init.apply(this), this.rc && (this.sinc0 = Math.sin(this.phic0), this.cosc0 = Math.cos(this.phic0), this.R2 = 2 * this.rc, this.title || (this.title = "Oblique Stereographic Alternative"));
}
function H2(t) {
  var e, r, n, i;
  return t.x = wt(t.x - this.long0, this.over), zh.forward.apply(this, [t]), e = Math.sin(t.y), r = Math.cos(t.y), n = Math.cos(t.x), i = this.k0 * this.R2 / (1 + this.sinc0 * e + this.cosc0 * r * n), t.x = i * r * Math.sin(t.x), t.y = i * (this.cosc0 * e - this.sinc0 * r * n), t.x = this.a * t.x + this.x0, t.y = this.a * t.y + this.y0, t;
}
function K2(t) {
  var e, r, n, i, s;
  if (t.x = (t.x - this.x0) / this.a, t.y = (t.y - this.y0) / this.a, t.x /= this.k0, t.y /= this.k0, s = Ae(t.x, t.y)) {
    var a = 2 * Math.atan2(s, this.R2);
    e = Math.sin(a), r = Math.cos(a), i = Math.asin(r * this.sinc0 + t.y * e * this.cosc0 / s), n = Math.atan2(t.x * e, s * this.cosc0 * r - t.y * this.sinc0 * e);
  } else
    i = this.phic0, n = 0;
  return t.x = n, t.y = i, zh.inverse.apply(this, [t]), t.x = wt(t.x + this.long0, this.over), t;
}
var X2 = ["Stereographic_North_Pole", "Oblique_Stereographic", "sterea", "Oblique Stereographic Alternative", "Double_Stereographic"];
const W2 = {
  init: V2,
  forward: H2,
  inverse: K2,
  names: X2
};
function qh(t, e, r) {
  return e *= r, Math.tan(0.5 * (st + t)) * Math.pow((1 - e) / (1 + e), 0.5 * r);
}
function J2() {
  this.x0 = this.x0 || 0, this.y0 = this.y0 || 0, this.lat0 = this.lat0 || 0, this.long0 = this.long0 || 0, this.coslat0 = Math.cos(this.lat0), this.sinlat0 = Math.sin(this.lat0), this.sphere ? this.k0 === 1 && !isNaN(this.lat_ts) && Math.abs(this.coslat0) <= pt && (this.k0 = 0.5 * (1 + di(this.lat0) * Math.sin(this.lat_ts))) : (Math.abs(this.coslat0) <= pt && (this.lat0 > 0 ? this.con = 1 : this.con = -1), this.cons = Math.sqrt(Math.pow(1 + this.e, 1 + this.e) * Math.pow(1 - this.e, 1 - this.e)), this.k0 === 1 && !isNaN(this.lat_ts) && Math.abs(this.coslat0) <= pt && Math.abs(Math.cos(this.lat_ts)) > pt && (this.k0 = 0.5 * this.cons * lr(this.e, Math.sin(this.lat_ts), Math.cos(this.lat_ts)) / Je(this.e, this.con * this.lat_ts, this.con * Math.sin(this.lat_ts))), this.ms1 = lr(this.e, this.sinlat0, this.coslat0), this.X0 = 2 * Math.atan(qh(this.lat0, this.sinlat0, this.e)) - st, this.cosX0 = Math.cos(this.X0), this.sinX0 = Math.sin(this.X0));
}
function Y2(t) {
  var e = t.x, r = t.y, n = Math.sin(r), i = Math.cos(r), s, a, o, c, h, f, u = wt(e - this.long0, this.over);
  return Math.abs(Math.abs(e - this.long0) - Math.PI) <= pt && Math.abs(r + this.lat0) <= pt ? (t.x = NaN, t.y = NaN, t) : this.sphere ? (s = 2 * this.k0 / (1 + this.sinlat0 * n + this.coslat0 * i * Math.cos(u)), t.x = this.a * s * i * Math.sin(u) + this.x0, t.y = this.a * s * (this.coslat0 * n - this.sinlat0 * i * Math.cos(u)) + this.y0, t) : (a = 2 * Math.atan(qh(r, n, this.e)) - st, c = Math.cos(a), o = Math.sin(a), Math.abs(this.coslat0) <= pt ? (h = Je(this.e, r * this.con, this.con * n), f = 2 * this.a * this.k0 * h / this.cons, t.x = this.x0 + f * Math.sin(e - this.long0), t.y = this.y0 - this.con * f * Math.cos(e - this.long0), t) : (Math.abs(this.sinlat0) < pt ? (s = 2 * this.a * this.k0 / (1 + c * Math.cos(u)), t.y = s * o) : (s = 2 * this.a * this.k0 * this.ms1 / (this.cosX0 * (1 + this.sinX0 * o + this.cosX0 * c * Math.cos(u))), t.y = s * (this.cosX0 * o - this.sinX0 * c * Math.cos(u)) + this.y0), t.x = s * c * Math.sin(u) + this.x0, t));
}
function Q2(t) {
  t.x -= this.x0, t.y -= this.y0;
  var e, r, n, i, s, a = Math.sqrt(t.x * t.x + t.y * t.y);
  if (this.sphere) {
    var o = 2 * Math.atan(a / (2 * this.a * this.k0));
    return e = this.long0, r = this.lat0, a <= pt ? (t.x = e, t.y = r, t) : (r = Math.asin(Math.cos(o) * this.sinlat0 + t.y * Math.sin(o) * this.coslat0 / a), Math.abs(this.coslat0) < pt ? this.lat0 > 0 ? e = wt(this.long0 + Math.atan2(t.x, -1 * t.y), this.over) : e = wt(this.long0 + Math.atan2(t.x, t.y), this.over) : e = wt(this.long0 + Math.atan2(t.x * Math.sin(o), a * this.coslat0 * Math.cos(o) - t.y * this.sinlat0 * Math.sin(o)), this.over), t.x = e, t.y = r, t);
  } else if (Math.abs(this.coslat0) <= pt) {
    if (a <= pt)
      return r = this.lat0, e = this.long0, t.x = e, t.y = r, t;
    t.x *= this.con, t.y *= this.con, n = a * this.cons / (2 * this.a * this.k0), r = this.con * ni(this.e, n), e = this.con * wt(this.con * this.long0 + Math.atan2(t.x, -1 * t.y), this.over);
  } else
    i = 2 * Math.atan(a * this.cosX0 / (2 * this.a * this.k0 * this.ms1)), e = this.long0, a <= pt ? s = this.X0 : (s = Math.asin(Math.cos(i) * this.sinX0 + t.y * Math.sin(i) * this.cosX0 / a), e = wt(this.long0 + Math.atan2(t.x * Math.sin(i), a * this.cosX0 * Math.cos(i) - t.y * this.sinX0 * Math.sin(i)), this.over)), r = -1 * ni(this.e, Math.tan(0.5 * (st + s)));
  return t.x = e, t.y = r, t;
}
var tE = ["stere", "Stereographic_South_Pole", "Polar_Stereographic_variant_A", "Polar_Stereographic_variant_B", "Polar_Stereographic"];
const eE = {
  init: J2,
  forward: Y2,
  inverse: Q2,
  names: tE,
  ssfn_: qh
};
function rE() {
  var t = this.lat0;
  this.lambda0 = this.long0;
  var e = Math.sin(t), r = this.a, n = this.rf, i = 1 / n, s = 2 * i - Math.pow(i, 2), a = this.e = Math.sqrt(s);
  this.R = this.k0 * r * Math.sqrt(1 - s) / (1 - s * Math.pow(e, 2)), this.alpha = Math.sqrt(1 + s / (1 - s) * Math.pow(Math.cos(t), 4)), this.b0 = Math.asin(e / this.alpha);
  var o = Math.log(Math.tan(Math.PI / 4 + this.b0 / 2)), c = Math.log(Math.tan(Math.PI / 4 + t / 2)), h = Math.log((1 + a * e) / (1 - a * e));
  this.K = o - this.alpha * c + this.alpha * a / 2 * h;
}
function nE(t) {
  var e = Math.log(Math.tan(Math.PI / 4 - t.y / 2)), r = this.e / 2 * Math.log((1 + this.e * Math.sin(t.y)) / (1 - this.e * Math.sin(t.y))), n = -this.alpha * (e + r) + this.K, i = 2 * (Math.atan(Math.exp(n)) - Math.PI / 4), s = this.alpha * (t.x - this.lambda0), a = Math.atan(Math.sin(s) / (Math.sin(this.b0) * Math.tan(i) + Math.cos(this.b0) * Math.cos(s))), o = Math.asin(Math.cos(this.b0) * Math.sin(i) - Math.sin(this.b0) * Math.cos(i) * Math.cos(s));
  return t.y = this.R / 2 * Math.log((1 + Math.sin(o)) / (1 - Math.sin(o))) + this.y0, t.x = this.R * a + this.x0, t;
}
function iE(t) {
  for (var e = t.x - this.x0, r = t.y - this.y0, n = e / this.R, i = 2 * (Math.atan(Math.exp(r / this.R)) - Math.PI / 4), s = Math.asin(Math.cos(this.b0) * Math.sin(i) + Math.sin(this.b0) * Math.cos(i) * Math.cos(n)), a = Math.atan(Math.sin(n) / (Math.cos(this.b0) * Math.cos(n) - Math.sin(this.b0) * Math.tan(i))), o = this.lambda0 + a / this.alpha, c = 0, h = s, f = -1e3, u = 0; Math.abs(h - f) > 1e-7; ) {
    if (++u > 20)
      return;
    c = 1 / this.alpha * (Math.log(Math.tan(Math.PI / 4 + s / 2)) - this.K) + this.e * Math.log(Math.tan(Math.PI / 4 + Math.asin(this.e * Math.sin(h)) / 2)), f = h, h = 2 * Math.atan(Math.exp(c)) - Math.PI / 2;
  }
  return t.x = o, t.y = h, t;
}
var sE = ["somerc"];
const aE = {
  init: rE,
  forward: nE,
  inverse: iE,
  names: sE
};
var yn = 1e-7;
function oE(t) {
  var e = ["Hotine_Oblique_Mercator", "Hotine_Oblique_Mercator_variant_A", "Hotine_Oblique_Mercator_Azimuth_Natural_Origin"], r = typeof t.projName == "object" ? Object.keys(t.projName)[0] : t.projName;
  return "no_uoff" in t || "no_off" in t || e.indexOf(r) !== -1 || e.indexOf(np(r)) !== -1;
}
function cE() {
  var t, e, r, n, i, s, a, o, c, h, f = 0, u, l = 0, d = 0, g = 0, w = 0, m = 0, v = 0;
  this.no_off = oE(this), this.no_rot = "no_rot" in this;
  var p = !1;
  "alpha" in this && (p = !0);
  var E = !1;
  if ("rectified_grid_angle" in this && (E = !0), p && (v = this.alpha), E && (f = this.rectified_grid_angle), p || E)
    l = this.longc;
  else if (d = this.long1, w = this.lat1, g = this.long2, m = this.lat2, Math.abs(w - m) <= yn || (t = Math.abs(w)) <= yn || Math.abs(t - st) <= yn || Math.abs(Math.abs(this.lat0) - st) <= yn || Math.abs(Math.abs(m) - st) <= yn)
    throw new Error();
  var _ = 1 - this.es;
  e = Math.sqrt(_), Math.abs(this.lat0) > pt ? (o = Math.sin(this.lat0), r = Math.cos(this.lat0), t = 1 - this.es * o * o, this.B = r * r, this.B = Math.sqrt(1 + this.es * this.B * this.B / _), this.A = this.B * this.k0 * e / t, n = this.B * e / (r * Math.sqrt(t)), i = n * n - 1, i <= 0 ? i = 0 : (i = Math.sqrt(i), this.lat0 < 0 && (i = -i)), this.E = i += n, this.E *= Math.pow(Je(this.e, this.lat0, o), this.B)) : (this.B = 1 / e, this.A = this.k0, this.E = n = i = 1), p || E ? (p ? (u = Math.asin(Math.sin(v) / n), E || (f = v)) : (u = f, v = Math.asin(n * Math.sin(u))), this.lam0 = l - Math.asin(0.5 * (i - 1 / i) * Math.tan(u)) / this.B) : (s = Math.pow(Je(this.e, w, Math.sin(w)), this.B), a = Math.pow(Je(this.e, m, Math.sin(m)), this.B), i = this.E / s, c = (a - s) / (a + s), h = this.E * this.E, h = (h - a * s) / (h + a * s), t = d - g, t < -Math.PI ? g -= ei : t > Math.PI && (g += ei), this.lam0 = wt(0.5 * (d + g) - Math.atan(h * Math.tan(0.5 * this.B * (d - g)) / c) / this.B, this.over), u = Math.atan(2 * Math.sin(this.B * wt(d - this.lam0, this.over)) / (i - 1 / i)), f = v = Math.asin(n * Math.sin(u))), this.singam = Math.sin(u), this.cosgam = Math.cos(u), this.sinrot = Math.sin(f), this.cosrot = Math.cos(f), this.rB = 1 / this.B, this.ArB = this.A * this.rB, this.BrA = 1 / this.ArB, this.no_off ? this.u_0 = 0 : (this.u_0 = Math.abs(this.ArB * Math.atan(Math.sqrt(n * n - 1) / Math.cos(v))), this.lat0 < 0 && (this.u_0 = -this.u_0)), i = 0.5 * u, this.v_pole_n = this.ArB * Math.log(Math.tan(zt - i)), this.v_pole_s = this.ArB * Math.log(Math.tan(zt + i));
}
function hE(t) {
  var e = {}, r, n, i, s, a, o, c, h;
  if (t.x = t.x - this.lam0, Math.abs(Math.abs(t.y) - st) > pt) {
    if (a = this.E / Math.pow(Je(this.e, t.y, Math.sin(t.y)), this.B), o = 1 / a, r = 0.5 * (a - o), n = 0.5 * (a + o), s = Math.sin(this.B * t.x), i = (r * this.singam - s * this.cosgam) / n, Math.abs(Math.abs(i) - 1) < pt)
      throw new Error();
    h = 0.5 * this.ArB * Math.log((1 - i) / (1 + i)), o = Math.cos(this.B * t.x), Math.abs(o) < yn ? c = this.A * t.x : c = this.ArB * Math.atan2(r * this.cosgam + s * this.singam, o);
  } else
    h = t.y > 0 ? this.v_pole_n : this.v_pole_s, c = this.ArB * t.y;
  return this.no_rot ? (e.x = c, e.y = h) : (c -= this.u_0, e.x = h * this.cosrot + c * this.sinrot, e.y = c * this.cosrot - h * this.sinrot), e.x = this.a * e.x + this.x0, e.y = this.a * e.y + this.y0, e;
}
function lE(t) {
  var e, r, n, i, s, a, o, c = {};
  if (t.x = (t.x - this.x0) * (1 / this.a), t.y = (t.y - this.y0) * (1 / this.a), this.no_rot ? (r = t.y, e = t.x) : (r = t.x * this.cosrot - t.y * this.sinrot, e = t.y * this.cosrot + t.x * this.sinrot + this.u_0), n = Math.exp(-this.BrA * r), i = 0.5 * (n - 1 / n), s = 0.5 * (n + 1 / n), a = Math.sin(this.BrA * e), o = (a * this.cosgam + i * this.singam) / s, Math.abs(Math.abs(o) - 1) < pt)
    c.x = 0, c.y = o < 0 ? -st : st;
  else {
    if (c.y = this.E / Math.sqrt((1 + o) / (1 - o)), c.y = ni(this.e, Math.pow(c.y, 1 / this.B)), c.y === 1 / 0)
      throw new Error();
    c.x = -this.rB * Math.atan2(i * this.cosgam - a * this.singam, Math.cos(this.BrA * e));
  }
  return c.x += this.lam0, c;
}
var uE = ["Hotine_Oblique_Mercator", "Hotine Oblique Mercator", "Hotine_Oblique_Mercator_variant_A", "Hotine_Oblique_Mercator_Variant_B", "Hotine_Oblique_Mercator_Azimuth_Natural_Origin", "Hotine_Oblique_Mercator_Two_Point_Natural_Origin", "Hotine_Oblique_Mercator_Azimuth_Center", "Oblique_Mercator", "omerc"];
const fE = {
  init: cE,
  forward: hE,
  inverse: lE,
  names: uE
};
function dE() {
  if (this.lat2 || (this.lat2 = this.lat1), this.k0 || (this.k0 = 1), this.x0 = this.x0 || 0, this.y0 = this.y0 || 0, !(Math.abs(this.lat1 + this.lat2) < pt)) {
    var t = this.b / this.a;
    this.e = Math.sqrt(1 - t * t);
    var e = Math.sin(this.lat1), r = Math.cos(this.lat1), n = lr(this.e, e, r), i = Je(this.e, this.lat1, e), s = Math.sin(this.lat2), a = Math.cos(this.lat2), o = lr(this.e, s, a), c = Je(this.e, this.lat2, s), h = Math.abs(Math.abs(this.lat0) - st) < pt ? 0 : Je(this.e, this.lat0, Math.sin(this.lat0));
    Math.abs(this.lat1 - this.lat2) > pt ? this.ns = Math.log(n / o) / Math.log(i / c) : this.ns = e, isNaN(this.ns) && (this.ns = e), this.f0 = n / (this.ns * Math.pow(i, this.ns)), this.rh = this.a * this.f0 * Math.pow(h, this.ns), this.title || (this.title = "Lambert Conformal Conic");
  }
}
function mE(t) {
  var e = t.x, r = t.y;
  Math.abs(2 * Math.abs(r) - Math.PI) <= pt && (r = di(r) * (st - 2 * pt));
  var n = Math.abs(Math.abs(r) - st), i, s;
  if (n > pt)
    i = Je(this.e, r, Math.sin(r)), s = this.a * this.f0 * Math.pow(i, this.ns);
  else {
    if (n = r * this.ns, n <= 0)
      return null;
    s = 0;
  }
  var a = this.ns * wt(e - this.long0, this.over);
  return t.x = this.k0 * (s * Math.sin(a)) + this.x0, t.y = this.k0 * (this.rh - s * Math.cos(a)) + this.y0, t;
}
function pE(t) {
  var e, r, n, i, s, a = (t.x - this.x0) / this.k0, o = this.rh - (t.y - this.y0) / this.k0;
  this.ns > 0 ? (e = Math.sqrt(a * a + o * o), r = 1) : (e = -Math.sqrt(a * a + o * o), r = -1);
  var c = 0;
  if (e !== 0 && (c = Math.atan2(r * a, r * o)), e !== 0 || this.ns > 0) {
    if (r = 1 / this.ns, n = Math.pow(e / (this.a * this.f0), r), i = ni(this.e, n), i === -9999)
      return null;
  } else
    i = -st;
  return s = wt(c / this.ns + this.long0, this.over), t.x = s, t.y = i, t;
}
var yE = [
  "Lambert Tangential Conformal Conic Projection",
  "Lambert_Conformal_Conic",
  "Lambert_Conformal_Conic_1SP",
  "Lambert_Conformal_Conic_2SP",
  "lcc",
  "Lambert Conic Conformal (1SP)",
  "Lambert Conic Conformal (2SP)"
];
const gE = {
  init: dE,
  forward: mE,
  inverse: pE,
  names: yE
};
function wE() {
  this.a = 6377397155e-3, this.es = 0.006674372230614, this.e = Math.sqrt(this.es), this.lat0 || (this.lat0 = 0.863937979737193), this.long0 || (this.long0 = 0.7417649320975901 - 0.308341501185665), this.k0 || (this.k0 = 0.9999), this.s45 = 0.785398163397448, this.s90 = 2 * this.s45, this.fi0 = this.lat0, this.e2 = this.es, this.e = Math.sqrt(this.e2), this.alfa = Math.sqrt(1 + this.e2 * Math.pow(Math.cos(this.fi0), 4) / (1 - this.e2)), this.uq = 1.04216856380474, this.u0 = Math.asin(Math.sin(this.fi0) / this.alfa), this.g = Math.pow((1 + this.e * Math.sin(this.fi0)) / (1 - this.e * Math.sin(this.fi0)), this.alfa * this.e / 2), this.k = Math.tan(this.u0 / 2 + this.s45) / Math.pow(Math.tan(this.fi0 / 2 + this.s45), this.alfa) * this.g, this.k1 = this.k0, this.n0 = this.a * Math.sqrt(1 - this.e2) / (1 - this.e2 * Math.pow(Math.sin(this.fi0), 2)), this.s0 = 1.37008346281555, this.n = Math.sin(this.s0), this.ro0 = this.k1 * this.n0 / Math.tan(this.s0), this.ad = this.s90 - this.uq;
}
function _E(t) {
  var e, r, n, i, s, a, o, c = t.x, h = t.y, f = wt(c - this.long0, this.over);
  return e = Math.pow((1 + this.e * Math.sin(h)) / (1 - this.e * Math.sin(h)), this.alfa * this.e / 2), r = 2 * (Math.atan(this.k * Math.pow(Math.tan(h / 2 + this.s45), this.alfa) / e) - this.s45), n = -f * this.alfa, i = Math.asin(Math.cos(this.ad) * Math.sin(r) + Math.sin(this.ad) * Math.cos(r) * Math.cos(n)), s = Math.asin(Math.cos(r) * Math.sin(n) / Math.cos(i)), a = this.n * s, o = this.ro0 * Math.pow(Math.tan(this.s0 / 2 + this.s45), this.n) / Math.pow(Math.tan(i / 2 + this.s45), this.n), t.y = o * Math.cos(a) / 1, t.x = o * Math.sin(a) / 1, this.czech || (t.y *= -1, t.x *= -1), t;
}
function vE(t) {
  var e, r, n, i, s, a, o, c, h = t.x;
  t.x = t.y, t.y = h, this.czech || (t.y *= -1, t.x *= -1), a = Math.sqrt(t.x * t.x + t.y * t.y), s = Math.atan2(t.y, t.x), i = s / Math.sin(this.s0), n = 2 * (Math.atan(Math.pow(this.ro0 / a, 1 / this.n) * Math.tan(this.s0 / 2 + this.s45)) - this.s45), e = Math.asin(Math.cos(this.ad) * Math.sin(n) - Math.sin(this.ad) * Math.cos(n) * Math.cos(i)), r = Math.asin(Math.cos(n) * Math.sin(i) / Math.cos(e)), t.x = this.long0 - r / this.alfa, o = e, c = 0;
  var f = 0;
  do
    t.y = 2 * (Math.atan(Math.pow(this.k, -1 / this.alfa) * Math.pow(Math.tan(e / 2 + this.s45), 1 / this.alfa) * Math.pow((1 + this.e * Math.sin(o)) / (1 - this.e * Math.sin(o)), this.e / 2)) - this.s45), Math.abs(o - t.y) < 1e-10 && (c = 1), o = t.y, f += 1;
  while (c === 0 && f < 15);
  return f >= 15 ? null : t;
}
var EE = ["Krovak", "Krovak Modified", "Krovak (North Orientated)", "Krovak Modified (North Orientated)", "krovak"];
const bE = {
  init: wE,
  forward: _E,
  inverse: vE,
  names: EE
};
function Me(t, e, r, n, i) {
  return t * i - e * Math.sin(2 * i) + r * Math.sin(4 * i) - n * Math.sin(6 * i);
}
function mi(t) {
  return 1 - 0.25 * t * (1 + t / 16 * (3 + 1.25 * t));
}
function pi(t) {
  return 0.375 * t * (1 + 0.25 * t * (1 + 0.46875 * t));
}
function yi(t) {
  return 0.05859375 * t * t * (1 + 0.75 * t);
}
function gi(t) {
  return t * t * t * (35 / 3072);
}
function Uh(t, e, r) {
  var n = e * r;
  return t / Math.sqrt(1 - n * n);
}
function zr(t) {
  return Math.abs(t) < st ? t : t - di(t) * Math.PI;
}
function na(t, e, r, n, i) {
  var s, a;
  s = t / e;
  for (var o = 0; o < 15; o++)
    if (a = (t - (e * s - r * Math.sin(2 * s) + n * Math.sin(4 * s) - i * Math.sin(6 * s))) / (e - 2 * r * Math.cos(2 * s) + 4 * n * Math.cos(4 * s) - 6 * i * Math.cos(6 * s)), s += a, Math.abs(a) <= 1e-10)
      return s;
  return NaN;
}
function SE() {
  this.sphere || (this.e0 = mi(this.es), this.e1 = pi(this.es), this.e2 = yi(this.es), this.e3 = gi(this.es), this.ml0 = this.a * Me(this.e0, this.e1, this.e2, this.e3, this.lat0));
}
function ME(t) {
  var e, r, n = t.x, i = t.y;
  if (n = wt(n - this.long0, this.over), this.sphere)
    e = this.a * Math.asin(Math.cos(i) * Math.sin(n)), r = this.a * (Math.atan2(Math.tan(i), Math.cos(n)) - this.lat0);
  else {
    var s = Math.sin(i), a = Math.cos(i), o = Uh(this.a, this.e, s), c = Math.tan(i) * Math.tan(i), h = n * Math.cos(i), f = h * h, u = this.es * a * a / (1 - this.es), l = this.a * Me(this.e0, this.e1, this.e2, this.e3, i);
    e = o * h * (1 - f * c * (1 / 6 - (8 - c + 8 * u) * f / 120)), r = l - this.ml0 + o * s / a * f * (0.5 + (5 - c + 6 * u) * f / 24);
  }
  return t.x = e + this.x0, t.y = r + this.y0, t;
}
function xE(t) {
  t.x -= this.x0, t.y -= this.y0;
  var e = t.x / this.a, r = t.y / this.a, n, i;
  if (this.sphere) {
    var s = r + this.lat0;
    n = Math.asin(Math.sin(s) * Math.cos(e)), i = Math.atan2(Math.tan(e), Math.cos(s));
  } else {
    var a = this.ml0 / this.a + r, o = na(a, this.e0, this.e1, this.e2, this.e3);
    if (Math.abs(Math.abs(o) - st) <= pt)
      return t.x = this.long0, t.y = st, r < 0 && (t.y *= -1), t;
    var c = Uh(this.a, this.e, Math.sin(o)), h = c * c * c / this.a / this.a * (1 - this.es), f = Math.pow(Math.tan(o), 2), u = e * this.a / c, l = u * u;
    n = o - c * Math.tan(o) / h * u * u * (0.5 - (1 + 3 * f) * u * u / 24), i = u * (1 - l * (f / 3 + (1 + 3 * f) * f * l / 15)) / Math.cos(o);
  }
  return t.x = wt(i + this.long0, this.over), t.y = zr(n), t;
}
var kE = ["Cassini", "Cassini_Soldner", "cass"];
const $E = {
  init: SE,
  forward: ME,
  inverse: xE,
  names: kE
};
function Tr(t, e) {
  var r;
  return t > 1e-7 ? (r = t * e, (1 - t * t) * (e / (1 - r * r) - 0.5 / t * Math.log((1 - r) / (1 + r)))) : 2 * e;
}
var oh = 1, ch = 2, hh = 3, Ks = 4;
function IE() {
  var t = Math.abs(this.lat0);
  if (Math.abs(t - st) < pt ? this.mode = this.lat0 < 0 ? oh : ch : Math.abs(t) < pt ? this.mode = hh : this.mode = Ks, this.es > 0) {
    var e;
    switch (this.qp = Tr(this.e, 1), this.mmf = 0.5 / (1 - this.es), this.apa = CE(this.es), this.mode) {
      case ch:
        this.dd = 1;
        break;
      case oh:
        this.dd = 1;
        break;
      case hh:
        this.rq = Math.sqrt(0.5 * this.qp), this.dd = 1 / this.rq, this.xmf = 1, this.ymf = 0.5 * this.qp;
        break;
      case Ks:
        this.rq = Math.sqrt(0.5 * this.qp), e = Math.sin(this.lat0), this.sinb1 = Tr(this.e, e) / this.qp, this.cosb1 = Math.sqrt(1 - this.sinb1 * this.sinb1), this.dd = Math.cos(this.lat0) / (Math.sqrt(1 - this.es * e * e) * this.rq * this.cosb1), this.ymf = (this.xmf = this.rq) / this.dd, this.xmf *= this.dd;
        break;
    }
  } else
    this.mode === Ks && (this.sinph0 = Math.sin(this.lat0), this.cosph0 = Math.cos(this.lat0));
}
function PE(t) {
  var e, r, n, i, s, a, o, c, h, f, u = t.x, l = t.y;
  if (u = wt(u - this.long0, this.over), this.sphere) {
    if (s = Math.sin(l), f = Math.cos(l), n = Math.cos(u), this.mode === this.OBLIQ || this.mode === this.EQUIT) {
      if (r = this.mode === this.EQUIT ? 1 + f * n : 1 + this.sinph0 * s + this.cosph0 * f * n, r <= pt)
        return null;
      r = Math.sqrt(2 / r), e = r * f * Math.sin(u), r *= this.mode === this.EQUIT ? s : this.cosph0 * s - this.sinph0 * f * n;
    } else if (this.mode === this.N_POLE || this.mode === this.S_POLE) {
      if (this.mode === this.N_POLE && (n = -n), Math.abs(l + this.lat0) < pt)
        return null;
      r = zt - l * 0.5, r = 2 * (this.mode === this.S_POLE ? Math.cos(r) : Math.sin(r)), e = r * Math.sin(u), r *= n;
    }
  } else {
    switch (o = 0, c = 0, h = 0, n = Math.cos(u), i = Math.sin(u), s = Math.sin(l), a = Tr(this.e, s), (this.mode === this.OBLIQ || this.mode === this.EQUIT) && (o = a / this.qp, c = Math.sqrt(1 - o * o)), this.mode) {
      case this.OBLIQ:
        h = 1 + this.sinb1 * o + this.cosb1 * c * n;
        break;
      case this.EQUIT:
        h = 1 + c * n;
        break;
      case this.N_POLE:
        h = st + l, a = this.qp - a;
        break;
      case this.S_POLE:
        h = l - st, a = this.qp + a;
        break;
    }
    if (Math.abs(h) < pt)
      return null;
    switch (this.mode) {
      case this.OBLIQ:
      case this.EQUIT:
        h = Math.sqrt(2 / h), this.mode === this.OBLIQ ? r = this.ymf * h * (this.cosb1 * o - this.sinb1 * c * n) : r = (h = Math.sqrt(2 / (1 + c * n))) * o * this.ymf, e = this.xmf * h * c * i;
        break;
      case this.N_POLE:
      case this.S_POLE:
        a >= 0 ? (e = (h = Math.sqrt(a)) * i, r = n * (this.mode === this.S_POLE ? h : -h)) : e = r = 0;
        break;
    }
  }
  return t.x = this.a * e + this.x0, t.y = this.a * r + this.y0, t;
}
function AE(t) {
  t.x -= this.x0, t.y -= this.y0;
  var e = t.x / this.a, r = t.y / this.a, n, i, s, a, o, c, h;
  if (this.sphere) {
    var f = 0, u, l = 0;
    if (u = Math.sqrt(e * e + r * r), i = u * 0.5, i > 1)
      return null;
    switch (i = 2 * Math.asin(i), (this.mode === this.OBLIQ || this.mode === this.EQUIT) && (l = Math.sin(i), f = Math.cos(i)), this.mode) {
      case this.EQUIT:
        i = Math.abs(u) <= pt ? 0 : Math.asin(r * l / u), e *= l, r = f * u;
        break;
      case this.OBLIQ:
        i = Math.abs(u) <= pt ? this.lat0 : Math.asin(f * this.sinph0 + r * l * this.cosph0 / u), e *= l * this.cosph0, r = (f - Math.sin(i) * this.sinph0) * u;
        break;
      case this.N_POLE:
        r = -r, i = st - i;
        break;
      case this.S_POLE:
        i -= st;
        break;
    }
    n = r === 0 && (this.mode === this.EQUIT || this.mode === this.OBLIQ) ? 0 : Math.atan2(e, r);
  } else {
    if (h = 0, this.mode === this.OBLIQ || this.mode === this.EQUIT) {
      if (e /= this.dd, r *= this.dd, c = Math.sqrt(e * e + r * r), c < pt)
        return t.x = this.long0, t.y = this.lat0, t;
      a = 2 * Math.asin(0.5 * c / this.rq), s = Math.cos(a), e *= a = Math.sin(a), this.mode === this.OBLIQ ? (h = s * this.sinb1 + r * a * this.cosb1 / c, o = this.qp * h, r = c * this.cosb1 * s - r * this.sinb1 * a) : (h = r * a / c, o = this.qp * h, r = c * s);
    } else if (this.mode === this.N_POLE || this.mode === this.S_POLE) {
      if (this.mode === this.N_POLE && (r = -r), o = e * e + r * r, !o)
        return t.x = this.long0, t.y = this.lat0, t;
      h = 1 - o / this.qp, this.mode === this.S_POLE && (h = -h);
    }
    n = Math.atan2(e, r), i = LE(Math.asin(h), this.apa);
  }
  return t.x = wt(this.long0 + n, this.over), t.y = i, t;
}
var NE = 0.3333333333333333, OE = 0.17222222222222222, RE = 0.10257936507936508, DE = 0.06388888888888888, jE = 0.0664021164021164, TE = 0.016415012942191543;
function CE(t) {
  var e, r = [];
  return r[0] = t * NE, e = t * t, r[0] += e * OE, r[1] = e * DE, e *= t, r[0] += e * RE, r[1] += e * jE, r[2] = e * TE, r;
}
function LE(t, e) {
  var r = t + t;
  return t + e[0] * Math.sin(r) + e[1] * Math.sin(r + r) + e[2] * Math.sin(r + r + r);
}
var FE = ["Lambert Azimuthal Equal Area", "Lambert_Azimuthal_Equal_Area", "laea"];
const GE = {
  init: IE,
  forward: PE,
  inverse: AE,
  names: FE,
  S_POLE: oh,
  N_POLE: ch,
  EQUIT: hh,
  OBLIQ: Ks
};
function Fr(t) {
  return Math.abs(t) > 1 && (t = t > 1 ? 1 : -1), Math.asin(t);
}
function zE() {
  Math.abs(this.lat1 + this.lat2) < pt || (this.temp = this.b / this.a, this.es = 1 - Math.pow(this.temp, 2), this.e3 = Math.sqrt(this.es), this.sin_po = Math.sin(this.lat1), this.cos_po = Math.cos(this.lat1), this.t1 = this.sin_po, this.con = this.sin_po, this.ms1 = lr(this.e3, this.sin_po, this.cos_po), this.qs1 = Tr(this.e3, this.sin_po), this.sin_po = Math.sin(this.lat2), this.cos_po = Math.cos(this.lat2), this.t2 = this.sin_po, this.ms2 = lr(this.e3, this.sin_po, this.cos_po), this.qs2 = Tr(this.e3, this.sin_po), this.sin_po = Math.sin(this.lat0), this.cos_po = Math.cos(this.lat0), this.t3 = this.sin_po, this.qs0 = Tr(this.e3, this.sin_po), Math.abs(this.lat1 - this.lat2) > pt ? this.ns0 = (this.ms1 * this.ms1 - this.ms2 * this.ms2) / (this.qs2 - this.qs1) : this.ns0 = this.con, this.c = this.ms1 * this.ms1 + this.ns0 * this.qs1, this.rh = this.a * Math.sqrt(this.c - this.ns0 * this.qs0) / this.ns0);
}
function qE(t) {
  var e = t.x, r = t.y;
  this.sin_phi = Math.sin(r), this.cos_phi = Math.cos(r);
  var n = Tr(this.e3, this.sin_phi), i = this.a * Math.sqrt(this.c - this.ns0 * n) / this.ns0, s = this.ns0 * wt(e - this.long0, this.over), a = i * Math.sin(s) + this.x0, o = this.rh - i * Math.cos(s) + this.y0;
  return t.x = a, t.y = o, t;
}
function UE(t) {
  var e, r, n, i, s, a;
  return t.x -= this.x0, t.y = this.rh - t.y + this.y0, this.ns0 >= 0 ? (e = Math.sqrt(t.x * t.x + t.y * t.y), n = 1) : (e = -Math.sqrt(t.x * t.x + t.y * t.y), n = -1), i = 0, e !== 0 && (i = Math.atan2(n * t.x, n * t.y)), n = e * this.ns0 / this.a, this.sphere ? a = Math.asin((this.c - n * n) / (2 * this.ns0)) : (r = (this.c - n * n) / this.ns0, a = this.phi1z(this.e3, r)), s = wt(i / this.ns0 + this.long0, this.over), t.x = s, t.y = a, t;
}
function BE(t, e) {
  var r, n, i, s, a, o = Fr(0.5 * e);
  if (t < pt)
    return o;
  for (var c = t * t, h = 1; h <= 25; h++)
    if (r = Math.sin(o), n = Math.cos(o), i = t * r, s = 1 - i * i, a = 0.5 * s * s / n * (e / (1 - c) - r / s + 0.5 / t * Math.log((1 - i) / (1 + i))), o = o + a, Math.abs(a) <= 1e-7)
      return o;
  return null;
}
var ZE = ["Albers_Conic_Equal_Area", "Albers_Equal_Area", "Albers", "aea"];
const VE = {
  init: zE,
  forward: qE,
  inverse: UE,
  names: ZE,
  phi1z: BE
};
function HE() {
  this.sin_p14 = Math.sin(this.lat0), this.cos_p14 = Math.cos(this.lat0), this.infinity_dist = 1e3 * this.a, this.rc = 1;
}
function KE(t) {
  var e, r, n, i, s, a, o, c, h = t.x, f = t.y;
  return n = wt(h - this.long0, this.over), e = Math.sin(f), r = Math.cos(f), i = Math.cos(n), a = this.sin_p14 * e + this.cos_p14 * r * i, s = 1, a > 0 || Math.abs(a) <= pt ? (o = this.x0 + this.a * s * r * Math.sin(n) / a, c = this.y0 + this.a * s * (this.cos_p14 * e - this.sin_p14 * r * i) / a) : (o = this.x0 + this.infinity_dist * r * Math.sin(n), c = this.y0 + this.infinity_dist * (this.cos_p14 * e - this.sin_p14 * r * i)), t.x = o, t.y = c, t;
}
function XE(t) {
  var e, r, n, i, s, a;
  return t.x = (t.x - this.x0) / this.a, t.y = (t.y - this.y0) / this.a, t.x /= this.k0, t.y /= this.k0, (e = Math.sqrt(t.x * t.x + t.y * t.y)) ? (i = Math.atan2(e, this.rc), r = Math.sin(i), n = Math.cos(i), a = Fr(n * this.sin_p14 + t.y * r * this.cos_p14 / e), s = Math.atan2(t.x * r, e * this.cos_p14 * n - t.y * this.sin_p14 * r), s = wt(this.long0 + s, this.over)) : (a = this.phic0, s = 0), t.x = s, t.y = a, t;
}
var WE = ["gnom"];
const JE = {
  init: HE,
  forward: KE,
  inverse: XE,
  names: WE
};
function YE(t, e) {
  var r = 1 - (1 - t * t) / (2 * t) * Math.log((1 - t) / (1 + t));
  if (Math.abs(Math.abs(e) - r) < 1e-6)
    return e < 0 ? -1 * st : st;
  for (var n = Math.asin(0.5 * e), i, s, a, o, c = 0; c < 30; c++)
    if (s = Math.sin(n), a = Math.cos(n), o = t * s, i = Math.pow(1 - o * o, 2) / (2 * a) * (e / (1 - t * t) - s / (1 - o * o) + 0.5 / t * Math.log((1 - o) / (1 + o))), n += i, Math.abs(i) <= 1e-10)
      return n;
  return NaN;
}
function QE() {
  this.sphere || (this.k0 = lr(this.e, Math.sin(this.lat_ts), Math.cos(this.lat_ts)));
}
function t4(t) {
  var e = t.x, r = t.y, n, i, s = wt(e - this.long0, this.over);
  if (this.sphere)
    n = this.x0 + this.a * s * Math.cos(this.lat_ts), i = this.y0 + this.a * Math.sin(r) / Math.cos(this.lat_ts);
  else {
    var a = Tr(this.e, Math.sin(r));
    n = this.x0 + this.a * this.k0 * s, i = this.y0 + this.a * a * 0.5 / this.k0;
  }
  return t.x = n, t.y = i, t;
}
function e4(t) {
  t.x -= this.x0, t.y -= this.y0;
  var e, r;
  return this.sphere ? (e = wt(this.long0 + t.x / this.a / Math.cos(this.lat_ts), this.over), r = Math.asin(t.y / this.a * Math.cos(this.lat_ts))) : (r = YE(this.e, 2 * t.y * this.k0 / this.a), e = wt(this.long0 + t.x / (this.a * this.k0), this.over)), t.x = e, t.y = r, t;
}
var r4 = ["cea"];
const n4 = {
  init: QE,
  forward: t4,
  inverse: e4,
  names: r4
};
function i4() {
  this.x0 = this.x0 || 0, this.y0 = this.y0 || 0, this.lat0 = this.lat0 || 0, this.long0 = this.long0 || 0, this.lat_ts = this.lat_ts || 0, this.title = this.title || "Equidistant Cylindrical (Plate Carre)", this.rc = Math.cos(this.lat_ts);
}
function s4(t) {
  var e = t.x, r = t.y, n = wt(e - this.long0, this.over), i = zr(r - this.lat0);
  return t.x = this.x0 + this.a * n * this.rc, t.y = this.y0 + this.a * i, t;
}
function a4(t) {
  var e = t.x, r = t.y;
  return t.x = wt(this.long0 + (e - this.x0) / (this.a * this.rc), this.over), t.y = zr(this.lat0 + (r - this.y0) / this.a), t;
}
var o4 = ["Equirectangular", "Equidistant_Cylindrical", "Equidistant_Cylindrical_Spherical", "eqc"];
const c4 = {
  init: i4,
  forward: s4,
  inverse: a4,
  names: o4
};
var y0 = 20;
function h4() {
  this.temp = this.b / this.a, this.es = 1 - Math.pow(this.temp, 2), this.e = Math.sqrt(this.es), this.e0 = mi(this.es), this.e1 = pi(this.es), this.e2 = yi(this.es), this.e3 = gi(this.es), this.ml0 = this.a * Me(this.e0, this.e1, this.e2, this.e3, this.lat0);
}
function l4(t) {
  var e = t.x, r = t.y, n, i, s, a = wt(e - this.long0, this.over);
  if (s = a * Math.sin(r), this.sphere)
    Math.abs(r) <= pt ? (n = this.a * a, i = -1 * this.a * this.lat0) : (n = this.a * Math.sin(s) / Math.tan(r), i = this.a * (zr(r - this.lat0) + (1 - Math.cos(s)) / Math.tan(r)));
  else if (Math.abs(r) <= pt)
    n = this.a * a, i = -1 * this.ml0;
  else {
    var o = Uh(this.a, this.e, Math.sin(r)) / Math.tan(r);
    n = o * Math.sin(s), i = this.a * Me(this.e0, this.e1, this.e2, this.e3, r) - this.ml0 + o * (1 - Math.cos(s));
  }
  return t.x = n + this.x0, t.y = i + this.y0, t;
}
function u4(t) {
  var e, r, n, i, s, a, o, c, h;
  if (n = t.x - this.x0, i = t.y - this.y0, this.sphere)
    if (Math.abs(i + this.a * this.lat0) <= pt)
      e = wt(n / this.a + this.long0, this.over), r = 0;
    else {
      a = this.lat0 + i / this.a, o = n * n / this.a / this.a + a * a, c = a;
      var f;
      for (s = y0; s; --s)
        if (f = Math.tan(c), h = -1 * (a * (c * f + 1) - c - 0.5 * (c * c + o) * f) / ((c - a) / f - 1), c += h, Math.abs(h) <= pt) {
          r = c;
          break;
        }
      e = wt(this.long0 + Math.asin(n * Math.tan(c) / this.a) / Math.sin(r), this.over);
    }
  else if (Math.abs(i + this.ml0) <= pt)
    r = 0, e = wt(this.long0 + n / this.a, this.over);
  else {
    a = (this.ml0 + i) / this.a, o = n * n / this.a / this.a + a * a, c = a;
    var u, l, d, g, w;
    for (s = y0; s; --s)
      if (w = this.e * Math.sin(c), u = Math.sqrt(1 - w * w) * Math.tan(c), l = this.a * Me(this.e0, this.e1, this.e2, this.e3, c), d = this.e0 - 2 * this.e1 * Math.cos(2 * c) + 4 * this.e2 * Math.cos(4 * c) - 6 * this.e3 * Math.cos(6 * c), g = l / this.a, h = (a * (u * g + 1) - g - 0.5 * u * (g * g + o)) / (this.es * Math.sin(2 * c) * (g * g + o - 2 * a * g) / (4 * u) + (a - g) * (u * d - 2 / Math.sin(2 * c)) - d), c -= h, Math.abs(h) <= pt) {
        r = c;
        break;
      }
    u = Math.sqrt(1 - this.es * Math.pow(Math.sin(r), 2)) * Math.tan(r), e = wt(this.long0 + Math.asin(n * u / this.a) / Math.sin(r), this.over);
  }
  return t.x = e, t.y = r, t;
}
var f4 = ["Polyconic", "American_Polyconic", "poly"];
const d4 = {
  init: h4,
  forward: l4,
  inverse: u4,
  names: f4
};
function m4() {
  this.A = [], this.A[1] = 0.6399175073, this.A[2] = -0.1358797613, this.A[3] = 0.063294409, this.A[4] = -0.02526853, this.A[5] = 0.0117879, this.A[6] = -55161e-7, this.A[7] = 26906e-7, this.A[8] = -1333e-6, this.A[9] = 67e-5, this.A[10] = -34e-5, this.B_re = [], this.B_im = [], this.B_re[1] = 0.7557853228, this.B_im[1] = 0, this.B_re[2] = 0.249204646, this.B_im[2] = 3371507e-9, this.B_re[3] = -1541739e-9, this.B_im[3] = 0.04105856, this.B_re[4] = -0.10162907, this.B_im[4] = 0.01727609, this.B_re[5] = -0.26623489, this.B_im[5] = -0.36249218, this.B_re[6] = -0.6870983, this.B_im[6] = -1.1651967, this.C_re = [], this.C_im = [], this.C_re[1] = 1.3231270439, this.C_im[1] = 0, this.C_re[2] = -0.577245789, this.C_im[2] = -7809598e-9, this.C_re[3] = 0.508307513, this.C_im[3] = -0.112208952, this.C_re[4] = -0.15094762, this.C_im[4] = 0.18200602, this.C_re[5] = 1.01418179, this.C_im[5] = 1.64497696, this.C_re[6] = 1.9660549, this.C_im[6] = 2.5127645, this.D = [], this.D[1] = 1.5627014243, this.D[2] = 0.5185406398, this.D[3] = -0.03333098, this.D[4] = -0.1052906, this.D[5] = -0.0368594, this.D[6] = 7317e-6, this.D[7] = 0.0122, this.D[8] = 394e-5, this.D[9] = -13e-4;
}
function p4(t) {
  var e, r = t.x, n = t.y, i = n - this.lat0, s = r - this.long0, a = i / Wn * 1e-5, o = s, c = 1, h = 0;
  for (e = 1; e <= 10; e++)
    c = c * a, h = h + this.A[e] * c;
  var f = h, u = o, l = 1, d = 0, g, w, m = 0, v = 0;
  for (e = 1; e <= 6; e++)
    g = l * f - d * u, w = d * f + l * u, l = g, d = w, m = m + this.B_re[e] * l - this.B_im[e] * d, v = v + this.B_im[e] * l + this.B_re[e] * d;
  return t.x = v * this.a + this.x0, t.y = m * this.a + this.y0, t;
}
function y4(t) {
  var e, r = t.x, n = t.y, i = r - this.x0, s = n - this.y0, a = s / this.a, o = i / this.a, c = 1, h = 0, f, u, l = 0, d = 0;
  for (e = 1; e <= 6; e++)
    f = c * a - h * o, u = h * a + c * o, c = f, h = u, l = l + this.C_re[e] * c - this.C_im[e] * h, d = d + this.C_im[e] * c + this.C_re[e] * h;
  for (var g = 0; g < this.iterations; g++) {
    var w = l, m = d, v, p, E = a, _ = o;
    for (e = 2; e <= 6; e++)
      v = w * l - m * d, p = m * l + w * d, w = v, m = p, E = E + (e - 1) * (this.B_re[e] * w - this.B_im[e] * m), _ = _ + (e - 1) * (this.B_im[e] * w + this.B_re[e] * m);
    w = 1, m = 0;
    var y = this.B_re[1], b = this.B_im[1];
    for (e = 2; e <= 6; e++)
      v = w * l - m * d, p = m * l + w * d, w = v, m = p, y = y + e * (this.B_re[e] * w - this.B_im[e] * m), b = b + e * (this.B_im[e] * w + this.B_re[e] * m);
    var S = y * y + b * b;
    l = (E * y + _ * b) / S, d = (_ * y - E * b) / S;
  }
  var x = l, M = d, k = 1, $ = 0;
  for (e = 1; e <= 9; e++)
    k = k * x, $ = $ + this.D[e] * k;
  var O = this.lat0 + $ * Wn * 1e5, T = this.long0 + M;
  return t.x = T, t.y = O, t;
}
var g4 = ["New_Zealand_Map_Grid", "nzmg"];
const w4 = {
  init: m4,
  forward: p4,
  inverse: y4,
  names: g4
};
function _4() {
}
function v4(t) {
  var e = t.x, r = t.y, n = wt(e - this.long0, this.over), i = this.x0 + this.a * n, s = this.y0 + this.a * Math.log(Math.tan(Math.PI / 4 + r / 2.5)) * 1.25;
  return t.x = i, t.y = s, t;
}
function E4(t) {
  t.x -= this.x0, t.y -= this.y0;
  var e = wt(this.long0 + t.x / this.a, this.over), r = 2.5 * (Math.atan(Math.exp(0.8 * t.y / this.a)) - Math.PI / 4);
  return t.x = e, t.y = r, t;
}
var b4 = ["Miller_Cylindrical", "mill"];
const S4 = {
  init: _4,
  forward: v4,
  inverse: E4,
  names: b4
};
var M4 = 20;
function x4() {
  this.sphere ? (this.n = 1, this.m = 0, this.es = 0, this.C_y = Math.sqrt((this.m + 1) / this.n), this.C_x = this.C_y / (this.m + 1)) : this.en = Ch(this.es);
}
function k4(t) {
  var e, r, n = t.x, i = t.y;
  if (n = wt(n - this.long0, this.over), this.sphere) {
    if (!this.m)
      i = this.n !== 1 ? Math.asin(this.n * Math.sin(i)) : i;
    else
      for (var s = this.n * Math.sin(i), a = M4; a; --a) {
        var o = (this.m * i + Math.sin(i) - s) / (this.m + Math.cos(i));
        if (i -= o, Math.abs(o) < pt)
          break;
      }
    e = this.a * this.C_x * n * (this.m + Math.cos(i)), r = this.a * this.C_y * i;
  } else {
    var c = Math.sin(i), h = Math.cos(i);
    r = this.a * Rn(i, c, h, this.en), e = this.a * n * h / Math.sqrt(1 - this.es * c * c);
  }
  return t.x = e, t.y = r, t;
}
function $4(t) {
  var e, r, n, i;
  return t.x -= this.x0, n = t.x / this.a, t.y -= this.y0, e = t.y / this.a, this.sphere ? (e /= this.C_y, n = n / (this.C_x * (this.m + Math.cos(e))), this.m ? e = Fr((this.m * e + Math.sin(e)) / this.n) : this.n !== 1 && (e = Fr(Math.sin(e) / this.n)), n = wt(n + this.long0, this.over), e = zr(e)) : (e = Lh(t.y / this.a, this.es, this.en), i = Math.abs(e), i < st ? (i = Math.sin(e), r = this.long0 + t.x * Math.sqrt(1 - this.es * i * i) / (this.a * Math.cos(e)), n = wt(r, this.over)) : i - pt < st && (n = this.long0)), t.x = n, t.y = e, t;
}
var I4 = ["Sinusoidal", "sinu"];
const P4 = {
  init: x4,
  forward: k4,
  inverse: $4,
  names: I4
};
function A4() {
  this.x0 = this.x0 !== void 0 ? this.x0 : 0, this.y0 = this.y0 !== void 0 ? this.y0 : 0, this.long0 = this.long0 !== void 0 ? this.long0 : 0;
}
function N4(t) {
  for (var e = t.x, r = t.y, n = wt(e - this.long0, this.over), i = r, s = Math.PI * Math.sin(r); ; ) {
    var a = -(i + Math.sin(i) - s) / (1 + Math.cos(i));
    if (i += a, Math.abs(a) < pt)
      break;
  }
  i /= 2, Math.PI / 2 - Math.abs(r) < pt && (n = 0);
  var o = 0.900316316158 * this.a * n * Math.cos(i) + this.x0, c = 1.4142135623731 * this.a * Math.sin(i) + this.y0;
  return t.x = o, t.y = c, t;
}
function O4(t) {
  var e, r;
  t.x -= this.x0, t.y -= this.y0, r = t.y / (1.4142135623731 * this.a), Math.abs(r) > 0.999999999999 && (r = 0.999999999999), e = Math.asin(r);
  var n = wt(this.long0 + t.x / (0.900316316158 * this.a * Math.cos(e)), this.over);
  n < -Math.PI && (n = -Math.PI), n > Math.PI && (n = Math.PI), r = (2 * e + Math.sin(2 * e)) / Math.PI, Math.abs(r) > 1 && (r = 1);
  var i = Math.asin(r);
  return t.x = n, t.y = i, t;
}
var R4 = ["Mollweide", "moll"];
const D4 = {
  init: A4,
  forward: N4,
  inverse: O4,
  names: R4
};
function j4() {
  Math.abs(this.lat1 + this.lat2) < pt || (this.lat2 = this.lat2 || this.lat1, this.temp = this.b / this.a, this.es = 1 - Math.pow(this.temp, 2), this.e = Math.sqrt(this.es), this.e0 = mi(this.es), this.e1 = pi(this.es), this.e2 = yi(this.es), this.e3 = gi(this.es), this.sin_phi = Math.sin(this.lat1), this.cos_phi = Math.cos(this.lat1), this.ms1 = lr(this.e, this.sin_phi, this.cos_phi), this.ml1 = Me(this.e0, this.e1, this.e2, this.e3, this.lat1), Math.abs(this.lat1 - this.lat2) < pt ? this.ns = this.sin_phi : (this.sin_phi = Math.sin(this.lat2), this.cos_phi = Math.cos(this.lat2), this.ms2 = lr(this.e, this.sin_phi, this.cos_phi), this.ml2 = Me(this.e0, this.e1, this.e2, this.e3, this.lat2), this.ns = (this.ms1 - this.ms2) / (this.ml2 - this.ml1)), this.g = this.ml1 + this.ms1 / this.ns, this.ml0 = Me(this.e0, this.e1, this.e2, this.e3, this.lat0), this.rh = this.a * (this.g - this.ml0));
}
function T4(t) {
  var e = t.x, r = t.y, n;
  if (this.sphere)
    n = this.a * (this.g - r);
  else {
    var i = Me(this.e0, this.e1, this.e2, this.e3, r);
    n = this.a * (this.g - i);
  }
  var s = this.ns * wt(e - this.long0, this.over), a = this.x0 + n * Math.sin(s), o = this.y0 + this.rh - n * Math.cos(s);
  return t.x = a, t.y = o, t;
}
function C4(t) {
  t.x -= this.x0, t.y = this.rh - t.y + this.y0;
  var e, r, n, i;
  this.ns >= 0 ? (r = Math.sqrt(t.x * t.x + t.y * t.y), e = 1) : (r = -Math.sqrt(t.x * t.x + t.y * t.y), e = -1);
  var s = 0;
  if (r !== 0 && (s = Math.atan2(e * t.x, e * t.y)), this.sphere)
    return i = wt(this.long0 + s / this.ns, this.over), n = zr(this.g - r / this.a), t.x = i, t.y = n, t;
  var a = this.g - r / this.a;
  return n = na(a, this.e0, this.e1, this.e2, this.e3), i = wt(this.long0 + s / this.ns, this.over), t.x = i, t.y = n, t;
}
var L4 = ["Equidistant_Conic", "eqdc"];
const F4 = {
  init: j4,
  forward: T4,
  inverse: C4,
  names: L4
};
function G4() {
  this.R = this.a;
}
function z4(t) {
  var e = t.x, r = t.y, n = wt(e - this.long0, this.over), i, s;
  Math.abs(r) <= pt && (i = this.x0 + this.R * n, s = this.y0);
  var a = Fr(2 * Math.abs(r / Math.PI));
  (Math.abs(n) <= pt || Math.abs(Math.abs(r) - st) <= pt) && (i = this.x0, r >= 0 ? s = this.y0 + Math.PI * this.R * Math.tan(0.5 * a) : s = this.y0 + Math.PI * this.R * -Math.tan(0.5 * a));
  var o = 0.5 * Math.abs(Math.PI / n - n / Math.PI), c = o * o, h = Math.sin(a), f = Math.cos(a), u = f / (h + f - 1), l = u * u, d = u * (2 / h - 1), g = d * d, w = Math.PI * this.R * (o * (u - g) + Math.sqrt(c * (u - g) * (u - g) - (g + c) * (l - g))) / (g + c);
  n < 0 && (w = -w), i = this.x0 + w;
  var m = c + u;
  return w = Math.PI * this.R * (d * m - o * Math.sqrt((g + c) * (c + 1) - m * m)) / (g + c), r >= 0 ? s = this.y0 + w : s = this.y0 - w, t.x = i, t.y = s, t;
}
function q4(t) {
  var e, r, n, i, s, a, o, c, h, f, u, l, d;
  return t.x -= this.x0, t.y -= this.y0, u = Math.PI * this.R, n = t.x / u, i = t.y / u, s = n * n + i * i, a = -Math.abs(i) * (1 + s), o = a - 2 * i * i + n * n, c = -2 * a + 1 + 2 * i * i + s * s, d = i * i / c + (2 * o * o * o / c / c / c - 9 * a * o / c / c) / 27, h = (a - o * o / 3 / c) / c, f = 2 * Math.sqrt(-h / 3), u = 3 * d / h / f, Math.abs(u) > 1 && (u >= 0 ? u = 1 : u = -1), l = Math.acos(u) / 3, t.y >= 0 ? r = (-f * Math.cos(l + Math.PI / 3) - o / 3 / c) * Math.PI : r = -(-f * Math.cos(l + Math.PI / 3) - o / 3 / c) * Math.PI, Math.abs(n) < pt ? e = this.long0 : e = wt(this.long0 + Math.PI * (s - 1 + Math.sqrt(1 + 2 * (n * n - i * i) + s * s)) / 2 / n, this.over), t.x = e, t.y = r, t;
}
var U4 = ["Van_der_Grinten_I", "VanDerGrinten", "Van_der_Grinten", "vandg"];
const B4 = {
  init: G4,
  forward: z4,
  inverse: q4,
  names: U4
};
function Z4(t, e, r, n, i, s) {
  const a = n - e, o = Math.atan((1 - s) * Math.tan(t)), c = Math.atan((1 - s) * Math.tan(r)), h = Math.sin(o), f = Math.cos(o), u = Math.sin(c), l = Math.cos(c);
  let d = a, g, w = 100, m, v, p, E, _, y, b, S, x, M, k, $, O, T;
  do {
    if (m = Math.sin(d), v = Math.cos(d), p = Math.sqrt(
      l * m * (l * m) + (f * u - h * l * v) * (f * u - h * l * v)
    ), p === 0)
      return { azi1: 0, s12: 0 };
    E = h * u + f * l * v, _ = Math.atan2(p, E), y = f * l * m / p, b = 1 - y * y, S = b !== 0 ? E - 2 * h * u / b : 0, x = s / 16 * b * (4 + s * (4 - 3 * b)), g = d, d = a + (1 - x) * s * y * (_ + x * p * (S + x * E * (-1 + 2 * S * S)));
  } while (Math.abs(d - g) > 1e-12 && --w > 0);
  return w === 0 ? { azi1: NaN, s12: NaN } : (M = b * (i * i - i * (1 - s) * (i * (1 - s))) / (i * (1 - s) * (i * (1 - s))), k = 1 + M / 16384 * (4096 + M * (-768 + M * (320 - 175 * M))), $ = M / 1024 * (256 + M * (-128 + M * (74 - 47 * M))), O = $ * p * (S + $ / 4 * (E * (-1 + 2 * S * S) - $ / 6 * S * (-3 + 4 * p * p) * (-3 + 4 * S * S))), T = i * (1 - s) * k * (_ - O), { azi1: Math.atan2(l * m, f * u - h * l * v), s12: T });
}
function V4(t, e, r, n, i, s) {
  const a = Math.atan((1 - s) * Math.tan(t)), o = Math.sin(a), c = Math.cos(a), h = Math.sin(r), f = Math.cos(r), u = Math.atan2(o, c * f), l = c * h, d = 1 - l * l, g = d * (i * i - i * (1 - s) * (i * (1 - s))) / (i * (1 - s) * (i * (1 - s))), w = 1 + g / 16384 * (4096 + g * (-768 + g * (320 - 175 * g))), m = g / 1024 * (256 + g * (-128 + g * (74 - 47 * g)));
  let v = n / (i * (1 - s) * w), p, E = 100, _, y, b, S;
  do
    _ = Math.cos(2 * u + v), y = Math.sin(v), b = Math.cos(v), S = m * y * (_ + m / 4 * (b * (-1 + 2 * _ * _) - m / 6 * _ * (-3 + 4 * y * y) * (-3 + 4 * _ * _))), p = v, v = n / (i * (1 - s) * w) + S;
  while (Math.abs(v - p) > 1e-12 && --E > 0);
  if (E === 0)
    return { lat2: NaN, lon2: NaN };
  const x = o * y - c * b * f, M = Math.atan2(
    o * b + c * y * f,
    (1 - s) * Math.sqrt(l * l + x * x)
  ), k = Math.atan2(
    y * h,
    c * b - o * y * f
  ), $ = s / 16 * d * (4 + s * (4 - 3 * d)), O = k - (1 - $) * s * l * (v + $ * y * (_ + $ * b * (-1 + 2 * _ * _))), T = e + O;
  return { lat2: M, lon2: T };
}
function H4() {
  this.sin_p12 = Math.sin(this.lat0), this.cos_p12 = Math.cos(this.lat0), this.f = this.es / (1 + Math.sqrt(1 - this.es));
}
function K4(t) {
  var e = t.x, r = t.y, n = Math.sin(t.y), i = Math.cos(t.y), s = wt(e - this.long0, this.over), a, o, c, h, f, u, l, d, g, w, m;
  return this.sphere ? Math.abs(this.sin_p12 - 1) <= pt ? (t.x = this.x0 + this.a * (st - r) * Math.sin(s), t.y = this.y0 - this.a * (st - r) * Math.cos(s), t) : Math.abs(this.sin_p12 + 1) <= pt ? (t.x = this.x0 + this.a * (st + r) * Math.sin(s), t.y = this.y0 + this.a * (st + r) * Math.cos(s), t) : (g = this.sin_p12 * n + this.cos_p12 * i * Math.cos(s), l = Math.acos(g), d = l ? l / Math.sin(l) : 1, t.x = this.x0 + this.a * d * i * Math.sin(s), t.y = this.y0 + this.a * d * (this.cos_p12 * n - this.sin_p12 * i * Math.cos(s)), t) : (a = mi(this.es), o = pi(this.es), c = yi(this.es), h = gi(this.es), Math.abs(this.sin_p12 - 1) <= pt ? (f = this.a * Me(a, o, c, h, st), u = this.a * Me(a, o, c, h, r), t.x = this.x0 + (f - u) * Math.sin(s), t.y = this.y0 - (f - u) * Math.cos(s), t) : Math.abs(this.sin_p12 + 1) <= pt ? (f = this.a * Me(a, o, c, h, st), u = this.a * Me(a, o, c, h, r), t.x = this.x0 + (f + u) * Math.sin(s), t.y = this.y0 + (f + u) * Math.cos(s), t) : Math.abs(e) < pt && Math.abs(r - this.lat0) < pt ? (t.x = t.y = 0, t) : (w = Z4(this.lat0, this.long0, r, e, this.a, this.f), m = w.azi1, t.x = w.s12 * Math.sin(m), t.y = w.s12 * Math.cos(m), t));
}
function X4(t) {
  t.x -= this.x0, t.y -= this.y0;
  var e, r, n, i, s, a, o, c, h, f, u, l, d, g, w, m;
  return this.sphere ? (e = Math.sqrt(t.x * t.x + t.y * t.y), e > 2 * st * this.a ? void 0 : (r = e / this.a, n = Math.sin(r), i = Math.cos(r), s = this.long0, Math.abs(e) <= pt ? a = this.lat0 : (a = Fr(i * this.sin_p12 + t.y * n * this.cos_p12 / e), o = Math.abs(this.lat0) - st, Math.abs(o) <= pt ? this.lat0 >= 0 ? s = wt(this.long0 + Math.atan2(t.x, -t.y), this.over) : s = wt(this.long0 - Math.atan2(-t.x, t.y), this.over) : s = wt(this.long0 + Math.atan2(t.x * n, e * this.cos_p12 * i - t.y * this.sin_p12 * n), this.over)), t.x = s, t.y = a, t)) : (c = mi(this.es), h = pi(this.es), f = yi(this.es), u = gi(this.es), Math.abs(this.sin_p12 - 1) <= pt ? (l = this.a * Me(c, h, f, u, st), e = Math.sqrt(t.x * t.x + t.y * t.y), d = l - e, a = na(d / this.a, c, h, f, u), s = wt(this.long0 + Math.atan2(t.x, -1 * t.y), this.over), t.x = s, t.y = a, t) : Math.abs(this.sin_p12 + 1) <= pt ? (l = this.a * Me(c, h, f, u, st), e = Math.sqrt(t.x * t.x + t.y * t.y), d = e - l, a = na(d / this.a, c, h, f, u), s = wt(this.long0 + Math.atan2(t.x, t.y), this.over), t.x = s, t.y = a, t) : (g = Math.atan2(t.x, t.y), w = Math.sqrt(t.x * t.x + t.y * t.y), m = V4(this.lat0, this.long0, g, w, this.a, this.f), t.x = m.lon2, t.y = m.lat2, t));
}
var W4 = ["Azimuthal_Equidistant", "aeqd"];
const J4 = {
  init: H4,
  forward: K4,
  inverse: X4,
  names: W4
};
function Y4() {
  this.sin_p14 = Math.sin(this.lat0 || 0), this.cos_p14 = Math.cos(this.lat0 || 0);
}
function Q4(t) {
  var e, r, n, i, s, a, o, c, h = t.x, f = t.y;
  return n = wt(h - (this.long0 || 0), this.over), e = Math.sin(f), r = Math.cos(f), i = Math.cos(n), a = this.sin_p14 * e + this.cos_p14 * r * i, s = 1, (a > 0 || Math.abs(a) <= pt) && (o = this.a * s * r * Math.sin(n), c = (this.y0 || 0) + this.a * s * (this.cos_p14 * e - this.sin_p14 * r * i)), t.x = o, t.y = c, t;
}
function tb(t) {
  var e, r, n, i, s, a, o, c, h;
  return t.x -= this.x0 || 0, t.y -= this.y0 || 0, e = Math.sqrt(t.x * t.x + t.y * t.y), r = Fr(e / this.a), n = Math.sin(r), i = Math.cos(r), c = this.long0 || 0, h = this.lat0 || 0, a = c, Math.abs(e) <= pt ? (o = h, t.x = a, t.y = o, t) : (o = Fr(i * this.sin_p14 + t.y * n * this.cos_p14 / e), s = Math.abs(h) - st, Math.abs(s) <= pt ? (h >= 0 ? a = wt(c + Math.atan2(t.x, -t.y), this.over) : a = wt(c - Math.atan2(-t.x, t.y), this.over), t.x = a, t.y = o, t) : (a = wt(c + Math.atan2(t.x * n, e * this.cos_p14 * i - t.y * this.sin_p14 * n), this.over), t.x = a, t.y = o, t));
}
var eb = ["ortho"];
const rb = {
  init: Y4,
  forward: Q4,
  inverse: tb,
  names: eb
};
var Jt = {
  FRONT: 1,
  RIGHT: 2,
  BACK: 3,
  LEFT: 4,
  TOP: 5,
  BOTTOM: 6
}, qt = {
  AREA_0: 1,
  AREA_1: 2,
  AREA_2: 3,
  AREA_3: 4
};
function nb() {
  this.x0 = this.x0 || 0, this.y0 = this.y0 || 0, this.lat0 = this.lat0 || 0, this.long0 = this.long0 || 0, this.lat_ts = this.lat_ts || 0, this.title = this.title || "Quadrilateralized Spherical Cube", this.lat0 >= st - zt / 2 ? this.face = Jt.TOP : this.lat0 <= -(st - zt / 2) ? this.face = Jt.BOTTOM : Math.abs(this.long0) <= zt ? this.face = Jt.FRONT : Math.abs(this.long0) <= st + zt ? this.face = this.long0 > 0 ? Jt.RIGHT : Jt.LEFT : this.face = Jt.BACK, this.es !== 0 && (this.one_minus_f = 1 - (this.a - this.b) / this.a, this.one_minus_f_squared = this.one_minus_f * this.one_minus_f);
}
function ib(t) {
  var e = { x: 0, y: 0 }, r, n, i, s, a, o, c = { value: 0 };
  if (t.x -= this.long0, this.es !== 0 ? r = Math.atan(this.one_minus_f_squared * Math.tan(t.y)) : r = t.y, n = t.x, this.face === Jt.TOP)
    s = st - r, n >= zt && n <= st + zt ? (c.value = qt.AREA_0, i = n - st) : n > st + zt || n <= -(st + zt) ? (c.value = qt.AREA_1, i = n > 0 ? n - Qt : n + Qt) : n > -(st + zt) && n <= -zt ? (c.value = qt.AREA_2, i = n + st) : (c.value = qt.AREA_3, i = n);
  else if (this.face === Jt.BOTTOM)
    s = st + r, n >= zt && n <= st + zt ? (c.value = qt.AREA_0, i = -n + st) : n < zt && n >= -zt ? (c.value = qt.AREA_1, i = -n) : n < -zt && n >= -(st + zt) ? (c.value = qt.AREA_2, i = -n - st) : (c.value = qt.AREA_3, i = n > 0 ? -n + Qt : -n - Qt);
  else {
    var h, f, u, l, d, g, w;
    this.face === Jt.RIGHT ? n = kn(n, +st) : this.face === Jt.BACK ? n = kn(n, +Qt) : this.face === Jt.LEFT && (n = kn(n, -st)), l = Math.sin(r), d = Math.cos(r), g = Math.sin(n), w = Math.cos(n), h = d * w, f = d * g, u = l, this.face === Jt.FRONT ? (s = Math.acos(h), i = Ps(s, u, f, c)) : this.face === Jt.RIGHT ? (s = Math.acos(f), i = Ps(s, u, -h, c)) : this.face === Jt.BACK ? (s = Math.acos(-h), i = Ps(s, u, -f, c)) : this.face === Jt.LEFT ? (s = Math.acos(-f), i = Ps(s, u, h, c)) : (s = i = 0, c.value = qt.AREA_0);
  }
  return o = Math.atan(12 / Qt * (i + Math.acos(Math.sin(i) * Math.cos(zt)) - st)), a = Math.sqrt((1 - Math.cos(s)) / (Math.cos(o) * Math.cos(o)) / (1 - Math.cos(Math.atan(1 / Math.cos(i))))), c.value === qt.AREA_1 ? o += st : c.value === qt.AREA_2 ? o += Qt : c.value === qt.AREA_3 && (o += 1.5 * Qt), e.x = a * Math.cos(o), e.y = a * Math.sin(o), e.x = e.x * this.a + this.x0, e.y = e.y * this.a + this.y0, t.x = e.x, t.y = e.y, t;
}
function sb(t) {
  var e = { lam: 0, phi: 0 }, r, n, i, s, a, o, c, h, f, u = { value: 0 };
  if (t.x = (t.x - this.x0) / this.a, t.y = (t.y - this.y0) / this.a, n = Math.atan(Math.sqrt(t.x * t.x + t.y * t.y)), r = Math.atan2(t.y, t.x), t.x >= 0 && t.x >= Math.abs(t.y) ? u.value = qt.AREA_0 : t.y >= 0 && t.y >= Math.abs(t.x) ? (u.value = qt.AREA_1, r -= st) : t.x < 0 && -t.x >= Math.abs(t.y) ? (u.value = qt.AREA_2, r = r < 0 ? r + Qt : r - Qt) : (u.value = qt.AREA_3, r += st), f = Qt / 12 * Math.tan(r), a = Math.sin(f) / (Math.cos(f) - 1 / Math.sqrt(2)), o = Math.atan(a), i = Math.cos(r), s = Math.tan(n), c = 1 - i * i * s * s * (1 - Math.cos(Math.atan(1 / Math.cos(o)))), c < -1 ? c = -1 : c > 1 && (c = 1), this.face === Jt.TOP)
    h = Math.acos(c), e.phi = st - h, u.value === qt.AREA_0 ? e.lam = o + st : u.value === qt.AREA_1 ? e.lam = o < 0 ? o + Qt : o - Qt : u.value === qt.AREA_2 ? e.lam = o - st : e.lam = o;
  else if (this.face === Jt.BOTTOM)
    h = Math.acos(c), e.phi = h - st, u.value === qt.AREA_0 ? e.lam = -o + st : u.value === qt.AREA_1 ? e.lam = -o : u.value === qt.AREA_2 ? e.lam = -o - st : e.lam = o < 0 ? -o - Qt : -o + Qt;
  else {
    var l, d, g;
    l = c, f = l * l, f >= 1 ? g = 0 : g = Math.sqrt(1 - f) * Math.sin(o), f += g * g, f >= 1 ? d = 0 : d = Math.sqrt(1 - f), u.value === qt.AREA_1 ? (f = d, d = -g, g = f) : u.value === qt.AREA_2 ? (d = -d, g = -g) : u.value === qt.AREA_3 && (f = d, d = g, g = -f), this.face === Jt.RIGHT ? (f = l, l = -d, d = f) : this.face === Jt.BACK ? (l = -l, d = -d) : this.face === Jt.LEFT && (f = l, l = d, d = -f), e.phi = Math.acos(-g) - st, e.lam = Math.atan2(d, l), this.face === Jt.RIGHT ? e.lam = kn(e.lam, -st) : this.face === Jt.BACK ? e.lam = kn(e.lam, -Qt) : this.face === Jt.LEFT && (e.lam = kn(e.lam, +st));
  }
  if (this.es !== 0) {
    var w, m, v;
    w = e.phi < 0 ? 1 : 0, m = Math.tan(e.phi), v = this.b / Math.sqrt(m * m + this.one_minus_f_squared), e.phi = Math.atan(Math.sqrt(this.a * this.a - v * v) / (this.one_minus_f * v)), w && (e.phi = -e.phi);
  }
  return e.lam += this.long0, t.x = e.lam, t.y = e.phi, t;
}
function Ps(t, e, r, n) {
  var i;
  return t < pt ? (n.value = qt.AREA_0, i = 0) : (i = Math.atan2(e, r), Math.abs(i) <= zt ? n.value = qt.AREA_0 : i > zt && i <= st + zt ? (n.value = qt.AREA_1, i -= st) : i > st + zt || i <= -(st + zt) ? (n.value = qt.AREA_2, i = i >= 0 ? i - Qt : i + Qt) : (n.value = qt.AREA_3, i += st)), i;
}
function kn(t, e) {
  var r = t + e;
  return r < -Qt ? r += ei : r > +Qt && (r -= ei), r;
}
var ab = ["Quadrilateralized Spherical Cube", "Quadrilateralized_Spherical_Cube", "qsc"];
const ob = {
  init: nb,
  forward: ib,
  inverse: sb,
  names: ab
};
var lh = [
  [1, 22199e-21, -715515e-10, 31103e-10],
  [0.9986, -482243e-9, -24897e-9, -13309e-10],
  [0.9954, -83103e-8, -448605e-10, -986701e-12],
  [0.99, -135364e-8, -59661e-9, 36777e-10],
  [0.9822, -167442e-8, -449547e-11, -572411e-11],
  [0.973, -214868e-8, -903571e-10, 18736e-12],
  [0.96, -305085e-8, -900761e-10, 164917e-11],
  [0.9427, -382792e-8, -653386e-10, -26154e-10],
  [0.9216, -467746e-8, -10457e-8, 481243e-11],
  [0.8962, -536223e-8, -323831e-10, -543432e-11],
  [0.8679, -609363e-8, -113898e-9, 332484e-11],
  [0.835, -698325e-8, -640253e-10, 934959e-12],
  [0.7986, -755338e-8, -500009e-10, 935324e-12],
  [0.7597, -798324e-8, -35971e-9, -227626e-11],
  [0.7186, -851367e-8, -701149e-10, -86303e-10],
  [0.6732, -986209e-8, -199569e-9, 191974e-10],
  [0.6213, -0.010418, 883923e-10, 624051e-11],
  [0.5722, -906601e-8, 182e-6, 624051e-11],
  [0.5322, -677797e-8, 275608e-9, 624051e-11]
], Hn = [
  [-520417e-23, 0.0124, 121431e-23, -845284e-16],
  [0.062, 0.0124, -126793e-14, 422642e-15],
  [0.124, 0.0124, 507171e-14, -160604e-14],
  [0.186, 0.0123999, -190189e-13, 600152e-14],
  [0.248, 0.0124002, 710039e-13, -224e-10],
  [0.31, 0.0123992, -264997e-12, 835986e-13],
  [0.372, 0.0124029, 988983e-12, -311994e-12],
  [0.434, 0.0123893, -369093e-11, -435621e-12],
  [0.4958, 0.0123198, -102252e-10, -345523e-12],
  [0.5571, 0.0121916, -154081e-10, -582288e-12],
  [0.6176, 0.0119938, -241424e-10, -525327e-12],
  [0.6769, 0.011713, -320223e-10, -516405e-12],
  [0.7346, 0.0113541, -397684e-10, -609052e-12],
  [0.7903, 0.0109107, -489042e-10, -104739e-11],
  [0.8435, 0.0103431, -64615e-9, -140374e-14],
  [0.8936, 969686e-8, -64636e-9, -8547e-9],
  [0.9394, 840947e-8, -192841e-9, -42106e-10],
  [0.9761, 616527e-8, -256e-6, -42106e-10],
  [1, 328947e-8, -319159e-9, -42106e-10]
], yp = 0.8487, gp = 1.3523, wp = Ne / 5, cb = 1 / wp, Sn = 18, ia = function(t, e) {
  return t[0] + e * (t[1] + e * (t[2] + e * t[3]));
}, hb = function(t, e) {
  return t[1] + e * (2 * t[2] + e * 3 * t[3]);
};
function lb(t, e, r, n) {
  for (var i = e; n; --n) {
    var s = t(i);
    if (i -= s, Math.abs(s) < r)
      break;
  }
  return i;
}
function ub() {
  this.x0 = this.x0 || 0, this.y0 = this.y0 || 0, this.long0 = this.long0 || 0, this.es = 0, this.title = this.title || "Robinson";
}
function fb(t) {
  var e = wt(t.x - this.long0, this.over), r = Math.abs(t.y), n = Math.floor(r * wp);
  n < 0 ? n = 0 : n >= Sn && (n = Sn - 1), r = Ne * (r - cb * n);
  var i = {
    x: ia(lh[n], r) * e,
    y: ia(Hn[n], r)
  };
  return t.y < 0 && (i.y = -i.y), i.x = i.x * this.a * yp + this.x0, i.y = i.y * this.a * gp + this.y0, i;
}
function db(t) {
  var e = {
    x: (t.x - this.x0) / (this.a * yp),
    y: Math.abs(t.y - this.y0) / (this.a * gp)
  };
  if (e.y >= 1)
    e.x /= lh[Sn][0], e.y = t.y < 0 ? -st : st;
  else {
    var r = Math.floor(e.y * Sn);
    for (r < 0 ? r = 0 : r >= Sn && (r = Sn - 1); ; )
      if (Hn[r][0] > e.y)
        --r;
      else if (Hn[r + 1][0] <= e.y)
        ++r;
      else
        break;
    var n = Hn[r], i = 5 * (e.y - n[0]) / (Hn[r + 1][0] - n[0]);
    i = lb(function(s) {
      return (ia(n, s) - e.y) / hb(n, s);
    }, i, pt, 100), e.x /= ia(lh[r], i), e.y = (5 * r + i) * Yt, t.y < 0 && (e.y = -e.y);
  }
  return e.x = wt(e.x + this.long0, this.over), e;
}
var mb = ["Robinson", "robin"];
const pb = {
  init: ub,
  forward: fb,
  inverse: db,
  names: mb
};
function yb() {
  this.name = "geocent";
}
function gb(t) {
  var e = sp(t, this.es, this.a);
  return e;
}
function wb(t) {
  var e = ap(t, this.es, this.a, this.b);
  return e;
}
var _b = ["Geocentric", "geocentric", "geocent", "Geocent"];
const vb = {
  init: yb,
  forward: gb,
  inverse: wb,
  names: _b
};
var ge = {
  N_POLE: 0,
  S_POLE: 1,
  EQUIT: 2,
  OBLIQ: 3
}, qn = {
  h: { def: 1e5, num: !0 },
  // default is Karman line, no default in PROJ.7
  azi: { def: 0, num: !0, degrees: !0 },
  // default is North
  tilt: { def: 0, num: !0, degrees: !0 },
  // default is Nadir
  long0: { def: 0, num: !0 },
  // default is Greenwich, conversion to rad is automatic
  lat0: { def: 0, num: !0 }
  // default is Equator, conversion to rad is automatic
};
function Eb() {
  if (Object.keys(qn).forEach((function(r) {
    if (typeof this[r] > "u")
      this[r] = qn[r].def;
    else {
      if (qn[r].num && isNaN(this[r]))
        throw new Error("Invalid parameter value, must be numeric " + r + " = " + this[r]);
      qn[r].num && (this[r] = parseFloat(this[r]));
    }
    qn[r].degrees && (this[r] = this[r] * Yt);
  }).bind(this)), Math.abs(Math.abs(this.lat0) - st) < pt ? this.mode = this.lat0 < 0 ? ge.S_POLE : ge.N_POLE : Math.abs(this.lat0) < pt ? this.mode = ge.EQUIT : (this.mode = ge.OBLIQ, this.sinph0 = Math.sin(this.lat0), this.cosph0 = Math.cos(this.lat0)), this.pn1 = this.h / this.a, this.pn1 <= 0 || this.pn1 > 1e10)
    throw new Error("Invalid height");
  this.p = 1 + this.pn1, this.rp = 1 / this.p, this.h1 = 1 / this.pn1, this.pfact = (this.p + 1) * this.h1, this.es = 0;
  var t = this.tilt, e = this.azi;
  this.cg = Math.cos(e), this.sg = Math.sin(e), this.cw = Math.cos(t), this.sw = Math.sin(t);
}
function bb(t) {
  t.x -= this.long0;
  var e = Math.sin(t.y), r = Math.cos(t.y), n = Math.cos(t.x), i, s;
  switch (this.mode) {
    case ge.OBLIQ:
      s = this.sinph0 * e + this.cosph0 * r * n;
      break;
    case ge.EQUIT:
      s = r * n;
      break;
    case ge.S_POLE:
      s = -e;
      break;
    case ge.N_POLE:
      s = e;
      break;
  }
  switch (s = this.pn1 / (this.p - s), i = s * r * Math.sin(t.x), this.mode) {
    case ge.OBLIQ:
      s *= this.cosph0 * e - this.sinph0 * r * n;
      break;
    case ge.EQUIT:
      s *= e;
      break;
    case ge.N_POLE:
      s *= -(r * n);
      break;
    case ge.S_POLE:
      s *= r * n;
      break;
  }
  var a, o;
  return a = s * this.cg + i * this.sg, o = 1 / (a * this.sw * this.h1 + this.cw), i = (i * this.cg - s * this.sg) * this.cw * o, s = a * o, t.x = i * this.a, t.y = s * this.a, t;
}
function Sb(t) {
  t.x /= this.a, t.y /= this.a;
  var e = { x: t.x, y: t.y }, r, n, i;
  i = 1 / (this.pn1 - t.y * this.sw), r = this.pn1 * t.x * i, n = this.pn1 * t.y * this.cw * i, t.x = r * this.cg + n * this.sg, t.y = n * this.cg - r * this.sg;
  var s = Ae(t.x, t.y);
  if (Math.abs(s) < pt)
    e.x = 0, e.y = t.y;
  else {
    var a, o;
    switch (o = 1 - s * s * this.pfact, o = (this.p - Math.sqrt(o)) / (this.pn1 / s + s / this.pn1), a = Math.sqrt(1 - o * o), this.mode) {
      case ge.OBLIQ:
        e.y = Math.asin(a * this.sinph0 + t.y * o * this.cosph0 / s), t.y = (a - this.sinph0 * Math.sin(e.y)) * s, t.x *= o * this.cosph0;
        break;
      case ge.EQUIT:
        e.y = Math.asin(t.y * o / s), t.y = a * s, t.x *= o;
        break;
      case ge.N_POLE:
        e.y = Math.asin(a), t.y = -t.y;
        break;
      case ge.S_POLE:
        e.y = -Math.asin(a);
        break;
    }
    e.x = Math.atan2(t.x, t.y);
  }
  return t.x = e.x + this.long0, t.y = e.y, t;
}
var Mb = ["Tilted_Perspective", "tpers"];
const xb = {
  init: Eb,
  forward: bb,
  inverse: Sb,
  names: Mb
};
function kb() {
  if (this.flip_axis = this.sweep === "x" ? 1 : 0, this.h = Number(this.h), this.radius_g_1 = this.h / this.a, this.radius_g_1 <= 0 || this.radius_g_1 > 1e10)
    throw new Error();
  if (this.radius_g = 1 + this.radius_g_1, this.C = this.radius_g * this.radius_g - 1, this.es !== 0) {
    var t = 1 - this.es, e = 1 / t;
    this.radius_p = Math.sqrt(t), this.radius_p2 = t, this.radius_p_inv2 = e, this.shape = "ellipse";
  } else
    this.radius_p = 1, this.radius_p2 = 1, this.radius_p_inv2 = 1, this.shape = "sphere";
  this.title || (this.title = "Geostationary Satellite View");
}
function $b(t) {
  var e = t.x, r = t.y, n, i, s, a;
  if (e = e - this.long0, this.shape === "ellipse") {
    r = Math.atan(this.radius_p2 * Math.tan(r));
    var o = this.radius_p / Ae(this.radius_p * Math.cos(r), Math.sin(r));
    if (i = o * Math.cos(e) * Math.cos(r), s = o * Math.sin(e) * Math.cos(r), a = o * Math.sin(r), (this.radius_g - i) * i - s * s - a * a * this.radius_p_inv2 < 0)
      return t.x = Number.NaN, t.y = Number.NaN, t;
    n = this.radius_g - i, this.flip_axis ? (t.x = this.radius_g_1 * Math.atan(s / Ae(a, n)), t.y = this.radius_g_1 * Math.atan(a / n)) : (t.x = this.radius_g_1 * Math.atan(s / n), t.y = this.radius_g_1 * Math.atan(a / Ae(s, n)));
  } else this.shape === "sphere" && (n = Math.cos(r), i = Math.cos(e) * n, s = Math.sin(e) * n, a = Math.sin(r), n = this.radius_g - i, this.flip_axis ? (t.x = this.radius_g_1 * Math.atan(s / Ae(a, n)), t.y = this.radius_g_1 * Math.atan(a / n)) : (t.x = this.radius_g_1 * Math.atan(s / n), t.y = this.radius_g_1 * Math.atan(a / Ae(s, n))));
  return t.x = t.x * this.a, t.y = t.y * this.a, t;
}
function Ib(t) {
  var e = -1, r = 0, n = 0, i, s, a, o;
  if (t.x = t.x / this.a, t.y = t.y / this.a, this.shape === "ellipse") {
    this.flip_axis ? (n = Math.tan(t.y / this.radius_g_1), r = Math.tan(t.x / this.radius_g_1) * Ae(1, n)) : (r = Math.tan(t.x / this.radius_g_1), n = Math.tan(t.y / this.radius_g_1) * Ae(1, r));
    var c = n / this.radius_p;
    if (i = r * r + c * c + e * e, s = 2 * this.radius_g * e, a = s * s - 4 * i * this.C, a < 0)
      return t.x = Number.NaN, t.y = Number.NaN, t;
    o = (-s - Math.sqrt(a)) / (2 * i), e = this.radius_g + o * e, r *= o, n *= o, t.x = Math.atan2(r, e), t.y = Math.atan(n * Math.cos(t.x) / e), t.y = Math.atan(this.radius_p_inv2 * Math.tan(t.y));
  } else if (this.shape === "sphere") {
    if (this.flip_axis ? (n = Math.tan(t.y / this.radius_g_1), r = Math.tan(t.x / this.radius_g_1) * Math.sqrt(1 + n * n)) : (r = Math.tan(t.x / this.radius_g_1), n = Math.tan(t.y / this.radius_g_1) * Math.sqrt(1 + r * r)), i = r * r + n * n + e * e, s = 2 * this.radius_g * e, a = s * s - 4 * i * this.C, a < 0)
      return t.x = Number.NaN, t.y = Number.NaN, t;
    o = (-s - Math.sqrt(a)) / (2 * i), e = this.radius_g + o * e, r *= o, n *= o, t.x = Math.atan2(r, e), t.y = Math.atan(n * Math.cos(t.x) / e);
  }
  return t.x = t.x + this.long0, t;
}
var Pb = ["Geostationary Satellite View", "Geostationary_Satellite", "geos"];
const Ab = {
  init: kb,
  forward: $b,
  inverse: Ib,
  names: Pb
};
var Jn = 1.340264, Yn = -0.081106, Qn = 893e-6, ti = 3796e-6, sa = Math.sqrt(3) / 2;
function Nb() {
  this.es = 0, this.long0 = this.long0 !== void 0 ? this.long0 : 0, this.x0 = this.x0 !== void 0 ? this.x0 : 0, this.y0 = this.y0 !== void 0 ? this.y0 : 0;
}
function Ob(t) {
  var e = wt(t.x - this.long0, this.over), r = t.y, n = Math.asin(sa * Math.sin(r)), i = n * n, s = i * i * i;
  return t.x = e * Math.cos(n) / (sa * (Jn + 3 * Yn * i + s * (7 * Qn + 9 * ti * i))), t.y = n * (Jn + Yn * i + s * (Qn + ti * i)), t.x = this.a * t.x + this.x0, t.y = this.a * t.y + this.y0, t;
}
function Rb(t) {
  t.x = (t.x - this.x0) / this.a, t.y = (t.y - this.y0) / this.a;
  var e = 1e-9, r = 12, n = t.y, i, s, a, o, c, h;
  for (h = 0; h < r && (i = n * n, s = i * i * i, a = n * (Jn + Yn * i + s * (Qn + ti * i)) - t.y, o = Jn + 3 * Yn * i + s * (7 * Qn + 9 * ti * i), n -= c = a / o, !(Math.abs(c) < e)); ++h)
    ;
  return i = n * n, s = i * i * i, t.x = sa * t.x * (Jn + 3 * Yn * i + s * (7 * Qn + 9 * ti * i)) / Math.cos(n), t.y = Math.asin(Math.sin(n) / sa), t.x = wt(t.x + this.long0, this.over), t;
}
var Db = ["eqearth", "Equal Earth", "Equal_Earth"];
const jb = {
  init: Nb,
  forward: Ob,
  inverse: Rb,
  names: Db
};
var ii = 1e-10;
function Tb() {
  var t;
  if (this.phi1 = this.lat1, Math.abs(this.phi1) < ii)
    throw new Error();
  this.es ? (this.en = Ch(this.es), this.m1 = Rn(
    this.phi1,
    this.am1 = Math.sin(this.phi1),
    t = Math.cos(this.phi1),
    this.en
  ), this.am1 = t / (Math.sqrt(1 - this.es * this.am1 * this.am1) * this.am1), this.inverse = Lb, this.forward = Cb) : (Math.abs(this.phi1) + ii >= st ? this.cphi1 = 0 : this.cphi1 = 1 / Math.tan(this.phi1), this.inverse = Gb, this.forward = Fb);
}
function Cb(t) {
  var e = wt(t.x - (this.long0 || 0), this.over), r = t.y, n, i, s;
  return n = this.am1 + this.m1 - Rn(r, i = Math.sin(r), s = Math.cos(r), this.en), i = s * e / (n * Math.sqrt(1 - this.es * i * i)), t.x = n * Math.sin(i), t.y = this.am1 - n * Math.cos(i), t.x = this.a * t.x + (this.x0 || 0), t.y = this.a * t.y + (this.y0 || 0), t;
}
function Lb(t) {
  t.x = (t.x - (this.x0 || 0)) / this.a, t.y = (t.y - (this.y0 || 0)) / this.a;
  var e, r, n, i;
  if (r = Ae(t.x, t.y = this.am1 - t.y), i = Lh(this.am1 + this.m1 - r, this.es, this.en), (e = Math.abs(i)) < st)
    e = Math.sin(i), n = r * Math.atan2(t.x, t.y) * Math.sqrt(1 - this.es * e * e) / Math.cos(i);
  else if (Math.abs(e - st) <= ii)
    n = 0;
  else
    throw new Error();
  return t.x = wt(n + (this.long0 || 0), this.over), t.y = zr(i), t;
}
function Fb(t) {
  var e = wt(t.x - (this.long0 || 0), this.over), r = t.y, n, i;
  return i = this.cphi1 + this.phi1 - r, Math.abs(i) > ii ? (t.x = i * Math.sin(n = e * Math.cos(r) / i), t.y = this.cphi1 - i * Math.cos(n)) : t.x = t.y = 0, t.x = this.a * t.x + (this.x0 || 0), t.y = this.a * t.y + (this.y0 || 0), t;
}
function Gb(t) {
  t.x = (t.x - (this.x0 || 0)) / this.a, t.y = (t.y - (this.y0 || 0)) / this.a;
  var e, r, n = Ae(t.x, t.y = this.cphi1 - t.y);
  if (r = this.cphi1 + this.phi1 - n, Math.abs(r) > st)
    throw new Error();
  return Math.abs(Math.abs(r) - st) <= ii ? e = 0 : e = n * Math.atan2(t.x, t.y) / Math.cos(r), t.x = wt(e + (this.long0 || 0), this.over), t.y = zr(r), t;
}
var zb = ["bonne", "Bonne (Werner lat_1=90)"];
const qb = {
  init: Tb,
  names: zb
}, g0 = {
  OBLIQUE: {
    forward: Hb,
    inverse: Xb
  },
  TRANSVERSE: {
    forward: Kb,
    inverse: Wb
  }
}, aa = {
  ROTATE: {
    o_alpha: "oAlpha",
    o_lon_c: "oLongC",
    o_lat_c: "oLatC"
  },
  NEW_POLE: {
    o_lat_p: "oLatP",
    o_lon_p: "oLongP"
  },
  NEW_EQUATOR: {
    o_lon_1: "oLong1",
    o_lat_1: "oLat1",
    o_lon_2: "oLong2",
    o_lat_2: "oLat2"
  }
};
function Ub() {
  if (this.x0 = this.x0 || 0, this.y0 = this.y0 || 0, this.long0 = this.long0 || 0, this.title = this.title || "General Oblique Transformation", this.isIdentity = ep.includes(this.o_proj), !this.o_proj)
    throw new Error("Missing parameter: o_proj");
  if (this.o_proj === "ob_tran")
    throw new Error("Invalid value for o_proj: " + this.o_proj);
  const t = this.projStr.replace("+proj=ob_tran", "").replace("+o_proj=", "+proj=").trim(), e = qe(t);
  if (!e)
    throw new Error("Invalid parameter: o_proj. Unknown projection " + this.o_proj);
  e.long0 = 0, this.obliqueProjection = e;
  let r;
  const n = Object.keys(aa), i = (o) => {
    if (typeof this[o] > "u")
      return;
    const c = parseFloat(this[o]) * Yt;
    if (isNaN(c))
      throw new Error("Invalid value for " + o + ": " + this[o]);
    return c;
  };
  for (let o = 0; o < n.length; o++) {
    const c = n[o], h = aa[c], f = Object.entries(h);
    if (f.some(
      ([l]) => typeof this[l] < "u"
    )) {
      r = h;
      for (let l = 0; l < f.length; l++) {
        const [d, g] = f[l], w = i(d);
        if (typeof w > "u")
          throw new Error("Missing parameter: " + d + ".");
        this[g] = w;
      }
      break;
    }
  }
  if (!r)
    throw new Error("No valid parameters provided for ob_tran projection.");
  const { lamp: s, phip: a } = Vb(this, r);
  this.lamp = s, Math.abs(a) > pt ? (this.cphip = Math.cos(a), this.sphip = Math.sin(a), this.projectionType = g0.OBLIQUE) : this.projectionType = g0.TRANSVERSE;
}
function Bb(t) {
  return this.projectionType.forward(this, t);
}
function Zb(t) {
  return this.projectionType.inverse(this, t);
}
function Vb(t, e) {
  let r, n;
  if (e === aa.ROTATE) {
    let i = t.oLongC, s = t.oLatC, a = t.oAlpha;
    if (Math.abs(Math.abs(s) - st) <= pt)
      throw new Error("Invalid value for o_lat_c: " + t.o_lat_c + " should be < 90°");
    n = i + Math.atan2(-1 * Math.cos(a), -1 * Math.sin(a) * Math.sin(s)), r = Math.asin(Math.cos(s) * Math.sin(a));
  } else if (e === aa.NEW_POLE)
    n = t.oLongP, r = t.oLatP;
  else {
    let i = t.oLong1, s = t.oLat1, a = t.oLong2, o = t.oLat2, c = Math.abs(s);
    if (Math.abs(s) > st - pt)
      throw new Error("Invalid value for o_lat_1: " + t.o_lat_1 + " should be < 90°");
    if (Math.abs(o) > st - pt)
      throw new Error("Invalid value for o_lat_2: " + t.o_lat_2 + " should be < 90°");
    if (Math.abs(s - o) < pt)
      throw new Error("Invalid value for o_lat_1 and o_lat_2: o_lat_1 should be different from o_lat_2");
    if (c < pt)
      throw new Error("Invalid value for o_lat_1: o_lat_1 should be different from zero");
    n = Math.atan2(
      Math.cos(s) * Math.sin(o) * Math.cos(i) - Math.sin(s) * Math.cos(o) * Math.cos(a),
      Math.sin(s) * Math.cos(o) * Math.sin(a) - Math.cos(s) * Math.sin(o) * Math.sin(i)
    ), r = Math.atan(-1 * Math.cos(n - i) / Math.tan(s));
  }
  return { lamp: n, phip: r };
}
function Hb(t, e) {
  let { x: r, y: n } = e;
  r += t.long0;
  const i = Math.cos(r), s = Math.sin(n), a = Math.cos(n);
  e.x = wt(
    Math.atan2(
      a * Math.sin(r),
      t.sphip * a * i + t.cphip * s
    ) + t.lamp
  ), e.y = Math.asin(
    t.sphip * s - t.cphip * a * i
  );
  const o = t.obliqueProjection.forward(e);
  return t.isIdentity && (o.x *= Ne, o.y *= Ne), o;
}
function Kb(t, e) {
  let { x: r, y: n } = e;
  r += t.long0;
  const i = Math.cos(n), s = Math.cos(r);
  e.x = wt(
    Math.atan2(
      i * Math.sin(r),
      Math.sin(n)
    ) + t.lamp
  ), e.y = Math.asin(-1 * i * s);
  const a = t.obliqueProjection.forward(e);
  return t.isIdentity && (a.x *= Ne, a.y *= Ne), a;
}
function Xb(t, e) {
  t.isIdentity && (e.x *= Yt, e.y *= Yt);
  const r = t.obliqueProjection.inverse(e);
  let { x: n, y: i } = r;
  if (n < Number.MAX_VALUE) {
    n -= t.lamp;
    const s = Math.cos(n), a = Math.sin(i), o = Math.cos(i);
    e.x = Math.atan2(
      o * Math.sin(n),
      t.sphip * o * s - t.cphip * a
    ), e.y = Math.asin(
      t.sphip * a + t.cphip * o * s
    );
  }
  return e.x = wt(e.x + t.long0), e;
}
function Wb(t, e) {
  t.isIdentity && (e.x *= Yt, e.y *= Yt);
  const r = t.obliqueProjection.inverse(e);
  let { x: n, y: i } = r;
  if (n < Number.MAX_VALUE) {
    const s = Math.cos(i);
    n -= t.lamp, e.x = Math.atan2(
      s * Math.sin(n),
      -1 * Math.sin(i)
    ), e.y = Math.asin(
      s * Math.cos(n)
    );
  }
  return e.x = wt(e.x + t.long0), e;
}
var Jb = ["General Oblique Transformation", "General_Oblique_Transformation", "ob_tran"];
const Yb = {
  init: Ub,
  forward: Bb,
  inverse: Zb,
  names: Jb
};
function Qb(t) {
  t.Proj.projections.add(Vs), t.Proj.projections.add(Hs), t.Proj.projections.add(z2), t.Proj.projections.add(W2), t.Proj.projections.add(eE), t.Proj.projections.add(aE), t.Proj.projections.add(fE), t.Proj.projections.add(gE), t.Proj.projections.add(bE), t.Proj.projections.add($E), t.Proj.projections.add(GE), t.Proj.projections.add(VE), t.Proj.projections.add(JE), t.Proj.projections.add(n4), t.Proj.projections.add(c4), t.Proj.projections.add(d4), t.Proj.projections.add(w4), t.Proj.projections.add(S4), t.Proj.projections.add(P4), t.Proj.projections.add(D4), t.Proj.projections.add(F4), t.Proj.projections.add(B4), t.Proj.projections.add(J4), t.Proj.projections.add(rb), t.Proj.projections.add(ob), t.Proj.projections.add(pb), t.Proj.projections.add(vb), t.Proj.projections.add(xb), t.Proj.projections.add(Ab), t.Proj.projections.add(jb), t.Proj.projections.add(qb), t.Proj.projections.add(Yb);
}
const _p = Object.assign(i2, {
  defaultDatum: "WGS84",
  Proj: qe,
  WGS84: new qe("WGS84"),
  Point: Pn,
  toPoint: op,
  defs: ce,
  nadgrid: Gv,
  transform: ra,
  mgrs: s2,
  version: "__VERSION__"
});
Qb(_p);
function uh(t, e = {}) {
  if (typeof t != "string")
    throw new TypeError(`Expected a string, got ${typeof t}`);
  const { resolve: r = !0 } = e;
  let n = t;
  return r && (n = lt.resolve(t)), n = n.replace(/\\/g, "/"), n[0] !== "/" && (n = `/${n}`), encodeURI(`file://${n}`).replace(/[?#]/g, encodeURIComponent);
}
function vp(t, e, r = {}) {
  const n = { type: "Feature" };
  return (r.id === 0 || r.id) && (n.id = r.id), r.bbox && (n.bbox = r.bbox), n.properties = e || {}, n.geometry = t, n;
}
function si(t, e, r = {}) {
  if (!t)
    throw new Error("coordinates is required");
  if (!Array.isArray(t))
    throw new Error("coordinates must be an Array");
  if (t.length < 2)
    throw new Error("coordinates must be at least 2 numbers long");
  if (!w0(t[0]) || !w0(t[1]))
    throw new Error("coordinates must contain numbers");
  return vp({
    type: "Point",
    coordinates: t
  }, e, r);
}
function tS(t, e, r = {}) {
  for (const n of t) {
    if (n.length < 4)
      throw new Error(
        "Each LinearRing of a Polygon must have 4 or more Positions."
      );
    if (n[n.length - 1].length !== n[0].length)
      throw new Error("First and last Position are not equivalent.");
    for (let i = 0; i < n[n.length - 1].length; i++)
      if (n[n.length - 1][i] !== n[0][i])
        throw new Error("First and last Position are not equivalent.");
  }
  return vp({
    type: "Polygon",
    coordinates: t
  }, e, r);
}
function An(t, e = {}) {
  const r = { type: "FeatureCollection" };
  return e.id && (r.id = e.id), e.bbox && (r.bbox = e.bbox), r.features = t, r;
}
function w0(t) {
  return !isNaN(t) && t !== null && !Array.isArray(t);
}
function eS(t) {
  if (!t)
    throw new Error("coord is required");
  if (!Array.isArray(t)) {
    if (t.type === "Feature" && t.geometry !== null && t.geometry.type === "Point")
      return [...t.geometry.coordinates];
    if (t.type === "Point")
      return [...t.coordinates];
  }
  if (Array.isArray(t) && t.length >= 2 && !Array.isArray(t[0]) && !Array.isArray(t[1]))
    return [...t];
  throw new Error("coord must be GeoJSON Point or an Array of numbers");
}
function _0(t) {
  if (Array.isArray(t))
    return t;
  if (t.type === "Feature") {
    if (t.geometry !== null)
      return t.geometry.coordinates;
  } else if (t.coordinates)
    return t.coordinates;
  throw new Error(
    "coords must be GeoJSON Feature, Geometry Object or an Array"
  );
}
function rS(t) {
  return t.type === "Feature" ? t.geometry : t;
}
const br = 11102230246251565e-32, me = 134217729, nS = (3 + 8 * br) * br;
function Vc(t, e, r, n, i) {
  let s, a, o, c, h = e[0], f = n[0], u = 0, l = 0;
  f > h == f > -h ? (s = h, h = e[++u]) : (s = f, f = n[++l]);
  let d = 0;
  if (u < t && l < r)
    for (f > h == f > -h ? (a = h + s, o = s - (a - h), h = e[++u]) : (a = f + s, o = s - (a - f), f = n[++l]), s = a, o !== 0 && (i[d++] = o); u < t && l < r; )
      f > h == f > -h ? (a = s + h, c = a - s, o = s - (a - c) + (h - c), h = e[++u]) : (a = s + f, c = a - s, o = s - (a - c) + (f - c), f = n[++l]), s = a, o !== 0 && (i[d++] = o);
  for (; u < t; )
    a = s + h, c = a - s, o = s - (a - c) + (h - c), h = e[++u], s = a, o !== 0 && (i[d++] = o);
  for (; l < r; )
    a = s + f, c = a - s, o = s - (a - c) + (f - c), f = n[++l], s = a, o !== 0 && (i[d++] = o);
  return (s !== 0 || d === 0) && (i[d++] = s), d;
}
function iS(t, e) {
  let r = e[0];
  for (let n = 1; n < t; n++) r += e[n];
  return r;
}
function wi(t) {
  return new Float64Array(t);
}
const sS = (3 + 16 * br) * br, aS = (2 + 12 * br) * br, oS = (9 + 64 * br) * br * br, mn = wi(4), v0 = wi(8), E0 = wi(12), b0 = wi(16), ve = wi(4);
function cS(t, e, r, n, i, s, a) {
  let o, c, h, f, u, l, d, g, w, m, v, p, E, _, y, b, S, x;
  const M = t - i, k = r - i, $ = e - s, O = n - s;
  _ = M * O, l = me * M, d = l - (l - M), g = M - d, l = me * O, w = l - (l - O), m = O - w, y = g * m - (_ - d * w - g * w - d * m), b = $ * k, l = me * $, d = l - (l - $), g = $ - d, l = me * k, w = l - (l - k), m = k - w, S = g * m - (b - d * w - g * w - d * m), v = y - S, u = y - v, mn[0] = y - (v + u) + (u - S), p = _ + v, u = p - _, E = _ - (p - u) + (v - u), v = E - b, u = E - v, mn[1] = E - (v + u) + (u - b), x = p + v, u = x - p, mn[2] = p - (x - u) + (v - u), mn[3] = x;
  let T = iS(4, mn), I = aS * a;
  if (T >= I || -T >= I || (u = t - M, o = t - (M + u) + (u - i), u = r - k, h = r - (k + u) + (u - i), u = e - $, c = e - ($ + u) + (u - s), u = n - O, f = n - (O + u) + (u - s), o === 0 && c === 0 && h === 0 && f === 0) || (I = oS * a + nS * Math.abs(T), T += M * f + O * o - ($ * h + k * c), T >= I || -T >= I)) return T;
  _ = o * O, l = me * o, d = l - (l - o), g = o - d, l = me * O, w = l - (l - O), m = O - w, y = g * m - (_ - d * w - g * w - d * m), b = c * k, l = me * c, d = l - (l - c), g = c - d, l = me * k, w = l - (l - k), m = k - w, S = g * m - (b - d * w - g * w - d * m), v = y - S, u = y - v, ve[0] = y - (v + u) + (u - S), p = _ + v, u = p - _, E = _ - (p - u) + (v - u), v = E - b, u = E - v, ve[1] = E - (v + u) + (u - b), x = p + v, u = x - p, ve[2] = p - (x - u) + (v - u), ve[3] = x;
  const N = Vc(4, mn, 4, ve, v0);
  _ = M * f, l = me * M, d = l - (l - M), g = M - d, l = me * f, w = l - (l - f), m = f - w, y = g * m - (_ - d * w - g * w - d * m), b = $ * h, l = me * $, d = l - (l - $), g = $ - d, l = me * h, w = l - (l - h), m = h - w, S = g * m - (b - d * w - g * w - d * m), v = y - S, u = y - v, ve[0] = y - (v + u) + (u - S), p = _ + v, u = p - _, E = _ - (p - u) + (v - u), v = E - b, u = E - v, ve[1] = E - (v + u) + (u - b), x = p + v, u = x - p, ve[2] = p - (x - u) + (v - u), ve[3] = x;
  const j = Vc(N, v0, 4, ve, E0);
  _ = o * f, l = me * o, d = l - (l - o), g = o - d, l = me * f, w = l - (l - f), m = f - w, y = g * m - (_ - d * w - g * w - d * m), b = c * h, l = me * c, d = l - (l - c), g = c - d, l = me * h, w = l - (l - h), m = h - w, S = g * m - (b - d * w - g * w - d * m), v = y - S, u = y - v, ve[0] = y - (v + u) + (u - S), p = _ + v, u = p - _, E = _ - (p - u) + (v - u), v = E - b, u = E - v, ve[1] = E - (v + u) + (u - b), x = p + v, u = x - p, ve[2] = p - (x - u) + (v - u), ve[3] = x;
  const C = Vc(j, E0, 4, ve, b0);
  return b0[C - 1];
}
function hS(t, e, r, n, i, s) {
  const a = (e - s) * (r - i), o = (t - i) * (n - s), c = a - o, h = Math.abs(a + o);
  return Math.abs(c) >= sS * h ? c : -cS(t, e, r, n, i, s, h);
}
function lS(t, e) {
  var r, n, i = 0, s, a, o, c, h, f, u, l = t[0], d = t[1], g = e.length;
  for (r = 0; r < g; r++) {
    n = 0;
    var w = e[r], m = w.length - 1;
    if (f = w[0], f[0] !== w[m][0] && f[1] !== w[m][1])
      throw new Error("First and last coordinates in a ring must be the same");
    for (a = f[0] - l, o = f[1] - d, n; n < m; n++) {
      if (u = w[n + 1], c = u[0] - l, h = u[1] - d, o === 0 && h === 0) {
        if (c <= 0 && a >= 0 || a <= 0 && c >= 0)
          return 0;
      } else if (h >= 0 && o <= 0 || h <= 0 && o >= 0) {
        if (s = hS(a, c, o, h, 0, 0), s === 0)
          return 0;
        (s > 0 && h > 0 && o <= 0 || s < 0 && h <= 0 && o > 0) && i++;
      }
      f = u, o = h, a = c;
    }
  }
  return i % 2 !== 0;
}
function fh(t, e, r = {}) {
  if (!t)
    throw new Error("point is required");
  if (!e)
    throw new Error("polygon is required");
  const n = eS(t), i = rS(e), s = i.type, a = e.bbox;
  let o = i.coordinates;
  if (a && uS(n, a) === !1)
    return !1;
  s === "Polygon" && (o = [o]);
  let c = !1;
  for (var h = 0; h < o.length; ++h) {
    const f = lS(n, o[h]);
    if (f === 0) return !r.ignoreBoundary;
    f && (c = !0);
  }
  return c;
}
function uS(t, e) {
  return e[0] <= t[0] && e[1] <= t[1] && e[2] >= t[0] && e[3] >= t[1];
}
function Hc(t, e) {
  for (let r = 0; r < e.features.length; r++)
    if (fh(t, e.features[r]))
      return e.features[r];
}
function Ep(t, e, r) {
  const n = e.geometry.coordinates[0][0], i = e.geometry.coordinates[0][1], s = e.geometry.coordinates[0][2], a = t.geometry.coordinates, o = e.properties.a.geom, c = e.properties.b.geom, h = e.properties.c.geom, f = [i[0] - n[0], i[1] - n[1]], u = [s[0] - n[0], s[1] - n[1]], l = [a[0] - n[0], a[1] - n[1]], d = [c[0] - o[0], c[1] - o[1]], g = [h[0] - o[0], h[1] - o[1]];
  let w = (u[1] * l[0] - u[0] * l[1]) / (f[0] * u[1] - f[1] * u[0]), m = (f[0] * l[1] - f[1] * l[0]) / (f[0] * u[1] - f[1] * u[0]);
  if (r) {
    const v = r[e.properties.a.index], p = r[e.properties.b.index], E = r[e.properties.c.index];
    let _;
    if (w < 0 || m < 0 || 1 - w - m < 0) {
      const y = w / (w + m), b = m / (w + m);
      _ = w / p / (y / p + b / E), m = m / E / (y / p + b / E);
    } else
      _ = w / p / (w / p + m / E + (1 - w - m) / v), m = m / E / (w / p + m / E + (1 - w - m) / v);
    w = _;
  }
  return [
    w * d[0] + m * g[0] + o[0],
    w * d[1] + m * g[1] + o[1]
  ];
}
function fS(t, e, r, n) {
  const i = t.geometry.coordinates, s = r.geometry.coordinates, a = Math.atan2(i[0] - s[0], i[1] - s[1]), o = mS(a, e[0]);
  if (o === void 0)
    throw new Error("Unable to determine vertex index");
  const c = e[1][o];
  return Ep(t, c.features[0], n);
}
function dS(t, e, r, n, i, s, a, o) {
  let c;
  if (a && (c = Hc(t, An([a]))), !c)
    if (r) {
      const h = t.geometry.coordinates, f = r.gridNum, u = r.xOrigin, l = r.yOrigin, d = r.xUnit, g = r.yUnit, w = r.gridCache, m = or(h[0], u, d, f), v = or(h[1], l, g, f), p = w[m] ? w[m][v] ? w[m][v] : [] : [], E = An(p.map((_) => e.features[_]));
      c = Hc(t, E);
    } else
      c = Hc(t, e);
  return o && o(c), c ? Ep(t, c, s) : fS(t, n, i, s);
}
function or(t, e, r, n) {
  let i = Math.floor((t - e) / r);
  return i < 0 && (i = 0), i >= n && (i = n - 1), i;
}
function mS(t, e) {
  let r = S0(t - e[0]), n = Math.PI * 2, i;
  for (let s = 0; s < e.length; s++) {
    const a = (s + 1) % e.length, o = S0(t - e[a]), c = Math.min(Math.abs(r), Math.abs(o));
    r * o <= 0 && c < n && (n = c, i = s), r = o;
  }
  return i;
}
function S0(t, e = !1) {
  const r = 2 * Math.PI, n = t - Math.floor(t / r) * r;
  return e ? n : n > Math.PI ? n - r : n;
}
function pS(t) {
  const e = [0, 1, 2, 0].map((n) => t[n][0][0]), r = {
    a: { geom: t[0][0][1], index: t[0][1] },
    b: { geom: t[1][0][1], index: t[1][1] },
    c: { geom: t[2][0][1], index: t[2][1] }
  };
  return tS([e], r);
}
function dh(t, e, r, n, i, s = !1, a) {
  const o = t.map(
    (c) => {
      (!a || a < 2.00703) && (c = bp(c));
      const h = isFinite(c) ? e[c] : c === "c" ? n : (function() {
        const f = c.match(/^b(\d+)$/);
        if (f) return i[parseInt(f[1])];
        const u = c.match(/^e(\d+)$/);
        if (u) return r[parseInt(u[1])];
        throw new Error("Bad index value for indexesToTri");
      })();
      return s ? [[h[1], h[0]], c] : [[h[0], h[1]], c];
    }
  );
  return pS(o);
}
function bp(t) {
  return typeof t == "number" ? t : t.replace(/^(c|e|b)(?:ent|dgeNode|box)(\d+)?$/, "$1$2");
}
function yS(t, e) {
  return e && e >= 2.00703 || Array.isArray(t[0]) ? t : t.map((r) => [
    r.illstNodes,
    r.mercNodes,
    r.startEnd
  ]);
}
const Sp = 2.00703;
function gS(t) {
  return !!(t.version !== void 0 || !t.tins && t.points && t.tins_points);
}
function wS(t) {
  return {
    points: t.points,
    pointsWeightBuffer: vS(t),
    strictStatus: ES(t),
    verticesParams: bS(t),
    centroid: SS(t),
    edges: yS(t.edges || []),
    edgeNodes: t.edgeNodes || [],
    tins: MS(t),
    kinks: xS(t.kinks_points),
    yaxisMode: t.yaxisMode ?? "invert",
    strictMode: t.strictMode ?? "auto",
    vertexMode: t.vertexMode,
    bounds: t.bounds,
    boundsPolygon: t.boundsPolygon,
    wh: t.wh,
    xy: t.xy ?? [0, 0]
  };
}
function _S(t) {
  const e = kS(t), r = e.tins;
  return {
    compiled: e,
    tins: r,
    points: $S(r),
    strictStatus: e.strict_status,
    pointsWeightBuffer: e.weight_buffer,
    verticesParams: e.vertices_params,
    centroid: e.centroid,
    kinks: e.kinks
  };
}
function vS(t) {
  return !t.version || t.version < Sp ? ["forw", "bakw"].reduce((e, r) => {
    const n = t.weight_buffer[r];
    return n && (e[r] = Object.keys(n).reduce((i, s) => {
      const a = bp(s);
      return i[a] = n[s], i;
    }, {})), e;
  }, {}) : t.weight_buffer;
}
function ES(t) {
  return t.strict_status ? t.strict_status : t.kinks_points ? "strict_error" : t.tins_points.length === 2 ? "loose" : "strict";
}
function bS(t) {
  const e = {
    forw: [t.vertices_params[0]],
    bakw: [t.vertices_params[1]]
  };
  return e.forw[1] = M0(t, !1), e.bakw[1] = M0(t, !0), e;
}
function M0(t, e) {
  const r = t.vertices_points.length;
  return Array.from({ length: r }, (n, i) => {
    const s = (i + 1) % r, a = dh(
      ["c", `b${i}`, `b${s}`],
      t.points,
      t.edgeNodes || [],
      t.centroid_point,
      t.vertices_points,
      e,
      Sp
    );
    return An([a]);
  });
}
function SS(t) {
  return {
    forw: si(t.centroid_point[0], {
      target: {
        geom: t.centroid_point[1],
        index: "c"
      }
    }),
    bakw: si(t.centroid_point[1], {
      target: {
        geom: t.centroid_point[0],
        index: "c"
      }
    })
  };
}
function MS(t) {
  const e = t.tins_points.length === 1 ? 0 : 1;
  return {
    forw: An(
      t.tins_points[0].map(
        (r) => dh(
          r,
          t.points,
          t.edgeNodes || [],
          t.centroid_point,
          t.vertices_points,
          !1,
          t.version
        )
      )
    ),
    bakw: An(
      t.tins_points[e].map(
        (r) => dh(
          r,
          t.points,
          t.edgeNodes || [],
          t.centroid_point,
          t.vertices_points,
          !0,
          t.version
        )
      )
    )
  };
}
function xS(t) {
  if (t)
    return {
      bakw: An(
        t.map((e) => si(e))
      )
    };
}
function kS(t) {
  return JSON.parse(
    JSON.stringify(t).replace('"cent"', '"c"').replace(/"bbox(\d+)"/g, '"b$1"')
  );
}
function $S(t) {
  const e = [], r = t.forw.features;
  for (let n = 0; n < r.length; n++) {
    const i = r[n];
    ["a", "b", "c"].forEach((s, a) => {
      const o = i.geometry.coordinates[0][a], c = i.properties[s].geom, h = i.properties[s].index;
      typeof h == "number" && (e[h] = [o, c]);
    });
  }
  return e;
}
class ze {
  /**
   * 各種モードの定数定義
   * すべてreadonlyで、型安全性を確保
   */
  static VERTEX_PLAIN = "plain";
  static VERTEX_BIRDEYE = "birdeye";
  static MODE_STRICT = "strict";
  static MODE_AUTO = "auto";
  static MODE_LOOSE = "loose";
  static STATUS_STRICT = "strict";
  static STATUS_ERROR = "strict_error";
  static STATUS_LOOSE = "loose";
  static YAXIS_FOLLOW = "follow";
  static YAXIS_INVERT = "invert";
  points = [];
  pointsWeightBuffer;
  strict_status;
  vertices_params;
  centroid;
  edgeNodes;
  edges;
  tins;
  kinks;
  yaxisMode = ze.YAXIS_INVERT;
  strictMode = ze.MODE_AUTO;
  vertexMode = ze.VERTEX_PLAIN;
  bounds;
  boundsPolygon;
  wh;
  xy;
  indexedTins;
  stateFull = !1;
  stateTriangle;
  stateBackward;
  /**
   * Optional properties for MaplatCore extension
   * These properties allow consuming applications to extend Transform instances
   * with additional metadata without requiring Module Augmentation
   */
  /** Layer priority for rendering order */
  priority;
  /** Layer importance for display decisions */
  importance;
  /** Bounds in XY (source) coordinate system */
  xyBounds;
  /** Bounds in Mercator (Web Mercator) coordinate system */
  mercBounds;
  constructor() {
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
    if (gS(e)) {
      this.applyModernState(wS(e));
      return;
    }
    this.applyLegacyState(_S(e));
  }
  applyModernState(e) {
    this.points = e.points, this.pointsWeightBuffer = e.pointsWeightBuffer, this.strict_status = e.strictStatus, this.vertices_params = e.verticesParams, this.centroid = e.centroid, this.edges = e.edges, this.edgeNodes = e.edgeNodes || [], this.tins = e.tins, this.addIndexedTin(), this.kinks = e.kinks, this.yaxisMode = e.yaxisMode ?? ze.YAXIS_INVERT, this.vertexMode = e.vertexMode ?? ze.VERTEX_PLAIN, this.strictMode = e.strictMode ?? ze.MODE_AUTO, e.bounds ? (this.bounds = e.bounds, this.boundsPolygon = e.boundsPolygon, this.xy = e.xy, this.wh = e.wh) : (this.bounds = void 0, this.boundsPolygon = void 0, this.xy = e.xy ?? [0, 0], e.wh && (this.wh = e.wh));
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
    const e = this.tins, r = e.forw, n = e.bakw, i = Math.ceil(Math.sqrt(r.features.length));
    if (i < 3) {
      this.indexedTins = void 0;
      return;
    }
    let s = [], a = [];
    const o = r.features.map((w) => {
      let m = [];
      return _0(w)[0].map((v) => {
        s.length === 0 ? s = [Array.from(v), Array.from(v)] : (v[0] < s[0][0] && (s[0][0] = v[0]), v[0] > s[1][0] && (s[1][0] = v[0]), v[1] < s[0][1] && (s[0][1] = v[1]), v[1] > s[1][1] && (s[1][1] = v[1])), m.length === 0 ? m = [Array.from(v), Array.from(v)] : (v[0] < m[0][0] && (m[0][0] = v[0]), v[0] > m[1][0] && (m[1][0] = v[0]), v[1] < m[0][1] && (m[0][1] = v[1]), v[1] > m[1][1] && (m[1][1] = v[1]));
      }), m;
    }), c = (s[1][0] - s[0][0]) / i, h = (s[1][1] - s[0][1]) / i, f = o.reduce(
      (w, m, v) => {
        const p = or(m[0][0], s[0][0], c, i), E = or(m[1][0], s[0][0], c, i), _ = or(m[0][1], s[0][1], h, i), y = or(m[1][1], s[0][1], h, i);
        for (let b = p; b <= E; b++) {
          w[b] || (w[b] = []);
          for (let S = _; S <= y; S++)
            w[b][S] || (w[b][S] = []), w[b][S].push(v);
        }
        return w;
      },
      []
    ), u = n.features.map((w) => {
      let m = [];
      return _0(w)[0].map((v) => {
        a.length === 0 ? a = [Array.from(v), Array.from(v)] : (v[0] < a[0][0] && (a[0][0] = v[0]), v[0] > a[1][0] && (a[1][0] = v[0]), v[1] < a[0][1] && (a[0][1] = v[1]), v[1] > a[1][1] && (a[1][1] = v[1])), m.length === 0 ? m = [Array.from(v), Array.from(v)] : (v[0] < m[0][0] && (m[0][0] = v[0]), v[0] > m[1][0] && (m[1][0] = v[0]), v[1] < m[0][1] && (m[0][1] = v[1]), v[1] > m[1][1] && (m[1][1] = v[1]));
      }), m;
    }), l = (a[1][0] - a[0][0]) / i, d = (a[1][1] - a[0][1]) / i, g = u.reduce(
      (w, m, v) => {
        const p = or(m[0][0], a[0][0], l, i), E = or(m[1][0], a[0][0], l, i), _ = or(m[0][1], a[0][1], d, i), y = or(m[1][1], a[0][1], d, i);
        for (let b = p; b <= E; b++) {
          w[b] || (w[b] = []);
          for (let S = _; S <= y; S++)
            w[b][S] || (w[b][S] = []), w[b][S].push(v);
        }
        return w;
      },
      []
    );
    this.indexedTins = {
      forw: {
        gridNum: i,
        xOrigin: s[0][0],
        yOrigin: s[0][1],
        xUnit: c,
        yUnit: h,
        gridCache: f
      },
      bakw: {
        gridNum: i,
        xOrigin: a[0][0],
        yOrigin: a[0][1],
        xUnit: l,
        yUnit: d,
        gridCache: g
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
    if (!this.tins)
      throw new Error("setCompiled() must be called before transform()");
    if (r && this.strict_status == ze.STATUS_ERROR)
      throw new Error('Backward transform is not allowed if strict_status == "strict_error"');
    this.yaxisMode == ze.YAXIS_FOLLOW && r && (e = [e[0], -1 * e[1]]);
    const i = si(e);
    if (this.bounds && !r && !n && !fh(i, this.boundsPolygon))
      return !1;
    const s = r ? this.tins.bakw : this.tins.forw, a = r ? this.indexedTins.bakw : this.indexedTins.forw, o = r ? this.vertices_params.bakw : this.vertices_params.forw, c = r ? this.centroid.bakw : this.centroid.forw, h = r ? this.pointsWeightBuffer.bakw : this.pointsWeightBuffer.forw;
    let f, u;
    this.stateFull && (this.stateBackward == r ? f = this.stateTriangle : (this.stateBackward = r, this.stateTriangle = void 0), u = (d) => {
      this.stateTriangle = d;
    });
    let l = dS(
      i,
      s,
      a,
      o,
      c,
      h,
      f,
      u
    );
    if (this.bounds && r && !n) {
      const d = si(l);
      if (!fh(d, this.boundsPolygon)) return !1;
    } else this.yaxisMode == ze.YAXIS_FOLLOW && !r && (l = [l[0], -1 * l[1]]);
    return l;
  }
}
const Mp = [
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
async function xp(t, e = !1) {
  return IS(t, e, !1);
}
async function IS(t, e, r) {
  const n = r ? t : {}, i = [];
  if (Mp.forEach((s) => {
    n[s] = t[s];
  }), (t.imageExtention || t.imageExtension) && (n.imageExtension = t.imageExtension || t.imageExtention), t.compiled) {
    let s = new ze();
    s.setCompiled(t.compiled), s.addIndexedTin(), e && (s = t.compiled);
    const a = s;
    n.strictMode = a.strictMode, n.vertexMode = a.vertexMode, n.yaxisMode = a.yaxisMode, n.width = a.wh?.[0], n.height = a.wh?.[1], n.gcps = a.points, n.edges = a.edges, i.push(s);
  } else {
    n.strictMode = t.strictMode, n.vertexMode = t.vertexMode, n.yaxisMode = t.yaxisMode, n.width = t.width, n.height = t.height, n.gcps = t.gcps, n.edges = t.edges;
    let s = await x0(
      t.strictMode,
      t.vertexMode,
      t.yaxisMode,
      t.gcps,
      t.edges,
      [t.width, t.height]
    );
    e && typeof s != "string" && (s = t.compiled), i.push(s);
  }
  if (t.sub_maps) {
    const s = [];
    for (let a = 0; a < t.sub_maps.length; a++) {
      const o = t.sub_maps[a], c = {};
      if (c.importance = o.importance, c.priority = o.priority, o.compiled) {
        let h = new ze();
        h.setCompiled(o.compiled), h.addIndexedTin(), e && (h = o.compiled), c.bounds = h.bounds, c.gcps = h.points, c.edges = h.edges, i.push(h);
      } else {
        c.bounds = o.bounds, c.gcps = o.gcps, c.edges = o.edges;
        let h = await x0(
          t.strictMode,
          t.vertexMode,
          t.yaxisMode,
          o.gcps,
          o.edges,
          void 0,
          o.bounds
        );
        e && typeof h != "string" && (h = o.compiled), i.push(h);
      }
      s.push(c);
    }
    n.sub_maps = s;
  }
  return [n, i];
}
async function kp(t, e) {
  const r = {};
  Mp.forEach((i) => {
    r[i] = t[i];
  }), (t.imageExtention || t.imageExtension) && (r.imageExtension = t.imageExtension || t.imageExtention);
  const n = e.shift();
  return typeof n == "string" ? (r.width = t.width, r.height = t.height, r.gcps = t.gcps, r.edges = t.edges, r.strictMode = t.strictMode, r.vertexMode = t.vertexMode, r.yaxisMode = t.yaxisMode) : r.compiled = n, r.sub_maps = e.length > 0 ? e.map((i, s) => {
    const a = t.sub_maps[s], o = {
      priority: a.priority,
      importance: a.importance
    };
    return typeof i == "string" ? (o.gcps = a.gcps, o.edges = a.edges, o.bounds = a.bounds) : o.compiled = i, o;
  }) : [], r;
}
async function x0(t, e, r, n = [], i = [], s, a) {
  return n.length < 3 ? "tooLessGcps" : (console.error("@maplat/transform requires pre-compiled data. Cannot create from GCPs."), console.error("Please use @maplat/editor or a separate tool to generate compiled data."), "compiledRequired");
}
class PS {
  async request(e) {
    const n = await (await Er.getDBInstance()).findOneAsync({ _id: e });
    if (!n) throw new Error(`Map with ID ${e} not found`);
    const i = ae.get("saveFolder"), s = lt.join(i, "tiles"), a = lt.join(s, e, "0", "0"), o = await this.normalizeRequestData(n, a);
    return o[0].mapID = e, o[0].status = "Update", o[0].onlyOne = !0, o[0];
  }
  async normalizeRequestData(e, r) {
    let n;
    if (!(e.width && e.height || e.compiled && e.compiled.wh))
      return [e];
    if (e.url)
      n = e.url;
    else
      try {
        if (await gt.pathExists(r)) {
          const h = (await gt.readdir(r)).find((f) => /^0\.(jpg|jpeg|png)$/.test(f));
          if (h) {
            let f = uh(lt.join(r, h));
            const u = /\/0\/0\/0\.(jpg|jpeg|png)$/;
            n = f.replace(u, "/{z}/{x}/{y}.$1");
          }
        }
      } catch (c) {
        console.error("[MapEditService] タイル検索エラー:", c);
      }
    const [s, a] = await xp(e, !0);
    return s.url_ = n, [s, a];
  }
  /**
   * 旧実装 mapedit.save() 相当
   * mapObject: フロントエンドから渡される地図データ（status を含む）
   * tins: 各レイヤーのコンパイル済みTINデータの配列（文字列またはオブジェクト）
   *
   * 返り値: 'Success' | 'Exist' | 'Error' 等の文字列
   */
  async save(e, r) {
    const n = e.status, i = e.mapID, s = e.url_, a = e.imageExtension || e.imageExtention || "jpg";
    r.length === 0 && (r = ["tooLessGcps"]);
    const o = await kp(e, r), c = ae.get("saveFolder"), h = lt.join(c, "tiles"), f = lt.join(c, "originals"), u = lt.join(c, "tmbs"), l = ae.get("tmpFolder"), d = lt.join(l, "tiles"), g = uh(d), w = lt.join(h, i), m = lt.join(f, `${i}.${a}`), v = lt.join(u, `${i}.jpg`), p = new RegExp(`^${g}`), E = s && s.match(p);
    await gt.ensureDir(h), await gt.ensureDir(f), await gt.ensureDir(u);
    const _ = await Er.getDBInstance();
    try {
      return await Promise.all([
        // --- DBとファイル変名/コピー操作 ---
        (async () => {
          if (n !== "Update") {
            if (await _.findOneAsync({ _id: i }))
              throw new Error("Exist");
            const b = n.match(/^(Change|Copy):(.+)$/);
            if (b) {
              const S = b[1] === "Copy", x = b[2], M = lt.join(h, x), k = lt.join(f, `${x}.${a}`), $ = lt.join(u, `${x}.jpg`);
              if (await _.updateAsync({ _id: i }, { $set: o }, { upsert: !0 }), S || await _.removeAsync({ _id: x }, {}), E) {
                if (!S) {
                  try {
                    await gt.remove(M);
                  } catch {
                  }
                  try {
                    await gt.remove(k);
                  } catch {
                  }
                  try {
                    await gt.remove($);
                  } catch {
                  }
                }
              } else {
                const O = S ? gt.copy.bind(gt) : gt.move.bind(gt);
                await gt.pathExists(M) && await O(M, w), await gt.pathExists(k) && await O(k, m), await gt.pathExists($) && await O($, v);
              }
            } else
              await _.updateAsync({ _id: i }, { $set: o }, { upsert: !0 });
          } else
            await _.updateAsync({ _id: i }, { $set: o }, { upsert: !0 });
        })(),
        // --- tmpフォルダからの永続フォルダへの移動 ---
        (async () => {
          if (E) {
            try {
              await gt.remove(w);
            } catch {
            }
            await gt.move(d, w);
            const y = lt.join(w, `original.${a}`);
            try {
              await gt.remove(m);
            } catch {
            }
            await gt.pathExists(y) && await gt.move(y, m);
            const b = lt.join(w, "thumbnail.jpg");
            try {
              await gt.remove(v);
            } catch {
            }
            await gt.pathExists(b) && await gt.move(b, v);
          }
        })()
      ]), "Success";
    } catch (y) {
      return y && y.message === "Exist" ? "Exist" : (console.error("[MapEditService.save] Error:", y), "Error");
    }
  }
}
const k0 = new PS();
class Bh {
  channel;
  total;
  startMsg;
  endMsg;
  window = null;
  // 旧実装の throttle 制御: 5%以上の変化 or 30秒経過 or 100%時に送信
  lastPercent = null;
  lastTime = null;
  constructor(e, r, n, i) {
    this.channel = e, this.total = r, this.startMsg = n, this.endMsg = i;
  }
  setWindow(e) {
    this.window = e;
  }
  update(e) {
    if (!this.window) return;
    const r = Math.floor(e / this.total * 100), n = /* @__PURE__ */ new Date();
    if (this.lastPercent == null || this.lastTime == null || r === 100 || r - this.lastPercent > 5 || n.getTime() - this.lastTime.getTime() > 3e4) {
      this.lastPercent = r, this.lastTime = n;
      const i = `(${e}/${this.total})`, s = r === 100 && this.endMsg ? this.endMsg : this.startMsg;
      this.window.webContents.send(this.channel, {
        text: s,
        percent: r,
        progress: i
      });
    }
  }
}
function ai(t, e, r = {}) {
  const n = { type: "Feature" };
  return (r.id === 0 || r.id) && (n.id = r.id), r.bbox && (n.bbox = r.bbox), n.properties = e || {}, n.geometry = t, n;
}
function Cr(t, e, r = {}) {
  if (!t)
    throw new Error("coordinates is required");
  if (!Array.isArray(t))
    throw new Error("coordinates must be an Array");
  if (t.length < 2)
    throw new Error("coordinates must be at least 2 numbers long");
  if (!I0(t[0]) || !I0(t[1]))
    throw new Error("coordinates must contain numbers");
  return ai({
    type: "Point",
    coordinates: t
  }, e, r);
}
function _i(t, e, r = {}) {
  for (const n of t) {
    if (n.length < 4)
      throw new Error(
        "Each LinearRing of a Polygon must have 4 or more Positions."
      );
    if (n[n.length - 1].length !== n[0].length)
      throw new Error("First and last Position are not equivalent.");
    for (let i = 0; i < n[n.length - 1].length; i++)
      if (n[n.length - 1][i] !== n[0][i])
        throw new Error("First and last Position are not equivalent.");
  }
  return ai({
    type: "Polygon",
    coordinates: t
  }, e, r);
}
function $0(t, e, r = {}) {
  if (t.length < 2)
    throw new Error("coordinates must be an array of two or more positions");
  return ai({
    type: "LineString",
    coordinates: t
  }, e, r);
}
function Xe(t, e = {}) {
  const r = { type: "FeatureCollection" };
  return e.id && (r.id = e.id), e.bbox && (r.bbox = e.bbox), r.features = t, r;
}
function I0(t) {
  return !isNaN(t) && t !== null && !Array.isArray(t);
}
function AS(t) {
  if (!t)
    throw new Error("coord is required");
  if (!Array.isArray(t)) {
    if (t.type === "Feature" && t.geometry !== null && t.geometry.type === "Point")
      return [...t.geometry.coordinates];
    if (t.type === "Point")
      return [...t.coordinates];
  }
  if (Array.isArray(t) && t.length >= 2 && !Array.isArray(t[0]) && !Array.isArray(t[1]))
    return [...t];
  throw new Error("coord must be GeoJSON Point or an Array of numbers");
}
function NS(t) {
  return t.type === "Feature" ? t.geometry : t;
}
function Zh(t, e, r) {
  if (t !== null)
    for (var n, i, s, a, o, c, h, f = 0, u = 0, l, d = t.type, g = d === "FeatureCollection", w = d === "Feature", m = g ? t.features.length : 1, v = 0; v < m; v++) {
      h = g ? t.features[v].geometry : w ? t.geometry : t, l = h ? h.type === "GeometryCollection" : !1, o = l ? h.geometries.length : 1;
      for (var p = 0; p < o; p++) {
        var E = 0, _ = 0;
        if (a = l ? h.geometries[p] : h, a !== null) {
          c = a.coordinates;
          var y = a.type;
          switch (f = r && (y === "Polygon" || y === "MultiPolygon") ? 1 : 0, y) {
            case null:
              break;
            case "Point":
              if (e(
                c,
                u,
                v,
                E,
                _
              ) === !1)
                return !1;
              u++, E++;
              break;
            case "LineString":
            case "MultiPoint":
              for (n = 0; n < c.length; n++) {
                if (e(
                  c[n],
                  u,
                  v,
                  E,
                  _
                ) === !1)
                  return !1;
                u++, y === "MultiPoint" && E++;
              }
              y === "LineString" && E++;
              break;
            case "Polygon":
            case "MultiLineString":
              for (n = 0; n < c.length; n++) {
                for (i = 0; i < c[n].length - f; i++) {
                  if (e(
                    c[n][i],
                    u,
                    v,
                    E,
                    _
                  ) === !1)
                    return !1;
                  u++;
                }
                y === "MultiLineString" && E++, y === "Polygon" && _++;
              }
              y === "Polygon" && E++;
              break;
            case "MultiPolygon":
              for (n = 0; n < c.length; n++) {
                for (_ = 0, i = 0; i < c[n].length; i++) {
                  for (s = 0; s < c[n][i].length - f; s++) {
                    if (e(
                      c[n][i][s],
                      u,
                      v,
                      E,
                      _
                    ) === !1)
                      return !1;
                    u++;
                  }
                  _++;
                }
                E++;
              }
              break;
            case "GeometryCollection":
              for (n = 0; n < a.geometries.length; n++)
                if (Zh(a.geometries[n], e, r) === !1)
                  return !1;
              break;
            default:
              throw new Error("Unknown Geometry Type");
          }
        }
      }
    }
}
const we = 11102230246251565e-32, _t = 134217729, $p = (3 + 8 * we) * we;
function ee(t, e, r, n, i) {
  let s, a, o, c, h = e[0], f = n[0], u = 0, l = 0;
  f > h == f > -h ? (s = h, h = e[++u]) : (s = f, f = n[++l]);
  let d = 0;
  if (u < t && l < r)
    for (f > h == f > -h ? (a = h + s, o = s - (a - h), h = e[++u]) : (a = f + s, o = s - (a - f), f = n[++l]), s = a, o !== 0 && (i[d++] = o); u < t && l < r; )
      f > h == f > -h ? (a = s + h, c = a - s, o = s - (a - c) + (h - c), h = e[++u]) : (a = s + f, c = a - s, o = s - (a - c) + (f - c), f = n[++l]), s = a, o !== 0 && (i[d++] = o);
  for (; u < t; )
    a = s + h, c = a - s, o = s - (a - c) + (h - c), h = e[++u], s = a, o !== 0 && (i[d++] = o);
  for (; l < r; )
    a = s + f, c = a - s, o = s - (a - c) + (f - c), f = n[++l], s = a, o !== 0 && (i[d++] = o);
  return (s !== 0 || d === 0) && (i[d++] = s), d;
}
function Le(t, e, r, n, i, s, a, o) {
  return ee(ee(t, e, r, n, a), a, i, s, o);
}
function it(t, e, r, n) {
  let i, s, a, o, c, h, f, u, l, d, g;
  f = _t * r, d = f - (f - r), g = r - d;
  let w = e[0];
  i = w * r, f = _t * w, u = f - (f - w), l = w - u, a = l * g - (i - u * d - l * d - u * g);
  let m = 0;
  a !== 0 && (n[m++] = a);
  for (let v = 1; v < t; v++)
    w = e[v], o = w * r, f = _t * w, u = f - (f - w), l = w - u, c = l * g - (o - u * d - l * d - u * g), s = i + c, h = s - i, a = i - (s - h) + (c - h), a !== 0 && (n[m++] = a), i = o + s, a = s - (i - o), a !== 0 && (n[m++] = a);
  return (i !== 0 || m === 0) && (n[m++] = i), m;
}
function Ip(t, e) {
  let r = e[0];
  for (let n = 1; n < t; n++) r += e[n];
  return r;
}
function jt(t) {
  return new Float64Array(t);
}
const OS = (3 + 16 * we) * we, RS = (2 + 12 * we) * we, DS = (9 + 64 * we) * we * we, pn = jt(4), P0 = jt(8), A0 = jt(12), N0 = jt(16), Ee = jt(4);
function jS(t, e, r, n, i, s, a) {
  let o, c, h, f, u, l, d, g, w, m, v, p, E, _, y, b, S, x;
  const M = t - i, k = r - i, $ = e - s, O = n - s;
  _ = M * O, l = _t * M, d = l - (l - M), g = M - d, l = _t * O, w = l - (l - O), m = O - w, y = g * m - (_ - d * w - g * w - d * m), b = $ * k, l = _t * $, d = l - (l - $), g = $ - d, l = _t * k, w = l - (l - k), m = k - w, S = g * m - (b - d * w - g * w - d * m), v = y - S, u = y - v, pn[0] = y - (v + u) + (u - S), p = _ + v, u = p - _, E = _ - (p - u) + (v - u), v = E - b, u = E - v, pn[1] = E - (v + u) + (u - b), x = p + v, u = x - p, pn[2] = p - (x - u) + (v - u), pn[3] = x;
  let T = Ip(4, pn), I = RS * a;
  if (T >= I || -T >= I || (u = t - M, o = t - (M + u) + (u - i), u = r - k, h = r - (k + u) + (u - i), u = e - $, c = e - ($ + u) + (u - s), u = n - O, f = n - (O + u) + (u - s), o === 0 && c === 0 && h === 0 && f === 0) || (I = DS * a + $p * Math.abs(T), T += M * f + O * o - ($ * h + k * c), T >= I || -T >= I)) return T;
  _ = o * O, l = _t * o, d = l - (l - o), g = o - d, l = _t * O, w = l - (l - O), m = O - w, y = g * m - (_ - d * w - g * w - d * m), b = c * k, l = _t * c, d = l - (l - c), g = c - d, l = _t * k, w = l - (l - k), m = k - w, S = g * m - (b - d * w - g * w - d * m), v = y - S, u = y - v, Ee[0] = y - (v + u) + (u - S), p = _ + v, u = p - _, E = _ - (p - u) + (v - u), v = E - b, u = E - v, Ee[1] = E - (v + u) + (u - b), x = p + v, u = x - p, Ee[2] = p - (x - u) + (v - u), Ee[3] = x;
  const N = ee(4, pn, 4, Ee, P0);
  _ = M * f, l = _t * M, d = l - (l - M), g = M - d, l = _t * f, w = l - (l - f), m = f - w, y = g * m - (_ - d * w - g * w - d * m), b = $ * h, l = _t * $, d = l - (l - $), g = $ - d, l = _t * h, w = l - (l - h), m = h - w, S = g * m - (b - d * w - g * w - d * m), v = y - S, u = y - v, Ee[0] = y - (v + u) + (u - S), p = _ + v, u = p - _, E = _ - (p - u) + (v - u), v = E - b, u = E - v, Ee[1] = E - (v + u) + (u - b), x = p + v, u = x - p, Ee[2] = p - (x - u) + (v - u), Ee[3] = x;
  const j = ee(N, P0, 4, Ee, A0);
  _ = o * f, l = _t * o, d = l - (l - o), g = o - d, l = _t * f, w = l - (l - f), m = f - w, y = g * m - (_ - d * w - g * w - d * m), b = c * h, l = _t * c, d = l - (l - c), g = c - d, l = _t * h, w = l - (l - h), m = h - w, S = g * m - (b - d * w - g * w - d * m), v = y - S, u = y - v, Ee[0] = y - (v + u) + (u - S), p = _ + v, u = p - _, E = _ - (p - u) + (v - u), v = E - b, u = E - v, Ee[1] = E - (v + u) + (u - b), x = p + v, u = x - p, Ee[2] = p - (x - u) + (v - u), Ee[3] = x;
  const C = ee(j, A0, 4, Ee, N0);
  return N0[C - 1];
}
function hr(t, e, r, n, i, s) {
  const a = (e - s) * (r - i), o = (t - i) * (n - s), c = a - o, h = Math.abs(a + o);
  return Math.abs(c) >= OS * h ? c : -jS(t, e, r, n, i, s, h);
}
const TS = (10 + 96 * we) * we, CS = (4 + 48 * we) * we, LS = (44 + 576 * we) * we * we, Ir = jt(4), Pr = jt(4), Ar = jt(4), ir = jt(4), sr = jt(4), ar = jt(4), be = jt(4), Se = jt(4), Kc = jt(8), Xc = jt(8), Wc = jt(8), Jc = jt(8), Yc = jt(8), Qc = jt(8), As = jt(8), Ns = jt(8), Os = jt(8), Wr = jt(4), Jr = jt(4), Yr = jt(4), bt = jt(8), Mt = jt(16), Ft = jt(16), Gt = jt(16), Tt = jt(32), Nr = jt(32), Vt = jt(48), $e = jt(64);
let $n = jt(1152), th = jt(1152);
function Ht(t, e, r) {
  t = ee(t, $n, e, r, th);
  const n = $n;
  return $n = th, th = n, t;
}
function FS(t, e, r, n, i, s, a, o, c) {
  let h, f, u, l, d, g, w, m, v, p, E, _, y, b, S, x, M, k, $, O, T, I, N, j, C, F, q, R, D, G, L, A, P, U, K;
  const J = t - a, et = r - a, rt = i - a, z = e - o, B = n - o, X = s - o;
  L = et * X, N = _t * et, j = N - (N - et), C = et - j, N = _t * X, F = N - (N - X), q = X - F, A = C * q - (L - j * F - C * F - j * q), P = rt * B, N = _t * rt, j = N - (N - rt), C = rt - j, N = _t * B, F = N - (N - B), q = B - F, U = C * q - (P - j * F - C * F - j * q), R = A - U, I = A - R, Ir[0] = A - (R + I) + (I - U), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G - P, I = G - R, Ir[1] = G - (R + I) + (I - P), K = D + R, I = K - D, Ir[2] = D - (K - I) + (R - I), Ir[3] = K, L = rt * z, N = _t * rt, j = N - (N - rt), C = rt - j, N = _t * z, F = N - (N - z), q = z - F, A = C * q - (L - j * F - C * F - j * q), P = J * X, N = _t * J, j = N - (N - J), C = J - j, N = _t * X, F = N - (N - X), q = X - F, U = C * q - (P - j * F - C * F - j * q), R = A - U, I = A - R, Pr[0] = A - (R + I) + (I - U), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G - P, I = G - R, Pr[1] = G - (R + I) + (I - P), K = D + R, I = K - D, Pr[2] = D - (K - I) + (R - I), Pr[3] = K, L = J * B, N = _t * J, j = N - (N - J), C = J - j, N = _t * B, F = N - (N - B), q = B - F, A = C * q - (L - j * F - C * F - j * q), P = et * z, N = _t * et, j = N - (N - et), C = et - j, N = _t * z, F = N - (N - z), q = z - F, U = C * q - (P - j * F - C * F - j * q), R = A - U, I = A - R, Ar[0] = A - (R + I) + (I - U), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G - P, I = G - R, Ar[1] = G - (R + I) + (I - P), K = D + R, I = K - D, Ar[2] = D - (K - I) + (R - I), Ar[3] = K, h = ee(
    ee(
      ee(
        it(it(4, Ir, J, bt), bt, J, Mt),
        Mt,
        it(it(4, Ir, z, bt), bt, z, Ft),
        Ft,
        Tt
      ),
      Tt,
      ee(
        it(it(4, Pr, et, bt), bt, et, Mt),
        Mt,
        it(it(4, Pr, B, bt), bt, B, Ft),
        Ft,
        Nr
      ),
      Nr,
      $e
    ),
    $e,
    ee(
      it(it(4, Ar, rt, bt), bt, rt, Mt),
      Mt,
      it(it(4, Ar, X, bt), bt, X, Ft),
      Ft,
      Tt
    ),
    Tt,
    $n
  );
  let Y = Ip(h, $n), nt = CS * c;
  if (Y >= nt || -Y >= nt || (I = t - J, f = t - (J + I) + (I - a), I = e - z, d = e - (z + I) + (I - o), I = r - et, u = r - (et + I) + (I - a), I = n - B, g = n - (B + I) + (I - o), I = i - rt, l = i - (rt + I) + (I - a), I = s - X, w = s - (X + I) + (I - o), f === 0 && u === 0 && l === 0 && d === 0 && g === 0 && w === 0) || (nt = LS * c + $p * Math.abs(Y), Y += (J * J + z * z) * (et * w + X * u - (B * l + rt * g)) + 2 * (J * f + z * d) * (et * X - B * rt) + ((et * et + B * B) * (rt * d + z * l - (X * f + J * w)) + 2 * (et * u + B * g) * (rt * z - X * J)) + ((rt * rt + X * X) * (J * g + B * f - (z * u + et * d)) + 2 * (rt * l + X * w) * (J * B - z * et)), Y >= nt || -Y >= nt))
    return Y;
  if ((u !== 0 || g !== 0 || l !== 0 || w !== 0) && (L = J * J, N = _t * J, j = N - (N - J), C = J - j, A = C * C - (L - j * j - (j + j) * C), P = z * z, N = _t * z, j = N - (N - z), C = z - j, U = C * C - (P - j * j - (j + j) * C), R = A + U, I = R - A, ir[0] = A - (R - I) + (U - I), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G + P, I = R - G, ir[1] = G - (R - I) + (P - I), K = D + R, I = K - D, ir[2] = D - (K - I) + (R - I), ir[3] = K), (l !== 0 || w !== 0 || f !== 0 || d !== 0) && (L = et * et, N = _t * et, j = N - (N - et), C = et - j, A = C * C - (L - j * j - (j + j) * C), P = B * B, N = _t * B, j = N - (N - B), C = B - j, U = C * C - (P - j * j - (j + j) * C), R = A + U, I = R - A, sr[0] = A - (R - I) + (U - I), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G + P, I = R - G, sr[1] = G - (R - I) + (P - I), K = D + R, I = K - D, sr[2] = D - (K - I) + (R - I), sr[3] = K), (f !== 0 || d !== 0 || u !== 0 || g !== 0) && (L = rt * rt, N = _t * rt, j = N - (N - rt), C = rt - j, A = C * C - (L - j * j - (j + j) * C), P = X * X, N = _t * X, j = N - (N - X), C = X - j, U = C * C - (P - j * j - (j + j) * C), R = A + U, I = R - A, ar[0] = A - (R - I) + (U - I), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G + P, I = R - G, ar[1] = G - (R - I) + (P - I), K = D + R, I = K - D, ar[2] = D - (K - I) + (R - I), ar[3] = K), f !== 0 && (m = it(4, Ir, f, Kc), h = Ht(h, Le(
    it(m, Kc, 2 * J, Mt),
    Mt,
    it(it(4, ar, f, bt), bt, B, Ft),
    Ft,
    it(it(4, sr, f, bt), bt, -X, Gt),
    Gt,
    Tt,
    Vt
  ), Vt)), d !== 0 && (v = it(4, Ir, d, Xc), h = Ht(h, Le(
    it(v, Xc, 2 * z, Mt),
    Mt,
    it(it(4, sr, d, bt), bt, rt, Ft),
    Ft,
    it(it(4, ar, d, bt), bt, -et, Gt),
    Gt,
    Tt,
    Vt
  ), Vt)), u !== 0 && (p = it(4, Pr, u, Wc), h = Ht(h, Le(
    it(p, Wc, 2 * et, Mt),
    Mt,
    it(it(4, ir, u, bt), bt, X, Ft),
    Ft,
    it(it(4, ar, u, bt), bt, -z, Gt),
    Gt,
    Tt,
    Vt
  ), Vt)), g !== 0 && (E = it(4, Pr, g, Jc), h = Ht(h, Le(
    it(E, Jc, 2 * B, Mt),
    Mt,
    it(it(4, ar, g, bt), bt, J, Ft),
    Ft,
    it(it(4, ir, g, bt), bt, -rt, Gt),
    Gt,
    Tt,
    Vt
  ), Vt)), l !== 0 && (_ = it(4, Ar, l, Yc), h = Ht(h, Le(
    it(_, Yc, 2 * rt, Mt),
    Mt,
    it(it(4, sr, l, bt), bt, z, Ft),
    Ft,
    it(it(4, ir, l, bt), bt, -B, Gt),
    Gt,
    Tt,
    Vt
  ), Vt)), w !== 0 && (y = it(4, Ar, w, Qc), h = Ht(h, Le(
    it(y, Qc, 2 * X, Mt),
    Mt,
    it(it(4, ir, w, bt), bt, et, Ft),
    Ft,
    it(it(4, sr, w, bt), bt, -J, Gt),
    Gt,
    Tt,
    Vt
  ), Vt)), f !== 0 || d !== 0) {
    if (u !== 0 || g !== 0 || l !== 0 || w !== 0 ? (L = u * X, N = _t * u, j = N - (N - u), C = u - j, N = _t * X, F = N - (N - X), q = X - F, A = C * q - (L - j * F - C * F - j * q), P = et * w, N = _t * et, j = N - (N - et), C = et - j, N = _t * w, F = N - (N - w), q = w - F, U = C * q - (P - j * F - C * F - j * q), R = A + U, I = R - A, be[0] = A - (R - I) + (U - I), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G + P, I = R - G, be[1] = G - (R - I) + (P - I), K = D + R, I = K - D, be[2] = D - (K - I) + (R - I), be[3] = K, L = l * -B, N = _t * l, j = N - (N - l), C = l - j, N = _t * -B, F = N - (N - -B), q = -B - F, A = C * q - (L - j * F - C * F - j * q), P = rt * -g, N = _t * rt, j = N - (N - rt), C = rt - j, N = _t * -g, F = N - (N - -g), q = -g - F, U = C * q - (P - j * F - C * F - j * q), R = A + U, I = R - A, Se[0] = A - (R - I) + (U - I), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G + P, I = R - G, Se[1] = G - (R - I) + (P - I), K = D + R, I = K - D, Se[2] = D - (K - I) + (R - I), Se[3] = K, S = ee(4, be, 4, Se, Ns), L = u * w, N = _t * u, j = N - (N - u), C = u - j, N = _t * w, F = N - (N - w), q = w - F, A = C * q - (L - j * F - C * F - j * q), P = l * g, N = _t * l, j = N - (N - l), C = l - j, N = _t * g, F = N - (N - g), q = g - F, U = C * q - (P - j * F - C * F - j * q), R = A - U, I = A - R, Jr[0] = A - (R + I) + (I - U), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G - P, I = G - R, Jr[1] = G - (R + I) + (I - P), K = D + R, I = K - D, Jr[2] = D - (K - I) + (R - I), Jr[3] = K, k = 4) : (Ns[0] = 0, S = 1, Jr[0] = 0, k = 1), f !== 0) {
      const vt = it(S, Ns, f, Gt);
      h = Ht(h, ee(
        it(m, Kc, f, Mt),
        Mt,
        it(vt, Gt, 2 * J, Tt),
        Tt,
        Vt
      ), Vt);
      const xt = it(k, Jr, f, bt);
      h = Ht(h, Le(
        it(xt, bt, 2 * J, Mt),
        Mt,
        it(xt, bt, f, Ft),
        Ft,
        it(vt, Gt, f, Tt),
        Tt,
        Nr,
        $e
      ), $e), g !== 0 && (h = Ht(h, it(it(4, ar, f, bt), bt, g, Mt), Mt)), w !== 0 && (h = Ht(h, it(it(4, sr, -f, bt), bt, w, Mt), Mt));
    }
    if (d !== 0) {
      const vt = it(S, Ns, d, Gt);
      h = Ht(h, ee(
        it(v, Xc, d, Mt),
        Mt,
        it(vt, Gt, 2 * z, Tt),
        Tt,
        Vt
      ), Vt);
      const xt = it(k, Jr, d, bt);
      h = Ht(h, Le(
        it(xt, bt, 2 * z, Mt),
        Mt,
        it(xt, bt, d, Ft),
        Ft,
        it(vt, Gt, d, Tt),
        Tt,
        Nr,
        $e
      ), $e);
    }
  }
  if (u !== 0 || g !== 0) {
    if (l !== 0 || w !== 0 || f !== 0 || d !== 0 ? (L = l * z, N = _t * l, j = N - (N - l), C = l - j, N = _t * z, F = N - (N - z), q = z - F, A = C * q - (L - j * F - C * F - j * q), P = rt * d, N = _t * rt, j = N - (N - rt), C = rt - j, N = _t * d, F = N - (N - d), q = d - F, U = C * q - (P - j * F - C * F - j * q), R = A + U, I = R - A, be[0] = A - (R - I) + (U - I), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G + P, I = R - G, be[1] = G - (R - I) + (P - I), K = D + R, I = K - D, be[2] = D - (K - I) + (R - I), be[3] = K, O = -X, T = -w, L = f * O, N = _t * f, j = N - (N - f), C = f - j, N = _t * O, F = N - (N - O), q = O - F, A = C * q - (L - j * F - C * F - j * q), P = J * T, N = _t * J, j = N - (N - J), C = J - j, N = _t * T, F = N - (N - T), q = T - F, U = C * q - (P - j * F - C * F - j * q), R = A + U, I = R - A, Se[0] = A - (R - I) + (U - I), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G + P, I = R - G, Se[1] = G - (R - I) + (P - I), K = D + R, I = K - D, Se[2] = D - (K - I) + (R - I), Se[3] = K, x = ee(4, be, 4, Se, Os), L = l * d, N = _t * l, j = N - (N - l), C = l - j, N = _t * d, F = N - (N - d), q = d - F, A = C * q - (L - j * F - C * F - j * q), P = f * w, N = _t * f, j = N - (N - f), C = f - j, N = _t * w, F = N - (N - w), q = w - F, U = C * q - (P - j * F - C * F - j * q), R = A - U, I = A - R, Yr[0] = A - (R + I) + (I - U), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G - P, I = G - R, Yr[1] = G - (R + I) + (I - P), K = D + R, I = K - D, Yr[2] = D - (K - I) + (R - I), Yr[3] = K, $ = 4) : (Os[0] = 0, x = 1, Yr[0] = 0, $ = 1), u !== 0) {
      const vt = it(x, Os, u, Gt);
      h = Ht(h, ee(
        it(p, Wc, u, Mt),
        Mt,
        it(vt, Gt, 2 * et, Tt),
        Tt,
        Vt
      ), Vt);
      const xt = it($, Yr, u, bt);
      h = Ht(h, Le(
        it(xt, bt, 2 * et, Mt),
        Mt,
        it(xt, bt, u, Ft),
        Ft,
        it(vt, Gt, u, Tt),
        Tt,
        Nr,
        $e
      ), $e), w !== 0 && (h = Ht(h, it(it(4, ir, u, bt), bt, w, Mt), Mt)), d !== 0 && (h = Ht(h, it(it(4, ar, -u, bt), bt, d, Mt), Mt));
    }
    if (g !== 0) {
      const vt = it(x, Os, g, Gt);
      h = Ht(h, ee(
        it(E, Jc, g, Mt),
        Mt,
        it(vt, Gt, 2 * B, Tt),
        Tt,
        Vt
      ), Vt);
      const xt = it($, Yr, g, bt);
      h = Ht(h, Le(
        it(xt, bt, 2 * B, Mt),
        Mt,
        it(xt, bt, g, Ft),
        Ft,
        it(vt, Gt, g, Tt),
        Tt,
        Nr,
        $e
      ), $e);
    }
  }
  if (l !== 0 || w !== 0) {
    if (f !== 0 || d !== 0 || u !== 0 || g !== 0 ? (L = f * B, N = _t * f, j = N - (N - f), C = f - j, N = _t * B, F = N - (N - B), q = B - F, A = C * q - (L - j * F - C * F - j * q), P = J * g, N = _t * J, j = N - (N - J), C = J - j, N = _t * g, F = N - (N - g), q = g - F, U = C * q - (P - j * F - C * F - j * q), R = A + U, I = R - A, be[0] = A - (R - I) + (U - I), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G + P, I = R - G, be[1] = G - (R - I) + (P - I), K = D + R, I = K - D, be[2] = D - (K - I) + (R - I), be[3] = K, O = -z, T = -d, L = u * O, N = _t * u, j = N - (N - u), C = u - j, N = _t * O, F = N - (N - O), q = O - F, A = C * q - (L - j * F - C * F - j * q), P = et * T, N = _t * et, j = N - (N - et), C = et - j, N = _t * T, F = N - (N - T), q = T - F, U = C * q - (P - j * F - C * F - j * q), R = A + U, I = R - A, Se[0] = A - (R - I) + (U - I), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G + P, I = R - G, Se[1] = G - (R - I) + (P - I), K = D + R, I = K - D, Se[2] = D - (K - I) + (R - I), Se[3] = K, b = ee(4, be, 4, Se, As), L = f * g, N = _t * f, j = N - (N - f), C = f - j, N = _t * g, F = N - (N - g), q = g - F, A = C * q - (L - j * F - C * F - j * q), P = u * d, N = _t * u, j = N - (N - u), C = u - j, N = _t * d, F = N - (N - d), q = d - F, U = C * q - (P - j * F - C * F - j * q), R = A - U, I = A - R, Wr[0] = A - (R + I) + (I - U), D = L + R, I = D - L, G = L - (D - I) + (R - I), R = G - P, I = G - R, Wr[1] = G - (R + I) + (I - P), K = D + R, I = K - D, Wr[2] = D - (K - I) + (R - I), Wr[3] = K, M = 4) : (As[0] = 0, b = 1, Wr[0] = 0, M = 1), l !== 0) {
      const vt = it(b, As, l, Gt);
      h = Ht(h, ee(
        it(_, Yc, l, Mt),
        Mt,
        it(vt, Gt, 2 * rt, Tt),
        Tt,
        Vt
      ), Vt);
      const xt = it(M, Wr, l, bt);
      h = Ht(h, Le(
        it(xt, bt, 2 * rt, Mt),
        Mt,
        it(xt, bt, l, Ft),
        Ft,
        it(vt, Gt, l, Tt),
        Tt,
        Nr,
        $e
      ), $e), d !== 0 && (h = Ht(h, it(it(4, sr, l, bt), bt, d, Mt), Mt)), g !== 0 && (h = Ht(h, it(it(4, ir, -l, bt), bt, g, Mt), Mt));
    }
    if (w !== 0) {
      const vt = it(b, As, w, Gt);
      h = Ht(h, ee(
        it(y, Qc, w, Mt),
        Mt,
        it(vt, Gt, 2 * X, Tt),
        Tt,
        Vt
      ), Vt);
      const xt = it(M, Wr, w, bt);
      h = Ht(h, Le(
        it(xt, bt, 2 * X, Mt),
        Mt,
        it(xt, bt, w, Ft),
        Ft,
        it(vt, Gt, w, Tt),
        Tt,
        Nr,
        $e
      ), $e);
    }
  }
  return $n[h - 1];
}
function GS(t, e, r, n, i, s, a, o) {
  const c = t - a, h = r - a, f = i - a, u = e - o, l = n - o, d = s - o, g = h * d, w = f * l, m = c * c + u * u, v = f * u, p = c * d, E = h * h + l * l, _ = c * l, y = h * u, b = f * f + d * d, S = m * (g - w) + E * (v - p) + b * (_ - y), x = (Math.abs(g) + Math.abs(w)) * m + (Math.abs(v) + Math.abs(p)) * E + (Math.abs(_) + Math.abs(y)) * b, M = TS * x;
  return S > M || -S > M ? S : FS(t, e, r, n, i, s, a, o, x);
}
function zS(t, e) {
  var r, n, i = 0, s, a, o, c, h, f, u, l = t[0], d = t[1], g = e.length;
  for (r = 0; r < g; r++) {
    n = 0;
    var w = e[r], m = w.length - 1;
    if (f = w[0], f[0] !== w[m][0] && f[1] !== w[m][1])
      throw new Error("First and last coordinates in a ring must be the same");
    for (a = f[0] - l, o = f[1] - d, n; n < m; n++) {
      if (u = w[n + 1], c = u[0] - l, h = u[1] - d, o === 0 && h === 0) {
        if (c <= 0 && a >= 0 || a <= 0 && c >= 0)
          return 0;
      } else if (h >= 0 && o <= 0 || h <= 0 && o >= 0) {
        if (s = hr(a, c, o, h, 0, 0), s === 0)
          return 0;
        (s > 0 && h > 0 && o <= 0 || s < 0 && h <= 0 && o > 0) && i++;
      }
      f = u, o = h, a = c;
    }
  }
  return i % 2 !== 0;
}
function eh(t, e, r = {}) {
  if (!t)
    throw new Error("point is required");
  if (!e)
    throw new Error("polygon is required");
  const n = AS(t), i = NS(e), s = i.type, a = e.bbox;
  let o = i.coordinates;
  if (a && qS(n, a) === !1)
    return !1;
  s === "Polygon" && (o = [o]);
  let c = !1;
  for (var h = 0; h < o.length; ++h) {
    const f = zS(n, o[h]);
    if (f === 0) return !r.ignoreBoundary;
    f && (c = !0);
  }
  return c;
}
function qS(t, e) {
  return e[0] <= t[0] && e[1] <= t[1] && e[2] >= t[0] && e[3] >= t[1];
}
let Pp = class {
  constructor(t = [], e = US) {
    if (this.data = t, this.length = this.data.length, this.compare = e, this.length > 0)
      for (let r = (this.length >> 1) - 1; r >= 0; r--) this._down(r);
  }
  push(t) {
    this.data.push(t), this.length++, this._up(this.length - 1);
  }
  pop() {
    if (this.length === 0) return;
    const t = this.data[0], e = this.data.pop();
    return this.length--, this.length > 0 && (this.data[0] = e, this._down(0)), t;
  }
  peek() {
    return this.data[0];
  }
  _up(t) {
    const { data: e, compare: r } = this, n = e[t];
    for (; t > 0; ) {
      const i = t - 1 >> 1, s = e[i];
      if (r(n, s) >= 0) break;
      e[t] = s, t = i;
    }
    e[t] = n;
  }
  _down(t) {
    const { data: e, compare: r } = this, n = this.length >> 1, i = e[t];
    for (; t < n; ) {
      let s = (t << 1) + 1, a = e[s];
      const o = s + 1;
      if (o < this.length && r(e[o], a) < 0 && (s = o, a = e[o]), r(a, i) >= 0) break;
      e[t] = a, t = s;
    }
    e[t] = i;
  }
};
function US(t, e) {
  return t < e ? -1 : t > e ? 1 : 0;
}
function Ap(t, e) {
  return t.p.x > e.p.x ? 1 : t.p.x < e.p.x ? -1 : t.p.y !== e.p.y ? t.p.y > e.p.y ? 1 : -1 : 1;
}
function BS(t, e) {
  return t.rightSweepEvent.p.x > e.rightSweepEvent.p.x ? 1 : t.rightSweepEvent.p.x < e.rightSweepEvent.p.x ? -1 : t.rightSweepEvent.p.y !== e.rightSweepEvent.p.y ? t.rightSweepEvent.p.y < e.rightSweepEvent.p.y ? 1 : -1 : 1;
}
class O0 {
  constructor(e, r, n, i) {
    this.p = {
      x: e[0],
      y: e[1]
    }, this.featureId = r, this.ringId = n, this.eventId = i, this.otherEvent = null, this.isLeftEndpoint = null;
  }
  isSamePoint(e) {
    return this.p.x === e.p.x && this.p.y === e.p.y;
  }
}
function ZS(t, e) {
  if (t.type === "FeatureCollection") {
    const r = t.features;
    for (let n = 0; n < r.length; n++)
      R0(r[n], e);
  } else
    R0(t, e);
}
let Rs = 0, Ds = 0, js = 0;
function R0(t, e) {
  const r = t.type === "Feature" ? t.geometry : t;
  let n = r.coordinates;
  (r.type === "Polygon" || r.type === "MultiLineString") && (n = [n]), r.type === "LineString" && (n = [[n]]);
  for (let i = 0; i < n.length; i++)
    for (let s = 0; s < n[i].length; s++) {
      let a = n[i][s][0], o = null;
      Ds = Ds + 1;
      for (let c = 0; c < n[i][s].length - 1; c++) {
        o = n[i][s][c + 1];
        const h = new O0(a, Rs, Ds, js), f = new O0(o, Rs, Ds, js + 1);
        h.otherEvent = f, f.otherEvent = h, Ap(h, f) > 0 ? (f.isLeftEndpoint = !0, h.isLeftEndpoint = !1) : (h.isLeftEndpoint = !0, f.isLeftEndpoint = !1), e.push(h), e.push(f), a = o, js = js + 1;
      }
    }
  Rs = Rs + 1;
}
class VS {
  constructor(e) {
    this.leftSweepEvent = e, this.rightSweepEvent = e.otherEvent;
  }
}
function HS(t, e) {
  if (t === null || e === null || t.leftSweepEvent.ringId === e.leftSweepEvent.ringId && (t.rightSweepEvent.isSamePoint(e.leftSweepEvent) || t.rightSweepEvent.isSamePoint(e.leftSweepEvent) || t.rightSweepEvent.isSamePoint(e.rightSweepEvent) || t.leftSweepEvent.isSamePoint(e.leftSweepEvent) || t.leftSweepEvent.isSamePoint(e.rightSweepEvent))) return !1;
  const r = t.leftSweepEvent.p.x, n = t.leftSweepEvent.p.y, i = t.rightSweepEvent.p.x, s = t.rightSweepEvent.p.y, a = e.leftSweepEvent.p.x, o = e.leftSweepEvent.p.y, c = e.rightSweepEvent.p.x, h = e.rightSweepEvent.p.y, f = (h - o) * (i - r) - (c - a) * (s - n), u = (c - a) * (n - o) - (h - o) * (r - a), l = (i - r) * (n - o) - (s - n) * (r - a);
  if (f === 0)
    return !1;
  const d = u / f, g = l / f;
  if (d >= 0 && d <= 1 && g >= 0 && g <= 1) {
    const w = r + d * (i - r), m = n + d * (s - n);
    return [w, m];
  }
  return !1;
}
function KS(t, e) {
  e = e || !1;
  const r = [], n = new Pp([], BS);
  for (; t.length; ) {
    const i = t.pop();
    if (i.isLeftEndpoint) {
      const s = new VS(i);
      for (let a = 0; a < n.data.length; a++) {
        const o = n.data[a];
        if (e && o.leftSweepEvent.featureId === i.featureId)
          continue;
        const c = HS(s, o);
        c !== !1 && r.push(c);
      }
      n.push(s);
    } else i.isLeftEndpoint === !1 && n.pop();
  }
  return r;
}
function XS(t, e) {
  const r = new Pp([], Ap);
  return ZS(t, r), KS(r, e);
}
var WS = XS;
function JS(t, e, r = {}) {
  const { removeDuplicates: n = !0, ignoreSelfIntersections: i = !0 } = r;
  let s = [];
  t.type === "FeatureCollection" ? s = s.concat(t.features) : t.type === "Feature" ? s.push(t) : (t.type === "LineString" || t.type === "Polygon" || t.type === "MultiLineString" || t.type === "MultiPolygon") && s.push(ai(t)), e.type === "FeatureCollection" ? s = s.concat(e.features) : e.type === "Feature" ? s.push(e) : (e.type === "LineString" || e.type === "Polygon" || e.type === "MultiLineString" || e.type === "MultiPolygon") && s.push(ai(e));
  const a = WS(
    Xe(s),
    i
  );
  let o = [];
  if (n) {
    const c = {};
    a.forEach((h) => {
      const f = h.join(",");
      c[f] || (c[f] = !0, o.push(h));
    });
  } else
    o = a;
  return Xe(o.map((c) => Cr(c)));
}
function YS(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
function QS(t) {
  if (Object.prototype.hasOwnProperty.call(t, "__esModule")) return t;
  var e = t.default;
  if (typeof e == "function") {
    var r = function n() {
      var i = !1;
      try {
        i = this instanceof n;
      } catch {
      }
      return i ? Reflect.construct(e, arguments, this.constructor) : e.apply(this, arguments);
    };
    r.prototype = e.prototype;
  } else r = {};
  return Object.defineProperty(r, "__esModule", { value: !0 }), Object.keys(t).forEach(function(n) {
    var i = Object.getOwnPropertyDescriptor(t, n);
    Object.defineProperty(r, n, i.get ? i : {
      enumerable: !0,
      get: function() {
        return t[n];
      }
    });
  }), r;
}
function tM(t, e = {}) {
  let r = 0, n = 0, i = 0;
  return Zh(
    t,
    function(s) {
      r += s[0], n += s[1], i++;
    },
    !0
  ), Cr([r / i, n / i], e.properties);
}
var Ts = { exports: {} }, mh = { exports: {} }, eM = mh.exports, D0;
function rM() {
  return D0 || (D0 = 1, (function(t, e) {
    (function(r, n) {
      t.exports = n();
    })(eM, function() {
      function r(p, E, _, y, b) {
        (function S(x, M, k, $, O) {
          for (; $ > k; ) {
            if ($ - k > 600) {
              var T = $ - k + 1, I = M - k + 1, N = Math.log(T), j = 0.5 * Math.exp(2 * N / 3), C = 0.5 * Math.sqrt(N * j * (T - j) / T) * (I - T / 2 < 0 ? -1 : 1), F = Math.max(k, Math.floor(M - I * j / T + C)), q = Math.min($, Math.floor(M + (T - I) * j / T + C));
              S(x, M, F, q, O);
            }
            var R = x[M], D = k, G = $;
            for (n(x, k, M), O(x[$], R) > 0 && n(x, k, $); D < G; ) {
              for (n(x, D, G), D++, G--; O(x[D], R) < 0; ) D++;
              for (; O(x[G], R) > 0; ) G--;
            }
            O(x[k], R) === 0 ? n(x, k, G) : n(x, ++G, $), G <= M && (k = G + 1), M <= G && ($ = G - 1);
          }
        })(p, E, _ || 0, y || p.length - 1, b || i);
      }
      function n(p, E, _) {
        var y = p[E];
        p[E] = p[_], p[_] = y;
      }
      function i(p, E) {
        return p < E ? -1 : p > E ? 1 : 0;
      }
      var s = function(p) {
        p === void 0 && (p = 9), this._maxEntries = Math.max(4, p), this._minEntries = Math.max(2, Math.ceil(0.4 * this._maxEntries)), this.clear();
      };
      function a(p, E, _) {
        if (!_) return E.indexOf(p);
        for (var y = 0; y < E.length; y++) if (_(p, E[y])) return y;
        return -1;
      }
      function o(p, E) {
        c(p, 0, p.children.length, E, p);
      }
      function c(p, E, _, y, b) {
        b || (b = m(null)), b.minX = 1 / 0, b.minY = 1 / 0, b.maxX = -1 / 0, b.maxY = -1 / 0;
        for (var S = E; S < _; S++) {
          var x = p.children[S];
          h(b, p.leaf ? y(x) : x);
        }
        return b;
      }
      function h(p, E) {
        return p.minX = Math.min(p.minX, E.minX), p.minY = Math.min(p.minY, E.minY), p.maxX = Math.max(p.maxX, E.maxX), p.maxY = Math.max(p.maxY, E.maxY), p;
      }
      function f(p, E) {
        return p.minX - E.minX;
      }
      function u(p, E) {
        return p.minY - E.minY;
      }
      function l(p) {
        return (p.maxX - p.minX) * (p.maxY - p.minY);
      }
      function d(p) {
        return p.maxX - p.minX + (p.maxY - p.minY);
      }
      function g(p, E) {
        return p.minX <= E.minX && p.minY <= E.minY && E.maxX <= p.maxX && E.maxY <= p.maxY;
      }
      function w(p, E) {
        return E.minX <= p.maxX && E.minY <= p.maxY && E.maxX >= p.minX && E.maxY >= p.minY;
      }
      function m(p) {
        return { children: p, height: 1, leaf: !0, minX: 1 / 0, minY: 1 / 0, maxX: -1 / 0, maxY: -1 / 0 };
      }
      function v(p, E, _, y, b) {
        for (var S = [E, _]; S.length; ) if (!((_ = S.pop()) - (E = S.pop()) <= y)) {
          var x = E + Math.ceil((_ - E) / y / 2) * y;
          r(p, x, E, _, b), S.push(E, x, x, _);
        }
      }
      return s.prototype.all = function() {
        return this._all(this.data, []);
      }, s.prototype.search = function(p) {
        var E = this.data, _ = [];
        if (!w(p, E)) return _;
        for (var y = this.toBBox, b = []; E; ) {
          for (var S = 0; S < E.children.length; S++) {
            var x = E.children[S], M = E.leaf ? y(x) : x;
            w(p, M) && (E.leaf ? _.push(x) : g(p, M) ? this._all(x, _) : b.push(x));
          }
          E = b.pop();
        }
        return _;
      }, s.prototype.collides = function(p) {
        var E = this.data;
        if (!w(p, E)) return !1;
        for (var _ = []; E; ) {
          for (var y = 0; y < E.children.length; y++) {
            var b = E.children[y], S = E.leaf ? this.toBBox(b) : b;
            if (w(p, S)) {
              if (E.leaf || g(p, S)) return !0;
              _.push(b);
            }
          }
          E = _.pop();
        }
        return !1;
      }, s.prototype.load = function(p) {
        if (!p || !p.length) return this;
        if (p.length < this._minEntries) {
          for (var E = 0; E < p.length; E++) this.insert(p[E]);
          return this;
        }
        var _ = this._build(p.slice(), 0, p.length - 1, 0);
        if (this.data.children.length) if (this.data.height === _.height) this._splitRoot(this.data, _);
        else {
          if (this.data.height < _.height) {
            var y = this.data;
            this.data = _, _ = y;
          }
          this._insert(_, this.data.height - _.height - 1, !0);
        }
        else this.data = _;
        return this;
      }, s.prototype.insert = function(p) {
        return p && this._insert(p, this.data.height - 1), this;
      }, s.prototype.clear = function() {
        return this.data = m([]), this;
      }, s.prototype.remove = function(p, E) {
        if (!p) return this;
        for (var _, y, b, S = this.data, x = this.toBBox(p), M = [], k = []; S || M.length; ) {
          if (S || (S = M.pop(), y = M[M.length - 1], _ = k.pop(), b = !0), S.leaf) {
            var $ = a(p, S.children, E);
            if ($ !== -1) return S.children.splice($, 1), M.push(S), this._condense(M), this;
          }
          b || S.leaf || !g(S, x) ? y ? (_++, S = y.children[_], b = !1) : S = null : (M.push(S), k.push(_), _ = 0, y = S, S = S.children[0]);
        }
        return this;
      }, s.prototype.toBBox = function(p) {
        return p;
      }, s.prototype.compareMinX = function(p, E) {
        return p.minX - E.minX;
      }, s.prototype.compareMinY = function(p, E) {
        return p.minY - E.minY;
      }, s.prototype.toJSON = function() {
        return this.data;
      }, s.prototype.fromJSON = function(p) {
        return this.data = p, this;
      }, s.prototype._all = function(p, E) {
        for (var _ = []; p; ) p.leaf ? E.push.apply(E, p.children) : _.push.apply(_, p.children), p = _.pop();
        return E;
      }, s.prototype._build = function(p, E, _, y) {
        var b, S = _ - E + 1, x = this._maxEntries;
        if (S <= x) return o(b = m(p.slice(E, _ + 1)), this.toBBox), b;
        y || (y = Math.ceil(Math.log(S) / Math.log(x)), x = Math.ceil(S / Math.pow(x, y - 1))), (b = m([])).leaf = !1, b.height = y;
        var M = Math.ceil(S / x), k = M * Math.ceil(Math.sqrt(x));
        v(p, E, _, k, this.compareMinX);
        for (var $ = E; $ <= _; $ += k) {
          var O = Math.min($ + k - 1, _);
          v(p, $, O, M, this.compareMinY);
          for (var T = $; T <= O; T += M) {
            var I = Math.min(T + M - 1, O);
            b.children.push(this._build(p, T, I, y - 1));
          }
        }
        return o(b, this.toBBox), b;
      }, s.prototype._chooseSubtree = function(p, E, _, y) {
        for (; y.push(E), !E.leaf && y.length - 1 !== _; ) {
          for (var b = 1 / 0, S = 1 / 0, x = void 0, M = 0; M < E.children.length; M++) {
            var k = E.children[M], $ = l(k), O = (T = p, I = k, (Math.max(I.maxX, T.maxX) - Math.min(I.minX, T.minX)) * (Math.max(I.maxY, T.maxY) - Math.min(I.minY, T.minY)) - $);
            O < S ? (S = O, b = $ < b ? $ : b, x = k) : O === S && $ < b && (b = $, x = k);
          }
          E = x || E.children[0];
        }
        var T, I;
        return E;
      }, s.prototype._insert = function(p, E, _) {
        var y = _ ? p : this.toBBox(p), b = [], S = this._chooseSubtree(y, this.data, E, b);
        for (S.children.push(p), h(S, y); E >= 0 && b[E].children.length > this._maxEntries; ) this._split(b, E), E--;
        this._adjustParentBBoxes(y, b, E);
      }, s.prototype._split = function(p, E) {
        var _ = p[E], y = _.children.length, b = this._minEntries;
        this._chooseSplitAxis(_, b, y);
        var S = this._chooseSplitIndex(_, b, y), x = m(_.children.splice(S, _.children.length - S));
        x.height = _.height, x.leaf = _.leaf, o(_, this.toBBox), o(x, this.toBBox), E ? p[E - 1].children.push(x) : this._splitRoot(_, x);
      }, s.prototype._splitRoot = function(p, E) {
        this.data = m([p, E]), this.data.height = p.height + 1, this.data.leaf = !1, o(this.data, this.toBBox);
      }, s.prototype._chooseSplitIndex = function(p, E, _) {
        for (var y, b, S, x, M, k, $, O = 1 / 0, T = 1 / 0, I = E; I <= _ - E; I++) {
          var N = c(p, 0, I, this.toBBox), j = c(p, I, _, this.toBBox), C = (b = N, S = j, x = void 0, M = void 0, k = void 0, $ = void 0, x = Math.max(b.minX, S.minX), M = Math.max(b.minY, S.minY), k = Math.min(b.maxX, S.maxX), $ = Math.min(b.maxY, S.maxY), Math.max(0, k - x) * Math.max(0, $ - M)), F = l(N) + l(j);
          C < O ? (O = C, y = I, T = F < T ? F : T) : C === O && F < T && (T = F, y = I);
        }
        return y || _ - E;
      }, s.prototype._chooseSplitAxis = function(p, E, _) {
        var y = p.leaf ? this.compareMinX : f, b = p.leaf ? this.compareMinY : u;
        this._allDistMargin(p, E, _, y) < this._allDistMargin(p, E, _, b) && p.children.sort(y);
      }, s.prototype._allDistMargin = function(p, E, _, y) {
        p.children.sort(y);
        for (var b = this.toBBox, S = c(p, 0, E, b), x = c(p, _ - E, _, b), M = d(S) + d(x), k = E; k < _ - E; k++) {
          var $ = p.children[k];
          h(S, p.leaf ? b($) : $), M += d(S);
        }
        for (var O = _ - E - 1; O >= E; O--) {
          var T = p.children[O];
          h(x, p.leaf ? b(T) : T), M += d(x);
        }
        return M;
      }, s.prototype._adjustParentBBoxes = function(p, E, _) {
        for (var y = _; y >= 0; y--) h(E[y], p);
      }, s.prototype._condense = function(p) {
        for (var E = p.length - 1, _ = void 0; E >= 0; E--) p[E].children.length === 0 ? E > 0 ? (_ = p[E - 1].children).splice(_.indexOf(p[E]), 1) : this.clear() : o(p[E], this.toBBox);
      }, s;
    });
  })(mh)), mh.exports;
}
class nM {
  constructor(e = [], r = iM) {
    if (this.data = e, this.length = this.data.length, this.compare = r, this.length > 0)
      for (let n = (this.length >> 1) - 1; n >= 0; n--) this._down(n);
  }
  push(e) {
    this.data.push(e), this.length++, this._up(this.length - 1);
  }
  pop() {
    if (this.length === 0) return;
    const e = this.data[0], r = this.data.pop();
    return this.length--, this.length > 0 && (this.data[0] = r, this._down(0)), e;
  }
  peek() {
    return this.data[0];
  }
  _up(e) {
    const { data: r, compare: n } = this, i = r[e];
    for (; e > 0; ) {
      const s = e - 1 >> 1, a = r[s];
      if (n(i, a) >= 0) break;
      r[e] = a, e = s;
    }
    r[e] = i;
  }
  _down(e) {
    const { data: r, compare: n } = this, i = this.length >> 1, s = r[e];
    for (; e < i; ) {
      let a = (e << 1) + 1, o = r[a];
      const c = a + 1;
      if (c < this.length && n(r[c], o) < 0 && (a = c, o = r[c]), n(o, s) >= 0) break;
      r[e] = o, e = a;
    }
    r[e] = s;
  }
}
function iM(t, e) {
  return t < e ? -1 : t > e ? 1 : 0;
}
const sM = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: nM
}, Symbol.toStringTag, { value: "Module" })), aM = /* @__PURE__ */ QS(sM);
var Un = { exports: {} }, j0, T0;
function oM() {
  return T0 || (T0 = 1, j0 = function(t, e, r, n) {
    var i = t[0], s = t[1], a = !1;
    r === void 0 && (r = 0), n === void 0 && (n = e.length);
    for (var o = (n - r) / 2, c = 0, h = o - 1; c < o; h = c++) {
      var f = e[r + c * 2 + 0], u = e[r + c * 2 + 1], l = e[r + h * 2 + 0], d = e[r + h * 2 + 1], g = u > s != d > s && i < (l - f) * (s - u) / (d - u) + f;
      g && (a = !a);
    }
    return a;
  }), j0;
}
var C0, L0;
function cM() {
  return L0 || (L0 = 1, C0 = function(t, e, r, n) {
    var i = t[0], s = t[1], a = !1;
    r === void 0 && (r = 0), n === void 0 && (n = e.length);
    for (var o = n - r, c = 0, h = o - 1; c < o; h = c++) {
      var f = e[c + r][0], u = e[c + r][1], l = e[h + r][0], d = e[h + r][1], g = u > s != d > s && i < (l - f) * (s - u) / (d - u) + f;
      g && (a = !a);
    }
    return a;
  }), C0;
}
var F0;
function hM() {
  if (F0) return Un.exports;
  F0 = 1;
  var t = oM(), e = cM();
  return Un.exports = function(r, n, i, s) {
    return n.length > 0 && Array.isArray(n[0]) ? e(r, n, i, s) : t(r, n, i, s);
  }, Un.exports.nested = e, Un.exports.flat = t, Un.exports;
}
var Xs = { exports: {} }, lM = Xs.exports, G0;
function uM() {
  return G0 || (G0 = 1, (function(t, e) {
    (function(r, n) {
      n(e);
    })(lM, function(r) {
      const n = 33306690738754706e-32;
      function i(g, w, m, v, p) {
        let E, _, y, b, S = w[0], x = v[0], M = 0, k = 0;
        x > S == x > -S ? (E = S, S = w[++M]) : (E = x, x = v[++k]);
        let $ = 0;
        if (M < g && k < m) for (x > S == x > -S ? (y = E - ((_ = S + E) - S), S = w[++M]) : (y = E - ((_ = x + E) - x), x = v[++k]), E = _, y !== 0 && (p[$++] = y); M < g && k < m; ) x > S == x > -S ? (y = E - ((_ = E + S) - (b = _ - E)) + (S - b), S = w[++M]) : (y = E - ((_ = E + x) - (b = _ - E)) + (x - b), x = v[++k]), E = _, y !== 0 && (p[$++] = y);
        for (; M < g; ) y = E - ((_ = E + S) - (b = _ - E)) + (S - b), S = w[++M], E = _, y !== 0 && (p[$++] = y);
        for (; k < m; ) y = E - ((_ = E + x) - (b = _ - E)) + (x - b), x = v[++k], E = _, y !== 0 && (p[$++] = y);
        return E === 0 && $ !== 0 || (p[$++] = E), $;
      }
      function s(g) {
        return new Float64Array(g);
      }
      const a = 33306690738754716e-32, o = 22204460492503146e-32, c = 11093356479670487e-47, h = s(4), f = s(8), u = s(12), l = s(16), d = s(4);
      r.orient2d = function(g, w, m, v, p, E) {
        const _ = (w - E) * (m - p), y = (g - p) * (v - E), b = _ - y;
        if (_ === 0 || y === 0 || _ > 0 != y > 0) return b;
        const S = Math.abs(_ + y);
        return Math.abs(b) >= a * S ? b : -(function(x, M, k, $, O, T, I) {
          let N, j, C, F, q, R, D, G, L, A, P, U, K, J, et, rt, z, B;
          const X = x - O, Y = k - O, nt = M - T, vt = $ - T;
          q = (et = (G = X - (D = (R = 134217729 * X) - (R - X))) * (A = vt - (L = (R = 134217729 * vt) - (R - vt))) - ((J = X * vt) - D * L - G * L - D * A)) - (P = et - (z = (G = nt - (D = (R = 134217729 * nt) - (R - nt))) * (A = Y - (L = (R = 134217729 * Y) - (R - Y))) - ((rt = nt * Y) - D * L - G * L - D * A))), h[0] = et - (P + q) + (q - z), q = (K = J - ((U = J + P) - (q = U - J)) + (P - q)) - (P = K - rt), h[1] = K - (P + q) + (q - rt), q = (B = U + P) - U, h[2] = U - (B - q) + (P - q), h[3] = B;
          let xt = (function(te, se) {
            let rr = se[0];
            for (let nr = 1; nr < te; nr++) rr += se[nr];
            return rr;
          })(4, h), re = o * I;
          if (xt >= re || -xt >= re || (N = x - (X + (q = x - X)) + (q - O), C = k - (Y + (q = k - Y)) + (q - O), j = M - (nt + (q = M - nt)) + (q - T), F = $ - (vt + (q = $ - vt)) + (q - T), N === 0 && j === 0 && C === 0 && F === 0) || (re = c * I + n * Math.abs(xt), (xt += X * F + vt * N - (nt * C + Y * j)) >= re || -xt >= re)) return xt;
          q = (et = (G = N - (D = (R = 134217729 * N) - (R - N))) * (A = vt - (L = (R = 134217729 * vt) - (R - vt))) - ((J = N * vt) - D * L - G * L - D * A)) - (P = et - (z = (G = j - (D = (R = 134217729 * j) - (R - j))) * (A = Y - (L = (R = 134217729 * Y) - (R - Y))) - ((rt = j * Y) - D * L - G * L - D * A))), d[0] = et - (P + q) + (q - z), q = (K = J - ((U = J + P) - (q = U - J)) + (P - q)) - (P = K - rt), d[1] = K - (P + q) + (q - rt), q = (B = U + P) - U, d[2] = U - (B - q) + (P - q), d[3] = B;
          const ne = i(4, h, 4, d, f);
          q = (et = (G = X - (D = (R = 134217729 * X) - (R - X))) * (A = F - (L = (R = 134217729 * F) - (R - F))) - ((J = X * F) - D * L - G * L - D * A)) - (P = et - (z = (G = nt - (D = (R = 134217729 * nt) - (R - nt))) * (A = C - (L = (R = 134217729 * C) - (R - C))) - ((rt = nt * C) - D * L - G * L - D * A))), d[0] = et - (P + q) + (q - z), q = (K = J - ((U = J + P) - (q = U - J)) + (P - q)) - (P = K - rt), d[1] = K - (P + q) + (q - rt), q = (B = U + P) - U, d[2] = U - (B - q) + (P - q), d[3] = B;
          const ie = i(ne, f, 4, d, u);
          q = (et = (G = N - (D = (R = 134217729 * N) - (R - N))) * (A = F - (L = (R = 134217729 * F) - (R - F))) - ((J = N * F) - D * L - G * L - D * A)) - (P = et - (z = (G = j - (D = (R = 134217729 * j) - (R - j))) * (A = C - (L = (R = 134217729 * C) - (R - C))) - ((rt = j * C) - D * L - G * L - D * A))), d[0] = et - (P + q) + (q - z), q = (K = J - ((U = J + P) - (q = U - J)) + (P - q)) - (P = K - rt), d[1] = K - (P + q) + (q - rt), q = (B = U + P) - U, d[2] = U - (B - q) + (P - q), d[3] = B;
          const Ct = i(ie, u, 4, d, l);
          return l[Ct - 1];
        })(g, w, m, v, p, E, S);
      }, r.orient2dfast = function(g, w, m, v, p, E) {
        return (w - E) * (m - p) - (g - p) * (v - E);
      }, Object.defineProperty(r, "__esModule", { value: !0 });
    });
  })(Xs, Xs.exports)), Xs.exports;
}
var z0;
function fM() {
  if (z0) return Ts.exports;
  z0 = 1;
  var t = rM(), e = aM, r = hM(), n = uM().orient2d;
  e.default && (e = e.default), Ts.exports = i, Ts.exports.default = i;
  function i(_, y, b) {
    y = Math.max(0, y === void 0 ? 2 : y), b = b || 0;
    var S = d(_), x = new t(16);
    x.toBBox = function(G) {
      return {
        minX: G[0],
        minY: G[1],
        maxX: G[0],
        maxY: G[1]
      };
    }, x.compareMinX = function(G, L) {
      return G[0] - L[0];
    }, x.compareMinY = function(G, L) {
      return G[1] - L[1];
    }, x.load(_);
    for (var M = [], k = 0, $; k < S.length; k++) {
      var O = S[k];
      x.remove(O), $ = g(O, $), M.push($);
    }
    var T = new t(16);
    for (k = 0; k < M.length; k++) T.insert(l(M[k]));
    for (var I = y * y, N = b * b; M.length; ) {
      var j = M.shift(), C = j.p, F = j.next.p, q = w(C, F);
      if (!(q < N)) {
        var R = q / I;
        O = s(x, j.prev.p, C, F, j.next.next.p, R, T), O && Math.min(w(O, C), w(O, F)) <= R && (M.push(j), M.push(g(O, j)), x.remove(O), T.remove(j), T.insert(l(j)), T.insert(l(j.next)));
      }
    }
    j = $;
    var D = [];
    do
      D.push(j.p), j = j.next;
    while (j !== $);
    return D.push(j.p), D;
  }
  function s(_, y, b, S, x, M, k) {
    for (var $ = new e([], a), O = _.data; O; ) {
      for (var T = 0; T < O.children.length; T++) {
        var I = O.children[T], N = O.leaf ? m(I, b, S) : o(b, S, I);
        N > M || $.push({
          node: I,
          dist: N
        });
      }
      for (; $.length && !$.peek().node.children; ) {
        var j = $.pop(), C = j.node, F = m(C, y, b), q = m(C, S, x);
        if (j.dist < F && j.dist < q && h(b, C, k) && h(S, C, k)) return C;
      }
      O = $.pop(), O && (O = O.node);
    }
    return null;
  }
  function a(_, y) {
    return _.dist - y.dist;
  }
  function o(_, y, b) {
    if (c(_, b) || c(y, b)) return 0;
    var S = v(_[0], _[1], y[0], y[1], b.minX, b.minY, b.maxX, b.minY);
    if (S === 0) return 0;
    var x = v(_[0], _[1], y[0], y[1], b.minX, b.minY, b.minX, b.maxY);
    if (x === 0) return 0;
    var M = v(_[0], _[1], y[0], y[1], b.maxX, b.minY, b.maxX, b.maxY);
    if (M === 0) return 0;
    var k = v(_[0], _[1], y[0], y[1], b.minX, b.maxY, b.maxX, b.maxY);
    return k === 0 ? 0 : Math.min(S, x, M, k);
  }
  function c(_, y) {
    return _[0] >= y.minX && _[0] <= y.maxX && _[1] >= y.minY && _[1] <= y.maxY;
  }
  function h(_, y, b) {
    for (var S = Math.min(_[0], y[0]), x = Math.min(_[1], y[1]), M = Math.max(_[0], y[0]), k = Math.max(_[1], y[1]), $ = b.search({ minX: S, minY: x, maxX: M, maxY: k }), O = 0; O < $.length; O++)
      if (u($[O].p, $[O].next.p, _, y)) return !1;
    return !0;
  }
  function f(_, y, b) {
    return n(_[0], _[1], y[0], y[1], b[0], b[1]);
  }
  function u(_, y, b, S) {
    return _ !== S && y !== b && f(_, y, b) > 0 != f(_, y, S) > 0 && f(b, S, _) > 0 != f(b, S, y) > 0;
  }
  function l(_) {
    var y = _.p, b = _.next.p;
    return _.minX = Math.min(y[0], b[0]), _.minY = Math.min(y[1], b[1]), _.maxX = Math.max(y[0], b[0]), _.maxY = Math.max(y[1], b[1]), _;
  }
  function d(_) {
    for (var y = _[0], b = _[0], S = _[0], x = _[0], M = 0; M < _.length; M++) {
      var k = _[M];
      k[0] < y[0] && (y = k), k[0] > S[0] && (S = k), k[1] < b[1] && (b = k), k[1] > x[1] && (x = k);
    }
    var $ = [y, b, S, x], O = $.slice();
    for (M = 0; M < _.length; M++)
      r(_[M], $) || O.push(_[M]);
    return E(O);
  }
  function g(_, y) {
    var b = {
      p: _,
      prev: null,
      next: null,
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0
    };
    return y ? (b.next = y.next, b.prev = y, y.next.prev = b, y.next = b) : (b.prev = b, b.next = b), b;
  }
  function w(_, y) {
    var b = _[0] - y[0], S = _[1] - y[1];
    return b * b + S * S;
  }
  function m(_, y, b) {
    var S = y[0], x = y[1], M = b[0] - S, k = b[1] - x;
    if (M !== 0 || k !== 0) {
      var $ = ((_[0] - S) * M + (_[1] - x) * k) / (M * M + k * k);
      $ > 1 ? (S = b[0], x = b[1]) : $ > 0 && (S += M * $, x += k * $);
    }
    return M = _[0] - S, k = _[1] - x, M * M + k * k;
  }
  function v(_, y, b, S, x, M, k, $) {
    var O = b - _, T = S - y, I = k - x, N = $ - M, j = _ - x, C = y - M, F = O * O + T * T, q = O * I + T * N, R = I * I + N * N, D = O * j + T * C, G = I * j + N * C, L = F * R - q * q, A, P, U, K, J = L, et = L;
    L === 0 ? (P = 0, J = 1, K = G, et = R) : (P = q * G - R * D, K = F * G - q * D, P < 0 ? (P = 0, K = G, et = R) : P > J && (P = J, K = G + q, et = R)), K < 0 ? (K = 0, -D < 0 ? P = 0 : -D > F ? P = J : (P = -D, J = F)) : K > et && (K = et, -D + q < 0 ? P = 0 : -D + q > F ? P = J : (P = -D + q, J = F)), A = P === 0 ? 0 : P / J, U = K === 0 ? 0 : K / et;
    var rt = (1 - A) * _ + A * b, z = (1 - A) * y + A * S, B = (1 - U) * x + U * k, X = (1 - U) * M + U * $, Y = B - rt, nt = X - z;
    return Y * Y + nt * nt;
  }
  function p(_, y) {
    return _[0] === y[0] ? _[1] - y[1] : _[0] - y[0];
  }
  function E(_) {
    _.sort(p);
    for (var y = [], b = 0; b < _.length; b++) {
      for (; y.length >= 2 && f(y[y.length - 2], y[y.length - 1], _[b]) <= 0; )
        y.pop();
      y.push(_[b]);
    }
    for (var S = [], x = _.length - 1; x >= 0; x--) {
      for (; S.length >= 2 && f(S[S.length - 2], S[S.length - 1], _[x]) <= 0; )
        S.pop();
      S.push(_[x]);
    }
    return S.pop(), y.pop(), y.concat(S);
  }
  return Ts.exports;
}
var dM = fM();
const mM = /* @__PURE__ */ YS(dM);
function q0(t, e = {}) {
  e.concavity = e.concavity || 1 / 0;
  const r = [];
  if (Zh(t, (i) => {
    r.push([i[0], i[1]]);
  }), !r.length)
    return null;
  const n = mM(r, e.concavity);
  return n.length > 3 ? _i([n]) : null;
}
var Ws = { exports: {} }, pM = Ws.exports, U0;
function yM() {
  return U0 || (U0 = 1, (function(t, e) {
    (function(r, n) {
      n(e);
    })(pM, (function(r) {
      function n(V, Z, H = {}) {
        const W = { type: "Feature" };
        return (H.id === 0 || H.id) && (W.id = H.id), H.bbox && (W.bbox = H.bbox), W.properties = Z || {}, W.geometry = V, W;
      }
      function i(V, Z, H = {}) {
        if (!V) throw new Error("coordinates is required");
        if (!Array.isArray(V)) throw new Error("coordinates must be an Array");
        if (V.length < 2) throw new Error("coordinates must be at least 2 numbers long");
        if (!o(V[0]) || !o(V[1])) throw new Error("coordinates must contain numbers");
        return n({ type: "Point", coordinates: V }, Z, H);
      }
      function s(V, Z, H = {}) {
        for (const W of V) {
          if (W.length < 4) throw new Error("Each LinearRing of a Polygon must have 4 or more Positions.");
          if (W[W.length - 1].length !== W[0].length) throw new Error("First and last Position are not equivalent.");
          for (let Q = 0; Q < W[W.length - 1].length; Q++) if (W[W.length - 1][Q] !== W[0][Q]) throw new Error("First and last Position are not equivalent.");
        }
        return n({ type: "Polygon", coordinates: V }, Z, H);
      }
      function a(V, Z = {}) {
        const H = { type: "FeatureCollection" };
        return Z.id && (H.id = Z.id), Z.bbox && (H.bbox = Z.bbox), H.features = V, H;
      }
      function o(V) {
        return !isNaN(V) && V !== null && !Array.isArray(V);
      }
      function c(V) {
        if (!V) throw new Error("coord is required");
        if (!Array.isArray(V)) {
          if (V.type === "Feature" && V.geometry !== null && V.geometry.type === "Point") return [...V.geometry.coordinates];
          if (V.type === "Point") return [...V.coordinates];
        }
        if (Array.isArray(V) && V.length >= 2 && !Array.isArray(V[0]) && !Array.isArray(V[1])) return [...V];
        throw new Error("coord must be GeoJSON Point or an Array of numbers");
      }
      function h(V) {
        if (Array.isArray(V)) return V;
        if (V.type === "Feature") {
          if (V.geometry !== null) return V.geometry.coordinates;
        } else if (V.coordinates) return V.coordinates;
        throw new Error("coords must be GeoJSON Feature, Geometry Object or an Array");
      }
      function f(V) {
        return V.type === "Feature" ? V.geometry : V;
      }
      const u = 11102230246251565e-32, l = 134217729, d = (3 + 8 * u) * u;
      function g(V, Z, H, W, Q) {
        let tt, at, ft, ht, mt = Z[0], Et = W[0], ct = 0, ut = 0;
        Et > mt == Et > -mt ? (tt = mt, mt = Z[++ct]) : (tt = Et, Et = W[++ut]);
        let St = 0;
        if (ct < V && ut < H) for (Et > mt == Et > -mt ? (at = mt + tt, ft = tt - (at - mt), mt = Z[++ct]) : (at = Et + tt, ft = tt - (at - Et), Et = W[++ut]), tt = at, ft !== 0 && (Q[St++] = ft); ct < V && ut < H; ) Et > mt == Et > -mt ? (at = tt + mt, ht = at - tt, ft = tt - (at - ht) + (mt - ht), mt = Z[++ct]) : (at = tt + Et, ht = at - tt, ft = tt - (at - ht) + (Et - ht), Et = W[++ut]), tt = at, ft !== 0 && (Q[St++] = ft);
        for (; ct < V; ) at = tt + mt, ht = at - tt, ft = tt - (at - ht) + (mt - ht), mt = Z[++ct], tt = at, ft !== 0 && (Q[St++] = ft);
        for (; ut < H; ) at = tt + Et, ht = at - tt, ft = tt - (at - ht) + (Et - ht), Et = W[++ut], tt = at, ft !== 0 && (Q[St++] = ft);
        return (tt !== 0 || St === 0) && (Q[St++] = tt), St;
      }
      function w(V, Z) {
        let H = Z[0];
        for (let W = 1; W < V; W++) H += Z[W];
        return H;
      }
      function m(V) {
        return new Float64Array(V);
      }
      const v = (3 + 16 * u) * u, p = (2 + 12 * u) * u, E = (9 + 64 * u) * u * u, _ = m(4), y = m(8), b = m(12), S = m(16), x = m(4);
      function M(V, Z, H, W, Q, tt, at) {
        let ft, ht, mt, Et, ct, ut, St, It, yt, dt, ot, Pt, Ut, Lt, Wt, Dt, Zt, le;
        const Ue = V - Q, Be = H - Q, Ze = Z - tt, Ve = W - tt;
        Lt = Ue * Ve, ut = l * Ue, St = ut - (ut - Ue), It = Ue - St, ut = l * Ve, yt = ut - (ut - Ve), dt = Ve - yt, Wt = It * dt - (Lt - St * yt - It * yt - St * dt), Dt = Ze * Be, ut = l * Ze, St = ut - (ut - Ze), It = Ze - St, ut = l * Be, yt = ut - (ut - Be), dt = Be - yt, Zt = It * dt - (Dt - St * yt - It * yt - St * dt), ot = Wt - Zt, ct = Wt - ot, _[0] = Wt - (ot + ct) + (ct - Zt), Pt = Lt + ot, ct = Pt - Lt, Ut = Lt - (Pt - ct) + (ot - ct), ot = Ut - Dt, ct = Ut - ot, _[1] = Ut - (ot + ct) + (ct - Dt), le = Pt + ot, ct = le - Pt, _[2] = Pt - (le - ct) + (ot - ct), _[3] = le;
        let Br = w(4, _), jn = p * at;
        if (Br >= jn || -Br >= jn || (ct = V - Ue, ft = V - (Ue + ct) + (ct - Q), ct = H - Be, mt = H - (Be + ct) + (ct - Q), ct = Z - Ze, ht = Z - (Ze + ct) + (ct - tt), ct = W - Ve, Et = W - (Ve + ct) + (ct - tt), ft === 0 && ht === 0 && mt === 0 && Et === 0) || (jn = E * at + d * Math.abs(Br), Br += Ue * Et + Ve * ft - (Ze * mt + Be * ht), Br >= jn || -Br >= jn)) return Br;
        Lt = ft * Ve, ut = l * ft, St = ut - (ut - ft), It = ft - St, ut = l * Ve, yt = ut - (ut - Ve), dt = Ve - yt, Wt = It * dt - (Lt - St * yt - It * yt - St * dt), Dt = ht * Be, ut = l * ht, St = ut - (ut - ht), It = ht - St, ut = l * Be, yt = ut - (ut - Be), dt = Be - yt, Zt = It * dt - (Dt - St * yt - It * yt - St * dt), ot = Wt - Zt, ct = Wt - ot, x[0] = Wt - (ot + ct) + (ct - Zt), Pt = Lt + ot, ct = Pt - Lt, Ut = Lt - (Pt - ct) + (ot - ct), ot = Ut - Dt, ct = Ut - ot, x[1] = Ut - (ot + ct) + (ct - Dt), le = Pt + ot, ct = le - Pt, x[2] = Pt - (le - ct) + (ot - ct), x[3] = le;
        const zp = g(4, _, 4, x, y);
        Lt = Ue * Et, ut = l * Ue, St = ut - (ut - Ue), It = Ue - St, ut = l * Et, yt = ut - (ut - Et), dt = Et - yt, Wt = It * dt - (Lt - St * yt - It * yt - St * dt), Dt = Ze * mt, ut = l * Ze, St = ut - (ut - Ze), It = Ze - St, ut = l * mt, yt = ut - (ut - mt), dt = mt - yt, Zt = It * dt - (Dt - St * yt - It * yt - St * dt), ot = Wt - Zt, ct = Wt - ot, x[0] = Wt - (ot + ct) + (ct - Zt), Pt = Lt + ot, ct = Pt - Lt, Ut = Lt - (Pt - ct) + (ot - ct), ot = Ut - Dt, ct = Ut - ot, x[1] = Ut - (ot + ct) + (ct - Dt), le = Pt + ot, ct = le - Pt, x[2] = Pt - (le - ct) + (ot - ct), x[3] = le;
        const qp = g(zp, y, 4, x, b);
        Lt = ft * Et, ut = l * ft, St = ut - (ut - ft), It = ft - St, ut = l * Et, yt = ut - (ut - Et), dt = Et - yt, Wt = It * dt - (Lt - St * yt - It * yt - St * dt), Dt = ht * mt, ut = l * ht, St = ut - (ut - ht), It = ht - St, ut = l * mt, yt = ut - (ut - mt), dt = mt - yt, Zt = It * dt - (Dt - St * yt - It * yt - St * dt), ot = Wt - Zt, ct = Wt - ot, x[0] = Wt - (ot + ct) + (ct - Zt), Pt = Lt + ot, ct = Pt - Lt, Ut = Lt - (Pt - ct) + (ot - ct), ot = Ut - Dt, ct = Ut - ot, x[1] = Ut - (ot + ct) + (ct - Dt), le = Pt + ot, ct = le - Pt, x[2] = Pt - (le - ct) + (ot - ct), x[3] = le;
        const Up = g(qp, b, 4, x, S);
        return S[Up - 1];
      }
      function k(V, Z, H, W, Q, tt) {
        const at = (Z - tt) * (H - Q), ft = (V - Q) * (W - tt), ht = at - ft, mt = Math.abs(at + ft);
        return Math.abs(ht) >= v * mt ? ht : -M(V, Z, H, W, Q, tt, mt);
      }
      function $(V, Z) {
        var H, W, Q = 0, tt, at, ft, ht, mt, Et, ct, ut = V[0], St = V[1], It = Z.length;
        for (H = 0; H < It; H++) {
          W = 0;
          var yt = Z[H], dt = yt.length - 1;
          if (Et = yt[0], Et[0] !== yt[dt][0] && Et[1] !== yt[dt][1]) throw new Error("First and last coordinates in a ring must be the same");
          for (at = Et[0] - ut, ft = Et[1] - St, W; W < dt; W++) {
            if (ct = yt[W + 1], ht = ct[0] - ut, mt = ct[1] - St, ft === 0 && mt === 0) {
              if (ht <= 0 && at >= 0 || at <= 0 && ht >= 0) return 0;
            } else if (mt >= 0 && ft <= 0 || mt <= 0 && ft >= 0) {
              if (tt = k(at, ht, ft, mt, 0, 0), tt === 0) return 0;
              (tt > 0 && mt > 0 && ft <= 0 || tt < 0 && mt <= 0 && ft > 0) && Q++;
            }
            Et = ct, ft = mt, at = ht;
          }
        }
        return Q % 2 !== 0;
      }
      function O(V, Z, H = {}) {
        if (!V) throw new Error("point is required");
        if (!Z) throw new Error("polygon is required");
        const W = c(V), Q = f(Z), tt = Q.type, at = Z.bbox;
        let ft = Q.coordinates;
        if (at && T(W, at) === !1) return !1;
        tt === "Polygon" && (ft = [ft]);
        let ht = !1;
        for (var mt = 0; mt < ft.length; ++mt) {
          const Et = $(W, ft[mt]);
          if (Et === 0) return !H.ignoreBoundary;
          Et && (ht = !0);
        }
        return ht;
      }
      function T(V, Z) {
        return Z[0] <= V[0] && Z[1] <= V[1] && Z[2] >= V[0] && Z[3] >= V[1];
      }
      function I(V, Z) {
        for (let H = 0; H < Z.features.length; H++) if (O(V, Z.features[H])) return Z.features[H];
      }
      function N(V, Z, H) {
        const W = Z.geometry.coordinates[0][0], Q = Z.geometry.coordinates[0][1], tt = Z.geometry.coordinates[0][2], at = V.geometry.coordinates, ft = Z.properties.a.geom, ht = Z.properties.b.geom, mt = Z.properties.c.geom, Et = [Q[0] - W[0], Q[1] - W[1]], ct = [tt[0] - W[0], tt[1] - W[1]], ut = [at[0] - W[0], at[1] - W[1]], St = [ht[0] - ft[0], ht[1] - ft[1]], It = [mt[0] - ft[0], mt[1] - ft[1]];
        let yt = (ct[1] * ut[0] - ct[0] * ut[1]) / (Et[0] * ct[1] - Et[1] * ct[0]), dt = (Et[0] * ut[1] - Et[1] * ut[0]) / (Et[0] * ct[1] - Et[1] * ct[0]);
        if (H) {
          const ot = H[Z.properties.a.index], Pt = H[Z.properties.b.index], Ut = H[Z.properties.c.index];
          let Lt;
          if (yt < 0 || dt < 0 || 1 - yt - dt < 0) {
            const Wt = yt / (yt + dt), Dt = dt / (yt + dt);
            Lt = yt / Pt / (Wt / Pt + Dt / Ut), dt = dt / Ut / (Wt / Pt + Dt / Ut);
          } else Lt = yt / Pt / (yt / Pt + dt / Ut + (1 - yt - dt) / ot), dt = dt / Ut / (yt / Pt + dt / Ut + (1 - yt - dt) / ot);
          yt = Lt;
        }
        return [yt * St[0] + dt * It[0] + ft[0], yt * St[1] + dt * It[1] + ft[1]];
      }
      function j(V, Z, H, W) {
        const Q = V.geometry.coordinates, tt = H.geometry.coordinates, at = Math.atan2(Q[0] - tt[0], Q[1] - tt[1]), ft = q(at, Z[0]);
        if (ft === void 0) throw new Error("Unable to determine vertex index");
        const ht = Z[1][ft];
        return N(V, ht.features[0], W);
      }
      function C(V, Z, H, W, Q, tt, at, ft) {
        let ht;
        if (at && (ht = I(V, a([at]))), !ht) if (H) {
          const mt = V.geometry.coordinates, Et = H.gridNum, ct = H.xOrigin, ut = H.yOrigin, St = H.xUnit, It = H.yUnit, yt = H.gridCache, dt = F(mt[0], ct, St, Et), ot = F(mt[1], ut, It, Et), Pt = yt[dt] ? yt[dt][ot] ? yt[dt][ot] : [] : [], Ut = a(Pt.map((Lt) => Z.features[Lt]));
          ht = I(V, Ut);
        } else ht = I(V, Z);
        return ft && ft(ht), ht ? N(V, ht, tt) : j(V, W, Q, tt);
      }
      function F(V, Z, H, W) {
        let Q = Math.floor((V - Z) / H);
        return Q < 0 && (Q = 0), Q >= W && (Q = W - 1), Q;
      }
      function q(V, Z) {
        let H = R(V - Z[0]), W = Math.PI * 2, Q;
        for (let tt = 0; tt < Z.length; tt++) {
          const at = (tt + 1) % Z.length, ft = R(V - Z[at]), ht = Math.min(Math.abs(H), Math.abs(ft));
          H * ft <= 0 && ht < W && (W = ht, Q = tt), H = ft;
        }
        return Q;
      }
      function R(V, Z = !1) {
        const H = 2 * Math.PI, W = V - Math.floor(V / H) * H;
        return Z ? W : W > Math.PI ? W - H : W;
      }
      function D(V) {
        const Z = V.features;
        for (let H = 0; H < Z.length; H++) {
          const W = Z[H];
          `${W.properties.a.index}`.substring(0, 1) === "b" && `${W.properties.b.index}`.substring(0, 1) === "b" ? Z[H] = { geometry: { type: "Polygon", coordinates: [[W.geometry.coordinates[0][2], W.geometry.coordinates[0][0], W.geometry.coordinates[0][1], W.geometry.coordinates[0][2]]] }, properties: { a: { geom: W.properties.c.geom, index: W.properties.c.index }, b: { geom: W.properties.a.geom, index: W.properties.a.index }, c: { geom: W.properties.b.geom, index: W.properties.b.index } }, type: "Feature" } : `${W.properties.c.index}`.substring(0, 1) === "b" && `${W.properties.a.index}`.substring(0, 1) === "b" && (Z[H] = { geometry: { type: "Polygon", coordinates: [[W.geometry.coordinates[0][1], W.geometry.coordinates[0][2], W.geometry.coordinates[0][0], W.geometry.coordinates[0][1]]] }, properties: { a: { geom: W.properties.b.geom, index: W.properties.b.index }, b: { geom: W.properties.c.geom, index: W.properties.c.index }, c: { geom: W.properties.a.geom, index: W.properties.a.index } }, type: "Feature" });
        }
        return V;
      }
      function G(V) {
        const Z = ["a", "b", "c", "a"].map((tt) => V.properties[tt].geom), H = V.geometry.coordinates[0], W = V.properties, Q = { a: { geom: H[0], index: W.a.index }, b: { geom: H[1], index: W.b.index }, c: { geom: H[2], index: W.c.index } };
        return s([Z], Q);
      }
      function L(V) {
        const Z = [0, 1, 2, 0].map((W) => V[W][0][0]), H = { a: { geom: V[0][0][1], index: V[0][1] }, b: { geom: V[1][0][1], index: V[1][1] }, c: { geom: V[2][0][1], index: V[2][1] } };
        return s([Z], H);
      }
      function A(V, Z, H, W, Q, tt = !1, at) {
        const ft = V.map((ht) => {
          (!at || at < 2.00703) && (ht = P(ht));
          const mt = isFinite(ht) ? Z[ht] : ht === "c" ? W : (function() {
            const Et = ht.match(/^b(\d+)$/);
            if (Et) return Q[parseInt(Et[1])];
            const ct = ht.match(/^e(\d+)$/);
            if (ct) return H[parseInt(ct[1])];
            throw new Error("Bad index value for indexesToTri");
          })();
          return tt ? [[mt[1], mt[0]], ht] : [[mt[0], mt[1]], ht];
        });
        return L(ft);
      }
      function P(V) {
        return typeof V == "number" ? V : V.replace(/^(c|e|b)(?:ent|dgeNode|box)(\d+)?$/, "$1$2");
      }
      function U(V, Z) {
        return Z && Z >= 2.00703 || Array.isArray(V[0]) ? V : V.map((H) => [H.illstNodes, H.mercNodes, H.startEnd]);
      }
      const K = 2.00703;
      function J(V) {
        return !!(V.version !== void 0 || !V.tins && V.points && V.tins_points);
      }
      function et(V) {
        return { points: V.points, pointsWeightBuffer: z(V), strictStatus: B(V), verticesParams: X(V), centroid: nt(V), edges: U(V.edges || []), edgeNodes: V.edgeNodes || [], tins: vt(V), kinks: xt(V.kinks_points), yaxisMode: V.yaxisMode ?? "invert", strictMode: V.strictMode ?? "auto", vertexMode: V.vertexMode, bounds: V.bounds, boundsPolygon: V.boundsPolygon, wh: V.wh, xy: V.xy ?? [0, 0] };
      }
      function rt(V) {
        const Z = re(V), H = Z.tins;
        return { compiled: Z, tins: H, points: ne(H), strictStatus: Z.strict_status, pointsWeightBuffer: Z.weight_buffer, verticesParams: Z.vertices_params, centroid: Z.centroid, kinks: Z.kinks };
      }
      function z(V) {
        return !V.version || V.version < K ? ["forw", "bakw"].reduce((Z, H) => {
          const W = V.weight_buffer[H];
          return W && (Z[H] = Object.keys(W).reduce((Q, tt) => {
            const at = P(tt);
            return Q[at] = W[tt], Q;
          }, {})), Z;
        }, {}) : V.weight_buffer;
      }
      function B(V) {
        return V.strict_status ? V.strict_status : V.kinks_points ? "strict_error" : V.tins_points.length === 2 ? "loose" : "strict";
      }
      function X(V) {
        const Z = { forw: [V.vertices_params[0]], bakw: [V.vertices_params[1]] };
        return Z.forw[1] = Y(V, !1), Z.bakw[1] = Y(V, !0), Z;
      }
      function Y(V, Z) {
        const H = V.vertices_points.length;
        return Array.from({ length: H }, (W, Q) => {
          const tt = (Q + 1) % H, at = A(["c", `b${Q}`, `b${tt}`], V.points, V.edgeNodes || [], V.centroid_point, V.vertices_points, Z, K);
          return a([at]);
        });
      }
      function nt(V) {
        return { forw: i(V.centroid_point[0], { target: { geom: V.centroid_point[1], index: "c" } }), bakw: i(V.centroid_point[1], { target: { geom: V.centroid_point[0], index: "c" } }) };
      }
      function vt(V) {
        const Z = V.tins_points.length === 1 ? 0 : 1;
        return { forw: a(V.tins_points[0].map((H) => A(H, V.points, V.edgeNodes || [], V.centroid_point, V.vertices_points, !1, V.version))), bakw: a(V.tins_points[Z].map((H) => A(H, V.points, V.edgeNodes || [], V.centroid_point, V.vertices_points, !0, V.version))) };
      }
      function xt(V) {
        if (V) return { bakw: a(V.map((Z) => i(Z))) };
      }
      function re(V) {
        return JSON.parse(JSON.stringify(V).replace('"cent"', '"c"').replace(/"bbox(\d+)"/g, '"b$1"'));
      }
      function ne(V) {
        const Z = [], H = V.forw.features;
        for (let W = 0; W < H.length; W++) {
          const Q = H[W];
          ["a", "b", "c"].forEach((tt, at) => {
            const ft = Q.geometry.coordinates[0][at], ht = Q.properties[tt].geom, mt = Q.properties[tt].index;
            typeof mt == "number" && (Z[mt] = [ft, ht]);
          });
        }
        return Z;
      }
      const ie = K;
      class Ct {
        static VERTEX_PLAIN = "plain";
        static VERTEX_BIRDEYE = "birdeye";
        static MODE_STRICT = "strict";
        static MODE_AUTO = "auto";
        static MODE_LOOSE = "loose";
        static STATUS_STRICT = "strict";
        static STATUS_ERROR = "strict_error";
        static STATUS_LOOSE = "loose";
        static YAXIS_FOLLOW = "follow";
        static YAXIS_INVERT = "invert";
        points = [];
        pointsWeightBuffer;
        strict_status;
        vertices_params;
        centroid;
        edgeNodes;
        edges;
        tins;
        kinks;
        yaxisMode = Ct.YAXIS_INVERT;
        strictMode = Ct.MODE_AUTO;
        vertexMode = Ct.VERTEX_PLAIN;
        bounds;
        boundsPolygon;
        wh;
        xy;
        indexedTins;
        stateFull = !1;
        stateTriangle;
        stateBackward;
        priority;
        importance;
        xyBounds;
        mercBounds;
        constructor() {
        }
        setCompiled(Z) {
          if (J(Z)) {
            this.applyModernState(et(Z));
            return;
          }
          this.applyLegacyState(rt(Z));
        }
        applyModernState(Z) {
          this.points = Z.points, this.pointsWeightBuffer = Z.pointsWeightBuffer, this.strict_status = Z.strictStatus, this.vertices_params = Z.verticesParams, this.centroid = Z.centroid, this.edges = Z.edges, this.edgeNodes = Z.edgeNodes || [], this.tins = Z.tins, this.addIndexedTin(), this.kinks = Z.kinks, this.yaxisMode = Z.yaxisMode ?? Ct.YAXIS_INVERT, this.vertexMode = Z.vertexMode ?? Ct.VERTEX_PLAIN, this.strictMode = Z.strictMode ?? Ct.MODE_AUTO, Z.bounds ? (this.bounds = Z.bounds, this.boundsPolygon = Z.boundsPolygon, this.xy = Z.xy, this.wh = Z.wh) : (this.bounds = void 0, this.boundsPolygon = void 0, this.xy = Z.xy ?? [0, 0], Z.wh && (this.wh = Z.wh));
        }
        applyLegacyState(Z) {
          this.tins = Z.tins, this.addIndexedTin(), this.strict_status = Z.strictStatus, this.pointsWeightBuffer = Z.pointsWeightBuffer, this.vertices_params = Z.verticesParams, this.centroid = Z.centroid, this.kinks = Z.kinks, this.points = Z.points;
        }
        addIndexedTin() {
          const Z = this.tins, H = Z.forw, W = Z.bakw, Q = Math.ceil(Math.sqrt(H.features.length));
          if (Q < 3) {
            this.indexedTins = void 0;
            return;
          }
          let tt = [], at = [];
          const ft = H.features.map((yt) => {
            let dt = [];
            return h(yt)[0].map((ot) => {
              tt.length === 0 ? tt = [Array.from(ot), Array.from(ot)] : (ot[0] < tt[0][0] && (tt[0][0] = ot[0]), ot[0] > tt[1][0] && (tt[1][0] = ot[0]), ot[1] < tt[0][1] && (tt[0][1] = ot[1]), ot[1] > tt[1][1] && (tt[1][1] = ot[1])), dt.length === 0 ? dt = [Array.from(ot), Array.from(ot)] : (ot[0] < dt[0][0] && (dt[0][0] = ot[0]), ot[0] > dt[1][0] && (dt[1][0] = ot[0]), ot[1] < dt[0][1] && (dt[0][1] = ot[1]), ot[1] > dt[1][1] && (dt[1][1] = ot[1]));
            }), dt;
          }), ht = (tt[1][0] - tt[0][0]) / Q, mt = (tt[1][1] - tt[0][1]) / Q, Et = ft.reduce((yt, dt, ot) => {
            const Pt = F(dt[0][0], tt[0][0], ht, Q), Ut = F(dt[1][0], tt[0][0], ht, Q), Lt = F(dt[0][1], tt[0][1], mt, Q), Wt = F(dt[1][1], tt[0][1], mt, Q);
            for (let Dt = Pt; Dt <= Ut; Dt++) {
              yt[Dt] || (yt[Dt] = []);
              for (let Zt = Lt; Zt <= Wt; Zt++) yt[Dt][Zt] || (yt[Dt][Zt] = []), yt[Dt][Zt].push(ot);
            }
            return yt;
          }, []), ct = W.features.map((yt) => {
            let dt = [];
            return h(yt)[0].map((ot) => {
              at.length === 0 ? at = [Array.from(ot), Array.from(ot)] : (ot[0] < at[0][0] && (at[0][0] = ot[0]), ot[0] > at[1][0] && (at[1][0] = ot[0]), ot[1] < at[0][1] && (at[0][1] = ot[1]), ot[1] > at[1][1] && (at[1][1] = ot[1])), dt.length === 0 ? dt = [Array.from(ot), Array.from(ot)] : (ot[0] < dt[0][0] && (dt[0][0] = ot[0]), ot[0] > dt[1][0] && (dt[1][0] = ot[0]), ot[1] < dt[0][1] && (dt[0][1] = ot[1]), ot[1] > dt[1][1] && (dt[1][1] = ot[1]));
            }), dt;
          }), ut = (at[1][0] - at[0][0]) / Q, St = (at[1][1] - at[0][1]) / Q, It = ct.reduce((yt, dt, ot) => {
            const Pt = F(dt[0][0], at[0][0], ut, Q), Ut = F(dt[1][0], at[0][0], ut, Q), Lt = F(dt[0][1], at[0][1], St, Q), Wt = F(dt[1][1], at[0][1], St, Q);
            for (let Dt = Pt; Dt <= Ut; Dt++) {
              yt[Dt] || (yt[Dt] = []);
              for (let Zt = Lt; Zt <= Wt; Zt++) yt[Dt][Zt] || (yt[Dt][Zt] = []), yt[Dt][Zt].push(ot);
            }
            return yt;
          }, []);
          this.indexedTins = { forw: { gridNum: Q, xOrigin: tt[0][0], yOrigin: tt[0][1], xUnit: ht, yUnit: mt, gridCache: Et }, bakw: { gridNum: Q, xOrigin: at[0][0], yOrigin: at[0][1], xUnit: ut, yUnit: St, gridCache: It } };
        }
        transform(Z, H, W) {
          if (!this.tins) throw new Error("setCompiled() must be called before transform()");
          if (H && this.strict_status == Ct.STATUS_ERROR) throw new Error('Backward transform is not allowed if strict_status == "strict_error"');
          this.yaxisMode == Ct.YAXIS_FOLLOW && H && (Z = [Z[0], -1 * Z[1]]);
          const Q = i(Z);
          if (this.bounds && !H && !W && !O(Q, this.boundsPolygon)) return !1;
          const tt = H ? this.tins.bakw : this.tins.forw, at = H ? this.indexedTins.bakw : this.indexedTins.forw, ft = H ? this.vertices_params.bakw : this.vertices_params.forw, ht = H ? this.centroid.bakw : this.centroid.forw, mt = H ? this.pointsWeightBuffer.bakw : this.pointsWeightBuffer.forw;
          let Et, ct;
          this.stateFull && (this.stateBackward == H ? Et = this.stateTriangle : (this.stateBackward = H, this.stateTriangle = void 0), ct = (St) => {
            this.stateTriangle = St;
          });
          let ut = C(Q, tt, at, ft, ht, mt, Et, ct);
          if (this.bounds && H && !W) {
            const St = i(ut);
            if (!O(St, this.boundsPolygon)) return !1;
          } else this.yaxisMode == Ct.YAXIS_FOLLOW && !H && (ut = [ut[0], -1 * ut[1]]);
          return ut;
        }
      }
      const te = 20037508342789244e-9, se = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]];
      function rr(V, Z) {
        return Math.floor(Math.min(V[0], V[1]) / 4) * te / 128 / Math.pow(2, Z);
      }
      function nr(V, Z) {
        const H = [];
        for (let W = 0; W < V.length; W++) {
          const Q = V[W], tt = Q[0] * Math.cos(Z) - Q[1] * Math.sin(Z), at = Q[0] * Math.sin(Z) + Q[1] * Math.cos(Z);
          H.push([tt, at]);
        }
        return H;
      }
      function fr(V, Z, H, W) {
        const Q = rr(W, Z);
        return nr(se, H).map((tt) => [tt[0] * Q + V[0], tt[1] * Q + V[1]]);
      }
      function qr(V, Z) {
        const H = V[0], W = V.slice(1, 5).map((ut) => [ut[0] - H[0], ut[1] - H[1]]), Q = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        let tt = 0, at = 0, ft = 0;
        for (let ut = 0; ut < 4; ut++) {
          const St = W[ut], It = Q[ut], yt = Math.sqrt(Math.pow(St[0], 2) + Math.pow(St[1], 2));
          tt += yt;
          const dt = St[0] * It[1] - St[1] * It[0], ot = Math.acos((St[0] * It[0] + St[1] * It[1]) / yt), Pt = dt > 0 ? -1 * ot : ot;
          at += Math.cos(Pt), ft += Math.sin(Pt);
        }
        const ht = tt / 4, mt = Math.atan2(ft, at), Et = Math.floor(Math.min(Z[0], Z[1]) / 4), ct = Math.log(Et * te / 128 / ht) / Math.log(2);
        return { center: H, zoom: ct, rotation: mt };
      }
      function Ur(V, Z) {
        const H = V[0] * (2 * te) / Z - te, W = -1 * (V[1] * (2 * te) / Z - te);
        return [H, W];
      }
      function cn(V, Z) {
        const H = (V[0] + te) * Z / (2 * te), W = (-V[1] + te) * Z / (2 * te);
        return [H, W];
      }
      const Dn = 256;
      class Gp {
        mainTin = null;
        subTins = [];
        _maxxy = 0;
        setMapData(Z) {
          const H = new Ct();
          if (H.setCompiled(Z.compiled), this.mainTin = H, Z.maxZoom !== void 0) this._maxxy = Math.pow(2, Z.maxZoom) * Dn;
          else if (Z.compiled.wh) {
            const W = Math.max(Z.compiled.wh[0], Z.compiled.wh[1]), Q = Math.ceil(Math.log2(W / Dn));
            this._maxxy = Math.pow(2, Q) * Dn;
          }
          if (this.subTins = [], Z.sub_maps) for (const W of Z.sub_maps) {
            const Q = new Ct();
            Q.setCompiled(W.compiled);
            const tt = W.bounds ?? W.compiled.bounds;
            if (!tt) throw new Error("SubMapData must have bounds or compiled.bounds to create xyBounds polygon");
            const at = [...tt, tt[0]], ft = at.map((ht) => {
              const mt = Q.transform(ht, !1);
              if (!mt) throw new Error("Failed to transform sub-map bounds to mercator");
              return mt;
            });
            this.subTins.push({ tin: Q, priority: W.priority, importance: W.importance, xyBounds: s([at]), mercBounds: s([ft]) });
          }
        }
        xy2Merc(Z) {
          const H = this.xy2MercWithLayer(Z);
          return H ? H[1] : !1;
        }
        merc2Xy(Z) {
          const H = this.merc2XyWithLayer(Z), W = H[0] || H[1];
          return W ? W[1] : !1;
        }
        xy2MercWithLayer(Z) {
          this._assertMapData();
          const H = this._getTinsSortedByPriority();
          for (let W = 0; W < H.length; W++) {
            const { index: Q, isMain: tt } = H[W];
            if (tt || O(i(Z), this.subTins[Q - 1].xyBounds)) {
              const at = this._transformByIndex(Z, Q, !1);
              if (at === !1) continue;
              return [Q, at];
            }
          }
          return !1;
        }
        merc2XyWithLayer(Z) {
          return this._assertMapData(), this._getAllTinsWithIndex().map(({ index: H, tin: W, isMain: Q }) => {
            const tt = this._transformByIndex(Z, H, !0);
            return tt === !1 ? [W, H] : Q || O(i(tt), this.subTins[H - 1].xyBounds) ? [W, H, tt] : [W, H];
          }).sort((H, W) => {
            const Q = H[0].priority ?? 0, tt = W[0].priority ?? 0;
            return Q < tt ? 1 : -1;
          }).reduce((H, W, Q, tt) => {
            const at = W[0], ft = W[1], ht = W[2];
            if (!ht) return H;
            for (let mt = 0; mt < Q; mt++) {
              const Et = tt[mt][1], ct = Et === 0;
              if (tt[mt][2] && (ct || O(i(ht), this.subTins[Et - 1].xyBounds))) if (H.length) {
                const ut = !H[0], St = ut ? H[1][2] : H[0][2], It = at.importance ?? 0, yt = St.importance ?? 0;
                return ut ? It < yt ? H : [void 0, [ft, ht, at]] : [...H.filter((dt) => dt !== void 0), [ft, ht, at]].sort((dt, ot) => (dt[2].importance ?? 0) < (ot[2].importance ?? 0) ? 1 : -1).slice(0, 2);
              } else return [[ft, ht, at]];
            }
            return !H.length || !H[0] ? [[ft, ht, at]] : (H.push([ft, ht, at]), H.sort((mt, Et) => {
              const ct = mt[2].importance ?? 0, ut = Et[2].importance ?? 0;
              return ct < ut ? 1 : -1;
            }).filter((mt, Et) => Et < 2));
          }, []).map((H) => {
            if (H) return [H[0], H[1]];
          });
        }
        mercs2SysCoords(Z) {
          this._assertMapData();
          const H = this.merc2XyWithLayer(Z[0]);
          let W = !1;
          return H.map((Q, tt) => {
            if (!Q) {
              W = !0;
              return;
            }
            const at = Q[0], ft = Q[1];
            return tt !== 0 && !W ? [this.xy2SysCoordInternal(ft)] : Z.map((ht, mt) => mt === 0 ? ft : this._transformByIndex(ht, at, !0)).map((ht) => this.xy2SysCoordInternal(ht));
          });
        }
        viewpoint2Mercs(Z, H) {
          this._assertMapData(), this._assertMaxxy();
          const W = fr(Z.center, Z.zoom, Z.rotation, H).map((ft) => cn(ft, this._maxxy)), Q = this.xy2MercWithLayer(W[0]);
          if (!Q) throw new Error("viewpoint2Mercs: center point is out of bounds");
          const tt = Q[0], at = Q[1];
          return W.map((ft, ht) => {
            if (ht === 0) return at;
            const mt = this._transformByIndex(ft, tt, !1);
            if (mt === !1) throw new Error(`viewpoint2Mercs: point ${ht} is out of bounds`);
            return mt;
          });
        }
        mercs2Viewpoint(Z, H) {
          this._assertMapData(), this._assertMaxxy();
          const W = this.merc2XyWithLayer(Z[0]), Q = W[0] || W[1];
          if (!Q) throw new Error("mercs2Viewpoint: center point is out of bounds");
          const tt = Q[0], at = Q[1], ft = Z.map((ht, mt) => {
            if (mt === 0) return at;
            const Et = this._transformByIndex(ht, tt, !0);
            if (Et === !1) throw new Error(`mercs2Viewpoint: point ${mt} is out of bounds`);
            return Et;
          }).map((ht) => Ur(ht, this._maxxy));
          return qr(ft, H);
        }
        static zoom2Radius(Z, H) {
          return rr(Z, H);
        }
        static mercViewpoint2Mercs(Z, H, W, Q) {
          return fr(Z, H, W, Q);
        }
        static mercs2MercViewpoint(Z, H) {
          return qr(Z, H);
        }
        static xy2SysCoord(Z, H) {
          return Ur(Z, H);
        }
        static sysCoord2Xy(Z, H) {
          return cn(Z, H);
        }
        _assertMapData() {
          if (!this.mainTin) throw new Error("setMapData() must be called before transformation");
        }
        _assertMaxxy() {
          if (this._maxxy === 0) throw new Error("MapData.maxZoom or compiled.wh must be set for viewpoint conversion (xy2SysCoord / sysCoord2Xy)");
        }
        getLayerTransform(Z) {
          if (Z === 0) return this.mainTin;
          const H = this.subTins[Z - 1];
          return H ? H.tin : null;
        }
        get layerCount() {
          return 1 + this.subTins.length;
        }
        get maxxy() {
          return this._maxxy;
        }
        _getTinsSortedByPriority() {
          return this._getAllTinsWithIndex().sort((Z, H) => {
            const W = Z.tin.priority ?? 0, Q = H.tin.priority ?? 0;
            return W < Q ? 1 : -1;
          });
        }
        _getAllTinsWithIndex() {
          const Z = [{ index: 0, tin: this.mainTin, isMain: !0 }];
          return this.subTins.forEach((H, W) => {
            H.tin.priority = H.priority, H.tin.importance = H.importance, Z.push({ index: W + 1, tin: H.tin, isMain: !1 });
          }), Z;
        }
        _transformByIndex(Z, H, W) {
          if (H === 0) return this.mainTin.transform(Z, W);
          const Q = this.subTins[H - 1];
          return Q ? Q.tin.transform(Z, W, !0) : !1;
        }
        xy2SysCoordInternal(Z) {
          return Ur(Z, this._maxxy);
        }
      }
      r.MERC_CROSSMATRIX = se, r.MERC_MAX = te, r.MapTransform = Gp, r.Transform = Ct, r.counterTri = G, r.format_version = ie, r.mercViewpoint2Mercs = fr, r.mercs2MercViewpoint = qr, r.normalizeEdges = U, r.rotateMatrix = nr, r.rotateVerticesTriangle = D, r.sysCoord2Xy = cn, r.transformArr = C, r.xy2SysCoord = Ur, r.zoom2Radius = rr, Object.defineProperty(r, Symbol.toStringTag, { value: "Module" });
    }));
  })(Ws, Ws.exports)), Ws.exports;
}
var Ce = yM();
const B0 = Math.pow(2, -52), Cs = new Uint32Array(512);
class Vh {
  static from(e, r = EM, n = bM) {
    const i = e.length, s = new Float64Array(i * 2);
    for (let a = 0; a < i; a++) {
      const o = e[a];
      s[2 * a] = r(o), s[2 * a + 1] = n(o);
    }
    return new Vh(s);
  }
  constructor(e) {
    const r = e.length >> 1;
    if (r > 0 && typeof e[0] != "number") throw new Error("Expected coords to contain numbers.");
    this.coords = e;
    const n = Math.max(2 * r - 5, 0);
    this._triangles = new Uint32Array(n * 3), this._halfedges = new Int32Array(n * 3), this._hashSize = Math.ceil(Math.sqrt(r)), this._hullPrev = new Uint32Array(r), this._hullNext = new Uint32Array(r), this._hullTri = new Uint32Array(r), this._hullHash = new Int32Array(this._hashSize), this._ids = new Uint32Array(r), this._dists = new Float64Array(r), this.update();
  }
  update() {
    const { coords: e, _hullPrev: r, _hullNext: n, _hullTri: i, _hullHash: s } = this, a = e.length >> 1;
    let o = 1 / 0, c = 1 / 0, h = -1 / 0, f = -1 / 0;
    for (let M = 0; M < a; M++) {
      const k = e[2 * M], $ = e[2 * M + 1];
      k < o && (o = k), $ < c && (c = $), k > h && (h = k), $ > f && (f = $), this._ids[M] = M;
    }
    const u = (o + h) / 2, l = (c + f) / 2;
    let d, g, w;
    for (let M = 0, k = 1 / 0; M < a; M++) {
      const $ = rh(u, l, e[2 * M], e[2 * M + 1]);
      $ < k && (d = M, k = $);
    }
    const m = e[2 * d], v = e[2 * d + 1];
    for (let M = 0, k = 1 / 0; M < a; M++) {
      if (M === d) continue;
      const $ = rh(m, v, e[2 * M], e[2 * M + 1]);
      $ < k && $ > 0 && (g = M, k = $);
    }
    let p = e[2 * g], E = e[2 * g + 1], _ = 1 / 0;
    for (let M = 0; M < a; M++) {
      if (M === d || M === g) continue;
      const k = _M(m, v, p, E, e[2 * M], e[2 * M + 1]);
      k < _ && (w = M, _ = k);
    }
    let y = e[2 * w], b = e[2 * w + 1];
    if (_ === 1 / 0) {
      for (let $ = 0; $ < a; $++)
        this._dists[$] = e[2 * $] - e[0] || e[2 * $ + 1] - e[1];
      Mn(this._ids, this._dists, 0, a - 1);
      const M = new Uint32Array(a);
      let k = 0;
      for (let $ = 0, O = -1 / 0; $ < a; $++) {
        const T = this._ids[$], I = this._dists[T];
        I > O && (M[k++] = T, O = I);
      }
      this.hull = M.subarray(0, k), this.triangles = new Uint32Array(0), this.halfedges = new Uint32Array(0);
      return;
    }
    if (hr(m, v, p, E, y, b) < 0) {
      const M = g, k = p, $ = E;
      g = w, p = y, E = b, w = M, y = k, b = $;
    }
    const S = vM(m, v, p, E, y, b);
    this._cx = S.x, this._cy = S.y;
    for (let M = 0; M < a; M++)
      this._dists[M] = rh(e[2 * M], e[2 * M + 1], S.x, S.y);
    Mn(this._ids, this._dists, 0, a - 1), this._hullStart = d;
    let x = 3;
    n[d] = r[w] = g, n[g] = r[d] = w, n[w] = r[g] = d, i[d] = 0, i[g] = 1, i[w] = 2, s.fill(-1), s[this._hashKey(m, v)] = d, s[this._hashKey(p, E)] = g, s[this._hashKey(y, b)] = w, this.trianglesLen = 0, this._addTriangle(d, g, w, -1, -1, -1);
    for (let M = 0, k, $; M < this._ids.length; M++) {
      const O = this._ids[M], T = e[2 * O], I = e[2 * O + 1];
      if (M > 0 && Math.abs(T - k) <= B0 && Math.abs(I - $) <= B0 || (k = T, $ = I, O === d || O === g || O === w)) continue;
      let N = 0;
      for (let R = 0, D = this._hashKey(T, I); R < this._hashSize && (N = s[(D + R) % this._hashSize], !(N !== -1 && N !== n[N])); R++)
        ;
      N = r[N];
      let j = N, C;
      for (; C = n[j], hr(T, I, e[2 * j], e[2 * j + 1], e[2 * C], e[2 * C + 1]) >= 0; )
        if (j = C, j === N) {
          j = -1;
          break;
        }
      if (j === -1) continue;
      let F = this._addTriangle(j, O, n[j], -1, -1, i[j]);
      i[O] = this._legalize(F + 2), i[j] = F, x++;
      let q = n[j];
      for (; C = n[q], hr(T, I, e[2 * q], e[2 * q + 1], e[2 * C], e[2 * C + 1]) < 0; )
        F = this._addTriangle(q, O, C, i[O], -1, i[q]), i[O] = this._legalize(F + 2), n[q] = q, x--, q = C;
      if (j === N)
        for (; C = r[j], hr(T, I, e[2 * C], e[2 * C + 1], e[2 * j], e[2 * j + 1]) < 0; )
          F = this._addTriangle(C, O, j, -1, i[j], i[C]), this._legalize(F + 2), i[C] = F, n[j] = j, x--, j = C;
      this._hullStart = r[O] = j, n[j] = r[q] = O, n[O] = q, s[this._hashKey(T, I)] = O, s[this._hashKey(e[2 * j], e[2 * j + 1])] = j;
    }
    this.hull = new Uint32Array(x);
    for (let M = 0, k = this._hullStart; M < x; M++)
      this.hull[M] = k, k = n[k];
    this.triangles = this._triangles.subarray(0, this.trianglesLen), this.halfedges = this._halfedges.subarray(0, this.trianglesLen);
  }
  _hashKey(e, r) {
    return Math.floor(gM(e - this._cx, r - this._cy) * this._hashSize) % this._hashSize;
  }
  _legalize(e) {
    const { _triangles: r, _halfedges: n, coords: i } = this;
    let s = 0, a = 0;
    for (; ; ) {
      const o = n[e], c = e - e % 3;
      if (a = c + (e + 2) % 3, o === -1) {
        if (s === 0) break;
        e = Cs[--s];
        continue;
      }
      const h = o - o % 3, f = c + (e + 1) % 3, u = h + (o + 2) % 3, l = r[a], d = r[e], g = r[f], w = r[u];
      if (wM(
        i[2 * l],
        i[2 * l + 1],
        i[2 * d],
        i[2 * d + 1],
        i[2 * g],
        i[2 * g + 1],
        i[2 * w],
        i[2 * w + 1]
      )) {
        r[e] = w, r[o] = l;
        const m = n[u];
        if (m === -1) {
          let p = this._hullStart;
          do {
            if (this._hullTri[p] === u) {
              this._hullTri[p] = e;
              break;
            }
            p = this._hullPrev[p];
          } while (p !== this._hullStart);
        }
        this._link(e, m), this._link(o, n[a]), this._link(a, u);
        const v = h + (o + 1) % 3;
        s < Cs.length && (Cs[s++] = v);
      } else {
        if (s === 0) break;
        e = Cs[--s];
      }
    }
    return a;
  }
  _link(e, r) {
    this._halfedges[e] = r, r !== -1 && (this._halfedges[r] = e);
  }
  // add a new triangle given vertex indices and adjacent half-edge ids
  _addTriangle(e, r, n, i, s, a) {
    const o = this.trianglesLen;
    return this._triangles[o] = e, this._triangles[o + 1] = r, this._triangles[o + 2] = n, this._link(o, i), this._link(o + 1, s), this._link(o + 2, a), this.trianglesLen += 3, o;
  }
}
function gM(t, e) {
  const r = t / (Math.abs(t) + Math.abs(e));
  return (e > 0 ? 3 - r : 1 + r) / 4;
}
function rh(t, e, r, n) {
  const i = t - r, s = e - n;
  return i * i + s * s;
}
function wM(t, e, r, n, i, s, a, o) {
  const c = t - a, h = e - o, f = r - a, u = n - o, l = i - a, d = s - o, g = c * c + h * h, w = f * f + u * u, m = l * l + d * d;
  return c * (u * m - w * d) - h * (f * m - w * l) + g * (f * d - u * l) < 0;
}
function _M(t, e, r, n, i, s) {
  const a = r - t, o = n - e, c = i - t, h = s - e, f = a * a + o * o, u = c * c + h * h, l = 0.5 / (a * h - o * c), d = (h * f - o * u) * l, g = (a * u - c * f) * l;
  return d * d + g * g;
}
function vM(t, e, r, n, i, s) {
  const a = r - t, o = n - e, c = i - t, h = s - e, f = a * a + o * o, u = c * c + h * h, l = 0.5 / (a * h - o * c), d = t + (h * f - o * u) * l, g = e + (a * u - c * f) * l;
  return { x: d, y: g };
}
function Mn(t, e, r, n) {
  if (n - r <= 20)
    for (let i = r + 1; i <= n; i++) {
      const s = t[i], a = e[s];
      let o = i - 1;
      for (; o >= r && e[t[o]] > a; ) t[o + 1] = t[o--];
      t[o + 1] = s;
    }
  else {
    const i = r + n >> 1;
    let s = r + 1, a = n;
    Bn(t, i, s), e[t[r]] > e[t[n]] && Bn(t, r, n), e[t[s]] > e[t[n]] && Bn(t, s, n), e[t[r]] > e[t[s]] && Bn(t, r, s);
    const o = t[s], c = e[o];
    for (; ; ) {
      do
        s++;
      while (e[t[s]] < c);
      do
        a--;
      while (e[t[a]] > c);
      if (a < s) break;
      Bn(t, s, a);
    }
    t[r + 1] = t[a], t[a] = o, n - s + 1 >= a - r ? (Mn(t, e, s, n), Mn(t, e, r, a - 1)) : (Mn(t, e, r, a - 1), Mn(t, e, s, n));
  }
}
function Bn(t, e, r) {
  const n = t[e];
  t[e] = t[r], t[r] = n;
}
function EM(t) {
  return t[0];
}
function bM(t) {
  return t[1];
}
class SM {
  bs;
  width;
  constructor(e, r) {
    this.width = e, this.bs = r;
  }
  /**
   * Add a number to the set.
   *
   * @param idx The number to add. Must be 0 <= idx < len.
   */
  add(e) {
    const r = Math.floor(e / this.width), n = e % this.width;
    return this.bs[r] |= 1 << n, this;
  }
  /**
   * Delete a number from the set.
   *
   * @param idx The number to delete. Must be 0 <= idx < len.
   */
  delete(e) {
    const r = Math.floor(e / this.width), n = e % this.width;
    return this.bs[r] &= ~(1 << n), this;
  }
  /**
   * Add or delete a number in the set, depending on the second argument.
   *
   * @param idx The number to add or delete. Must be 0 <= idx < len.
   * @param val If true, add the number, otherwise delete.
   */
  set(e, r) {
    const n = Math.floor(e / this.width), i = 1 << e % this.width;
    return this.bs[n] ^= (-Number(r) ^ this.bs[n]) & i, r;
  }
  /**
   * Whether the number is in the set.
   *
   * @param idx The number to test. Must be 0 <= idx < len.
   */
  has(e) {
    const r = Math.floor(e / this.width), n = e % this.width;
    return (this.bs[r] & 1 << n) !== 0;
  }
  /**
   * Iterate over the numbers that are in the set.
   */
  forEach(e) {
    const r = this.bs.length;
    for (let n = 0; n < r; n++) {
      let i = 0;
      for (; this.bs[n] && i < this.width; )
        this.bs[n] & 1 << i && e(n * this.width + i), i++;
    }
    return this;
  }
}
class Z0 extends SM {
  constructor(e) {
    super(8, new Uint8Array(Math.ceil(e / 8)).fill(0));
  }
}
function Qr(t) {
  return t % 3 === 2 ? t - 2 : t + 1;
}
function wr(t) {
  return t % 3 === 0 ? t + 2 : t - 1;
}
function V0(t, e, r, n, i, s, a, o) {
  const c = hr(t, e, i, s, a, o), h = hr(r, n, i, s, a, o);
  if (c > 0 && h > 0 || c < 0 && h < 0)
    return !1;
  const f = hr(i, s, t, e, r, n), u = hr(a, o, t, e, r, n);
  return f > 0 && u > 0 || f < 0 && u < 0 ? !1 : c === 0 && h === 0 && f === 0 && u === 0 ? !(Math.max(i, a) < Math.min(t, r) || Math.max(t, r) < Math.min(i, a) || Math.max(s, o) < Math.min(e, n) || Math.max(e, n) < Math.min(s, o)) : !0;
}
class MM {
  /**
   * The triangulation object from Delaunator.
   */
  del;
  constructor(e) {
    this.del = e;
  }
}
class xM extends MM {
  vertMap;
  flips;
  consd;
  /**
   * Create a Constrain instance.
   *
   * @param del The triangulation output from Delaunator.
   * @param edges If provided, constrain these edges via constrainAll.
   */
  constructor(e, r) {
    if (!e || typeof e != "object" || !e.triangles || !e.halfedges || !e.coords)
      throw new Error("Expected an object with Delaunator output");
    if (e.triangles.length % 3 || e.halfedges.length !== e.triangles.length || e.coords.length % 2)
      throw new Error("Delaunator output appears inconsistent");
    if (e.triangles.length < 3)
      throw new Error("No edges in triangulation");
    super(e);
    const n = 2 ** 32 - 1, i = e.coords.length >> 1, s = e.triangles.length;
    this.vertMap = new Uint32Array(i).fill(n), this.flips = new Z0(s), this.consd = new Z0(s);
    for (let a = 0; a < s; a++) {
      const o = e.triangles[a];
      this.vertMap[o] === n && this.updateVert(a);
    }
    r && this.constrainAll(r);
  }
  /**
   * Constrain the triangulation such that there is an edge between p1 and p2.
   */
  constrainOne(e, r) {
    const { triangles: n, halfedges: i } = this.del, s = this.vertMap[e];
    let a = s;
    do {
      const h = n[a], f = Qr(a);
      if (h === r)
        return this.protect(a);
      const u = wr(a), l = n[u];
      if (l === r)
        return this.protect(f), f;
      if (this.intersectSegments(e, r, l, h)) {
        a = u;
        break;
      }
      a = i[f];
    } while (a !== -1 && a !== s);
    let o = a, c = -1;
    for (; a !== -1; ) {
      const h = i[a], f = wr(a), u = wr(h), l = Qr(h);
      if (h === -1)
        throw new Error("Constraining edge exited the hull");
      if (this.consd.has(a))
        throw new Error("Edge intersects already constrained edge");
      if (this.isCollinear(e, r, n[a]) || this.isCollinear(e, r, n[h]))
        throw new Error("Constraining edge intersects point");
      if (!this.intersectSegments(
        n[a],
        n[h],
        n[f],
        n[u]
      )) {
        if (c === -1 && (c = a), n[u] === r) {
          if (a === c)
            throw new Error("Infinite loop: non-convex quadrilateral");
          a = c, c = -1;
          continue;
        }
        if (this.intersectSegments(
          e,
          r,
          n[u],
          n[h]
        ))
          a = u;
        else if (this.intersectSegments(
          e,
          r,
          n[l],
          n[u]
        ))
          a = l;
        else if (c === a)
          throw new Error("Infinite loop: no further intersect after non-convex");
        continue;
      }
      if (this.flipDiagonal(a), this.intersectSegments(
        e,
        r,
        n[f],
        n[u]
      ) && (c === -1 && (c = f), c === f))
        throw new Error("Infinite loop: flipped diagonal still intersects");
      n[u] === r ? (o = u, a = c, c = -1) : this.intersectSegments(
        e,
        r,
        n[l],
        n[u]
      ) && (a = l);
    }
    return this.protect(o), this.delaunify(!0), this.findEdge(e, r);
  }
  /**
   * Fix the Delaunay condition.
   */
  delaunify(e = !1) {
    const { halfedges: r } = this.del, n = this.flips, i = this.consd, s = r.length;
    let a;
    do {
      a = 0;
      for (let o = 0; o < s; o++) {
        if (i.has(o))
          continue;
        n.delete(o);
        const c = r[o];
        c !== -1 && (n.delete(c), this.isDelaunay(o) || (this.flipDiagonal(o), a++));
      }
    } while (e && a > 0);
    return this;
  }
  /**
   * Call constrainOne on each edge.
   */
  constrainAll(e) {
    const r = e.length;
    for (let n = 0; n < r; n++) {
      const i = e[n];
      this.constrainOne(i[0], i[1]);
    }
    return this;
  }
  /**
   * Whether an edge is constrained.
   */
  isConstrained(e) {
    return this.consd.has(e);
  }
  /**
   * Find the edge that points from p1 -> p2. If there is only an edge from
   * p2 -> p1 (i.e. it is on the hull), returns the negative id of it.
   */
  findEdge(e, r) {
    const n = this.vertMap[r], { triangles: i, halfedges: s } = this.del;
    let a = n, o = -1;
    do {
      if (i[a] === e)
        return a;
      o = Qr(a), a = s[o];
    } while (a !== -1 && a !== n);
    return i[Qr(o)] === e ? -o : 1 / 0;
  }
  /**
   * Mark an edge as constrained, i.e. should not be touched by `delaunify`.
   */
  protect(e) {
    const r = this.del.halfedges[e], n = this.flips, i = this.consd;
    return n.delete(e), i.add(e), r !== -1 ? (n.delete(r), i.add(r), r) : -e;
  }
  /**
   * Mark an edge as flipped unless constrained.
   */
  markFlip(e) {
    const r = this.del.halfedges, n = this.flips;
    if (this.consd.has(e))
      return !1;
    const i = r[e];
    return i !== -1 && (n.add(e), n.add(i)), !0;
  }
  /**
   * Flip the edge shared by two triangles.
   */
  flipDiagonal(e) {
    const { triangles: r, halfedges: n } = this.del, i = this.flips, s = this.consd, a = n[e], o = wr(e), c = Qr(e), h = wr(a), f = Qr(a), u = n[o], l = n[h];
    if (s.has(e))
      throw new Error("Trying to flip a constrained edge");
    return r[e] = r[h], n[e] = l, i.set(e, i.has(h)) || s.set(e, s.has(h)), l !== -1 && (n[l] = e), n[o] = h, r[a] = r[o], n[a] = u, i.set(a, i.has(o)) || s.set(a, s.has(o)), u !== -1 && (n[u] = a), n[h] = o, this.markFlip(e), this.markFlip(c), this.markFlip(a), this.markFlip(f), i.add(o), s.delete(o), i.add(h), s.delete(h), this.updateVert(e), this.updateVert(c), this.updateVert(a), this.updateVert(f), o;
  }
  /**
   * Whether point p1, p2, and p are collinear.
   */
  isCollinear(e, r, n) {
    const i = this.del.coords;
    return hr(
      i[e * 2],
      i[e * 2 + 1],
      i[r * 2],
      i[r * 2 + 1],
      i[n * 2],
      i[n * 2 + 1]
    ) === 0;
  }
  /**
   * Whether the triangle formed by p1, p2, p3 keeps px outside the circumcircle.
   */
  inCircle(e, r, n, i) {
    const s = this.del.coords;
    return GS(
      s[e * 2],
      s[e * 2 + 1],
      s[r * 2],
      s[r * 2 + 1],
      s[n * 2],
      s[n * 2 + 1],
      s[i * 2],
      s[i * 2 + 1]
    ) < 0;
  }
  /**
   * Whether the triangles sharing edg conform to the Delaunay condition.
   */
  isDelaunay(e) {
    const { triangles: r, halfedges: n } = this.del, i = n[e];
    if (i === -1)
      return !0;
    const s = r[wr(e)], a = r[e], o = r[Qr(e)], c = r[wr(i)];
    return !this.inCircle(s, a, o, c);
  }
  /**
   * Update the vertex -> incoming edge map.
   */
  updateVert(e) {
    const { triangles: r, halfedges: n } = this.del, i = this.vertMap, s = r[e];
    let a = wr(e), o = n[a];
    for (; o !== -1 && o !== e; )
      a = wr(o), o = n[a];
    return i[s] = a, a;
  }
  /**
   * Whether the segments between vertices intersect.
   */
  intersectSegments(e, r, n, i) {
    const s = this.del.coords;
    return e === n || e === i || r === n || r === i ? !1 : V0(
      s[e * 2],
      s[e * 2 + 1],
      s[r * 2],
      s[r * 2 + 1],
      s[n * 2],
      s[n * 2 + 1],
      s[i * 2],
      s[i * 2 + 1]
    );
  }
  static intersectSegments = V0;
}
function Ls(t, e, r) {
  if (e || (e = []), typeof t != "object" || t.type !== "FeatureCollection")
    throw "Argument points must be FeatureCollection";
  if (!Array.isArray(e)) throw "Argument points must be Array of Array";
  const n = t.features.map(
    (c) => c.geometry.coordinates
  ), i = Vh.from(n);
  let s;
  const a = [];
  i.triangles.length !== 0 && e.length !== 0 && (s = new xM(i), s.constrainAll(e));
  for (let c = 0; c < i.triangles.length; c += 3)
    a.push([i.triangles[c], i.triangles[c + 1], i.triangles[c + 2]]);
  const o = ["a", "b", "c"];
  return Xe(
    a.map((c) => {
      const h = {}, f = c.map((u, l) => {
        const d = t.features[u], g = d.geometry.coordinates, w = [g[0], g[1]];
        return g.length === 3 ? w[2] = g[2] : h[o[l]] = d.properties[r], w;
      });
      return f[3] = f[0], _i([f], h);
    })
  );
}
function kM(t, e) {
  const r = [[], [], [], []], n = [];
  return Object.keys(t).forEach((i) => {
    const s = t[i], a = s.forw, o = s.bakw, c = [
      a[0] - e.forw[0],
      a[1] - e.forw[1]
    ], h = [
      o[0] - e.bakw[0],
      e.bakw[1] - o[1]
    ], f = { forw: c, bakw: h };
    if (n.push(f), c[0] === 0 || c[1] === 0)
      return;
    let u = 0;
    c[0] > 0 && (u += 1), c[1] > 0 && (u += 2), r[u].push(f);
  }), { perQuad: r, aggregate: n };
}
function $M(t) {
  let e = 1 / 0, r = 0, n = 0;
  return t.forEach((i) => {
    const { forw: s, bakw: a } = i, o = Math.hypot(s[0], s[1]), c = Math.hypot(a[0], a[1]);
    if (c === 0) return;
    const h = o / c, f = Math.atan2(s[0], s[1]) - Math.atan2(a[0], a[1]);
    e = Math.min(e, h), r += Math.cos(f), n += Math.sin(f);
  }), isFinite(e) ? [e, Math.atan2(n, r)] : [1, 0];
}
function IM(t, e, r) {
  const { perQuad: n, aggregate: i } = kM(t, e), s = n.every((o) => o.length > 0), a = (r === "birdeye" ? s ? n : [i] : [i]).map((o) => $M(o));
  return a.length === 1 ? [a[0], a[0], a[0], a[0]] : a;
}
function PM(t, e) {
  let r = 0;
  return t[0] > e[0] && (r += 1), t[1] > e[1] && (r += 2), r;
}
function AM(t, e, r) {
  const n = [
    t[0] - e.forw[0],
    t[1] - e.forw[1]
  ], i = Math.sqrt(n[0] ** 2 + n[1] ** 2) / r[0], s = Math.atan2(n[0], n[1]) - r[1];
  return [
    e.bakw[0] + i * Math.sin(s),
    e.bakw[1] - i * Math.cos(s)
  ];
}
function NM(t, e, r, n) {
  const i = e[0] - t[0], s = e[1] - t[1];
  if (Math.abs(i) < 1e-12 && Math.abs(s) < 1e-12) return null;
  const a = n[0] - r[0], o = n[1] - r[1], c = r[0] - t[0], h = r[1] - t[1], f = i * o - s * a;
  if (Math.abs(f) < 1e-12) return null;
  const u = (c * o - h * a) / f, l = (c * s - h * i) / f;
  return u <= 1e-10 || l < -1e-10 || l > 1 + 1e-10 ? null : { t: u, point: [t[0] + u * i, t[1] + u * s] };
}
function OM(t, e, r) {
  const n = r.length;
  let i = -1 / 0, s = null;
  for (let a = 0; a < n; a++) {
    const o = (a + 1) % n, c = NM(
      t,
      e,
      r[a].bakw,
      r[o].bakw
    );
    c && c.t > i && (i = c.t, s = c.point);
  }
  return s;
}
function H0(t, e) {
  const r = Math.atan2(t[0] - e[0], t[1] - e[1]) * (180 / Math.PI);
  return r < 0 ? r + 360 : r;
}
function K0(t, e, r, n, i, s) {
  const a = e[0] - t[0], o = e[1] - t[1];
  if (a === 0 && o === 0) return null;
  const c = [];
  if (a !== 0)
    for (const f of [r, n]) {
      const u = (f - t[0]) / a;
      if (u > 0) {
        const l = t[1] + u * o;
        l >= i && l <= s && c.push({ t: u, x: f, y: l });
      }
    }
  if (o !== 0)
    for (const f of [i, s]) {
      const u = (f - t[1]) / o;
      if (u > 0) {
        const l = t[0] + u * a;
        l >= r && l <= n && c.push({ t: u, x: l, y: f });
      }
    }
  if (c.length === 0) return null;
  c.sort((f, u) => f.t - u.t);
  const h = c[0];
  return [h.x, h.y];
}
function X0(t, e, r) {
  const n = t.length, i = new Array(n).fill(1);
  for (const s of e)
    for (let a = 0; a < n; a++) {
      const o = (a + 1) % n, c = $0([t[a].bakw, t[o].bakw]), h = $0([r.bakw, s.bakw]), f = JS(c, h);
      if (f.features.length > 0 && f.features[0].geometry) {
        const u = f.features[0], l = Math.sqrt(
          Math.pow(s.bakw[0] - r.bakw[0], 2) + Math.pow(s.bakw[1] - r.bakw[1], 2)
        ), d = Math.sqrt(
          Math.pow(u.geometry.coordinates[0] - r.bakw[0], 2) + Math.pow(u.geometry.coordinates[1] - r.bakw[1], 2)
        ), g = l / d;
        g > i[a] && (i[a] = g), g > i[o] && (i[o] = g);
      }
    }
  t.forEach((s, a) => {
    const o = i[a];
    s.bakw = [
      (s.bakw[0] - r.bakw[0]) * o + r.bakw[0],
      (s.bakw[1] - r.bakw[1]) * o + r.bakw[1]
    ];
  });
}
function Np(t, e, r) {
  const { convexBuf: n, centroid: i, allGcps: s, minx: a, maxx: o, miny: c, maxy: h } = t, f = IM(n, i, e), u = [
    [a, c],
    [o, c],
    [o, h],
    [a, h]
  ].map((y) => ({
    forw: y,
    bakw: AM(
      y,
      i,
      f[PM(y, i.forw)]
    )
  }));
  if (u.sort(
    (y, b) => Math.atan2(y.forw[0] - i.forw[0], y.forw[1] - i.forw[1]) - Math.atan2(b.forw[0] - i.forw[0], b.forw[1] - i.forw[1])
  ), X0(u, s, i), !r) return u;
  const l = 4, d = u.map(
    (y) => Math.atan2(y.forw[0] - i.forw[0], y.forw[1] - i.forw[1])
  ), g = u.map(
    (y) => Math.atan2(
      y.bakw[0] - i.bakw[0],
      -(y.bakw[1] - i.bakw[1])
    )
  );
  function w(y) {
    for (let b = 0; b < l; b++) {
      const S = (b + 1) % l, x = d[b], M = b < l - 1 ? d[S] : d[S] + 2 * Math.PI;
      let k = y;
      for (; k < x; ) k += 2 * Math.PI;
      for (; k >= x + 2 * Math.PI; ) k -= 2 * Math.PI;
      if (k >= x && k < M)
        return { i: b, j: S, frac: (k - x) / (M - x) };
    }
    return { i: 0, j: 1, frac: 0 };
  }
  function m(y) {
    const { i: b, j: S, frac: x } = w(y), M = g[b];
    let k = g[S] - M;
    for (; k > Math.PI; ) k -= 2 * Math.PI;
    for (; k < -Math.PI; ) k += 2 * Math.PI;
    return M + x * k;
  }
  const v = new Set(
    u.map(
      (y) => Math.floor(H0(y.forw, i.forw) / 10) % 36
    )
  ), p = s.map((y) => ({
    forw: y.forw,
    bakw: y.bakw,
    angleDeg: H0(y.forw, i.forw),
    forwDist: Math.hypot(y.forw[0] - i.forw[0], y.forw[1] - i.forw[1])
  })), E = [];
  for (let y = 0; y < 36; y++) {
    if (v.has(y)) continue;
    const b = y * 10, S = p.filter(
      (I) => I.angleDeg >= b && I.angleDeg < b + 10
    );
    let x = null;
    if (S.length > 0) {
      const I = S.reduce((N, j) => j.forwDist > N.forwDist ? j : N);
      x = K0(i.forw, I.forw, a, o, c, h);
    }
    if (!x) {
      const I = (b + 5) % 360 * (Math.PI / 180), N = [
        i.forw[0] + Math.sin(I),
        i.forw[1] + Math.cos(I)
      ];
      x = K0(i.forw, N, a, o, c, h);
    }
    if (!x) continue;
    const M = [x[0] - i.forw[0], x[1] - i.forw[1]], k = Math.atan2(M[0], M[1]), $ = m(k), O = [
      i.bakw[0] + Math.sin($),
      i.bakw[1] - Math.cos($)
    ], T = OM(i.bakw, O, u);
    T && E.push({ forw: x, bakw: T });
  }
  const _ = [...u, ...E];
  return _.sort(
    (y, b) => Math.atan2(y.forw[0] - i.forw[0], y.forw[1] - i.forw[1]) - Math.atan2(b.forw[0] - i.forw[0], b.forw[1] - i.forw[1])
  ), X0(_, s, i), _;
}
function RM(t, e = !1) {
  return Np(t, "plain", e);
}
function DM(t, e = !1) {
  return Np(t, "birdeye", e);
}
function jM(t) {
  const e = new TM(t).findSegmentIntersections(), r = Dp(e), n = /* @__PURE__ */ new Map();
  return r.forEach((i) => {
    n.set(`${i.x}:${i.y}`, i);
  }), Array.from(n.values()).map(
    (i) => Cr([i.x, i.y])
  );
}
class TM {
  /**
   * 座標データの配列
   * _xx, _yy: Float64Array形式で座標を保持
   * _ii: 各線分の開始インデックス
   * _nn: 各線分の頂点数
   */
  _xx;
  _yy;
  // coordinates data
  _ii;
  _nn;
  // indexes, sizes
  _zz = null;
  _zlimit = 0;
  // simplification
  _bb = null;
  _allBounds = null;
  // bounding boxes
  _arcIter = null;
  _filteredArcIter = null;
  // path iterators
  buf;
  /**
   * 線分群からArcCollectionを初期化
   * @param coords - 線分群の座標配列
   */
  constructor(e) {
    this.initArcs(e);
  }
  initArcs(e) {
    const r = [], n = [], i = e.map((s) => {
      const a = s ? s.length : 0;
      for (let o = 0; o < a; o++)
        r.push(s[o][0]), n.push(s[o][1]);
      return a;
    });
    this.initXYData(i, r, n);
  }
  initXYData(e, r, n) {
    const i = e.length;
    this._xx = new Float64Array(r), this._yy = new Float64Array(n), this._nn = new Uint32Array(e), this._zz = null, this._zlimit = 0, this._filteredArcIter = null, this._ii = new Uint32Array(i);
    let s = 0;
    for (let a = 0; a < i; a++)
      this._ii[a] = s, s += e[a];
    (s != this._xx.length || this._xx.length != this._yy.length) && Hh("ArcCollection#initXYData() Counting error"), this.initBounds(), this._arcIter = new rx(this._xx, this._yy);
  }
  initBounds() {
    const e = this.calcArcBounds_(this._xx, this._yy, this._nn);
    this._bb = e.bb, this._allBounds = e.bounds;
  }
  /**
   * データの境界を計算
   * @returns バウンディングボックス情報
   */
  calcArcBounds_(e, r, n) {
    const i = n.length, s = new Float64Array(i * 4), a = new oi();
    let o = 0, c, h, f;
    for (let u = 0; u < i; u++)
      c = n[u], c > 0 && (h = u * 4, f = nx(e, r, o, c), s[h++] = f[0], s[h++] = f[1], s[h++] = f[2], s[h] = f[3], o += c, a.mergeBounds(f));
    return {
      bb: s,
      bounds: a
    };
  }
  getBounds() {
    return this._allBounds ? this._allBounds.clone() : new oi();
  }
  // @cb function(i, j, xx, yy)
  forEachSegment(e) {
    let r = 0;
    for (let n = 0, i = this.size(); n < i; n++)
      r += this.forEachArcSegment(n, e);
    return r;
  }
  size() {
    return this._ii && this._ii.length || 0;
  }
  // @cb function(i, j, xx, yy)
  forEachArcSegment(e, r) {
    const n = e >= 0, i = n ? e : ~e, s = this.getRetainedInterval(), a = this._nn[i], o = n ? 1 : -1;
    let c = n ? this._ii[i] : this._ii[i] + a - 1, h = c, f = 0;
    for (let u = 1; u < a; u++)
      h += o, (s === 0 || this._zz[h] >= s) && (r(c, h, this._xx, this._yy), c = h, f++);
    return f;
  }
  getRetainedInterval() {
    return this._zlimit;
  }
  // Give access to raw data arrays...
  getVertexData() {
    return {
      xx: this._xx,
      yy: this._yy,
      zz: this._zz,
      bb: this._bb,
      nn: this._nn,
      ii: this._ii
    };
  }
  getUint32Array(e) {
    const r = e * 4;
    return (!this.buf || this.buf.byteLength < r) && (this.buf = new ArrayBuffer(r)), new Uint32Array(this.buf, 0, e);
  }
  // Return average magnitudes of dx, dy (with simplification)
  getAvgSegment2() {
    let e = 0, r = 0;
    const n = this.forEachSegment(
      (i, s, a, o) => {
        e += Math.abs(a[i] - a[s]), r += Math.abs(o[i] - o[s]);
      }
    );
    return [e / n || 0, r / n || 0];
  }
  /**
   * 交差判定のためのストライプ数を計算
   * 線分の平均長さに基づいて最適な分割数を決定
   */
  calcSegmentIntersectionStripeCount() {
    const e = this.getBounds().height(), r = this.getAvgSegment2()[1];
    let n = 1;
    return r > 0 && e > 0 && (n = Math.ceil(e / r / 20)), n || 1;
  }
  /**
   * 線分の交差を検出
   * ストライプ分割による効率的な判定を実装
   *
   * @returns 検出された交差点の配列
   */
  findSegmentIntersections() {
    const e = this.getBounds(), r = e.ymin || 0, n = (e.ymax || 0) - r, i = this.calcSegmentIntersectionStripeCount(), s = new Uint32Array(i), a = i > 1 ? (w) => Math.floor((i - 1) * (w - r) / n) : () => 0;
    let o, c;
    this.forEachSegment(
      (w, m, v, p) => {
        let E = a(p[w]);
        const _ = a(p[m]);
        for (; s[E] = s[E] + 2, E != _; )
          E += _ > E ? 1 : -1;
      }
    );
    const h = this.getUint32Array(FM(s));
    let f = 0;
    const u = [];
    GM(s, (w) => {
      const m = f;
      f += w, u.push(h.subarray(m, f));
    }), zM(s, 0), this.forEachSegment(
      (w, m, v, p) => {
        let E = a(p[w]);
        const _ = a(p[m]);
        let y, b;
        for (; y = s[E], s[E] = y + 2, b = u[E], b[y] = w, b[y + 1] = m, E != _; )
          E += _ > E ? 1 : -1;
      }
    );
    const l = this.getVertexData(), d = [];
    let g;
    for (o = 0; o < i; o++)
      if (l.xx && l.yy)
        for (g = qM(u[o], l.xx, l.yy), c = 0; c < g.length; c++)
          d.push(g[c]);
    return Dp(d);
  }
}
function Hh(...t) {
  const e = t.join(" ");
  throw new Error(e);
}
function Kh(t) {
  return t ? LM(t) ? !0 : CM(t) ? !1 : t.length === 0 ? !0 : t.length > 0 : !1;
}
function CM(t) {
  return t != null && t.toString === String.prototype.toString;
}
function LM(t) {
  return Array.isArray(t);
}
function FM(t, e) {
  Kh(t) || Hh("utils.sum() expects an array, received:", t);
  let r = 0, n;
  for (let i = 0, s = t.length; i < s; i++)
    n = t[i], n && (r += n);
  return r;
}
function GM(t, e, r) {
  if (!Kh(t))
    throw new Error(`#forEach() takes an array-like argument. ${t}`);
  for (let n = 0, i = t.length; n < i; n++)
    e.call(r, t[n], n);
}
function zM(t, e) {
  for (let r = 0, n = t.length; r < n; r++)
    t[r] = e;
  return t;
}
function qM(t, e, r) {
  const n = t.length - 2, i = [];
  let s, a, o, c, h, f, u, l, d, g, w, m, v, p, E, _, y;
  for (YM(e, t), _ = 0; _ < n; ) {
    for (s = t[_], a = t[_ + 1], h = e[s], f = e[a], d = r[s], g = r[a], y = _; y < n && (y += 2, o = t[y], u = e[o], !(f < u)); ) {
      if (w = r[o], c = t[y + 1], l = e[c], m = r[c], d >= w) {
        if (d > m && g > w && g > m) continue;
      } else if (d < m && g < w && g < m) continue;
      s == o || s == c || a == o || a == c || (v = UM(
        h,
        d,
        f,
        g,
        u,
        w,
        l,
        m
      ), v && (p = [s, a], E = [o, c], i.push(J0(v, p, E, e, r)), v.length == 4 && i.push(
        J0(v.slice(2), p, E, e, r)
      )));
    }
    _ += 2;
  }
  return i;
}
function UM(t, e, r, n, i, s, a, o) {
  const c = BM(t, e, r, n, i, s, a, o);
  let h = null;
  return c && (h = ZM(t, e, r, n, i, s, a, o), h ? JM(t, e, r, n, i, s, a, o) && (h = null) : h = WM(t, e, r, n, i, s, a, o)), h;
}
function BM(t, e, r, n, i, s, a, o) {
  return Kn(t, e, r, n, i, s) * Kn(t, e, r, n, a, o) <= 0 && Kn(i, s, a, o, t, e) * Kn(i, s, a, o, r, n) <= 0;
}
function Kn(t, e, r, n, i, s) {
  return Op(t - i, e - s, r - i, n - s);
}
function Op(t, e, r, n) {
  return t * n - e * r;
}
function ZM(t, e, r, n, i, s, a, o) {
  let c = Fs(t, e, r, n, i, s, a, o), h;
  return c && (h = HM(c[0], c[1], t, e, r, n, i, s, a, o), h == 1 ? c = Fs(r, n, t, e, i, s, a, o) : h == 2 ? c = Fs(i, s, a, o, t, e, r, n) : h == 3 && (c = Fs(a, o, i, s, t, e, r, n))), c && XM(c, t, e, r, n, i, s, a, o), c;
}
function Fs(t, e, r, n, i, s, a, o) {
  const c = Op(r - t, n - e, a - i, o - s), h = 1e-18;
  let f;
  if (c === 0) return null;
  const u = Kn(i, s, a, o, t, e) / c;
  return c <= h && c >= -h ? f = VM(t, e, r, n, i, s, a, o) : f = [t + u * (r - t), e + u * (n - e)], f;
}
function VM(t, e, r, n, i, s, a, o) {
  let c = null;
  return !vr(t, i, a) && !vr(e, s, o) ? c = [t, e] : !vr(r, i, a) && !vr(n, s, o) ? c = [r, n] : !vr(i, t, r) && !vr(s, e, n) ? c = [i, s] : !vr(a, t, r) && !vr(o, e, n) && (c = [a, o]), c;
}
function vr(t, e, r) {
  let n;
  return e < r ? n = t < e || t > r : e > r ? n = t > e || t < r : n = t != e, n;
}
function HM(t, e, ...r) {
  let n = -1, i = 1 / 0, s;
  for (let a = 0, o = 0, c = r.length; o < c; a++, o += 2)
    s = KM(t, e, r[o], r[o + 1]), s < i && (i = s, n = a);
  return n;
}
function KM(t, e, r, n) {
  const i = t - r, s = e - n;
  return i * i + s * s;
}
function XM(t, e, r, n, i, s, a, o, c) {
  let h = t[0], f = t[1];
  h = Gs(h, e, n), h = Gs(h, s, o), f = Gs(f, r, i), f = Gs(f, a, c), t[0] = h, t[1] = f;
}
function Gs(t, e, r) {
  let n;
  return vr(t, e, r) && (n = Math.abs(t - e) < Math.abs(t - r) ? e : r, t = n), t;
}
function WM(t, e, r, n, i, s, a, o) {
  const c = Math.min(t, r, i, a), h = Math.max(t, r, i, a), f = Math.min(e, n, s, o), u = Math.max(e, n, s, o), l = u - f > h - c;
  let d = [];
  return (l ? Or(e, f, u) : Or(t, c, h)) && d.push(t, e), (l ? Or(n, f, u) : Or(r, c, h)) && d.push(r, n), (l ? Or(s, f, u) : Or(i, c, h)) && d.push(i, s), (l ? Or(o, f, u) : Or(a, c, h)) && d.push(a, o), (d.length != 2 && d.length != 4 || d.length == 4 && d[0] == d[2] && d[1] == d[3]) && (d = null), d;
}
function JM(t, e, r, n, i, s, a, o) {
  return t == i && e == s || t == a && e == o || r == i && n == s || r == a && n == o;
}
function Or(t, e, r) {
  return t > e && t < r;
}
function YM(t, e) {
  QM(t, e), Rp(t, e, 0, e.length - 2);
}
function QM(t, e) {
  for (let r = 0, n = e.length; r < n; r += 2)
    t[e[r]] > t[e[r + 1]] && tx(e, r, r + 1);
}
function tx(t, e, r) {
  const n = t[e];
  t[e] = t[r], t[r] = n;
}
function Rp(t, e, r, n) {
  let i = r, s = n, a, o;
  for (; i < n; ) {
    for (a = t[e[r + n >> 2 << 1]]; i <= s; ) {
      for (; t[e[i]] < a; ) i += 2;
      for (; t[e[s]] > a; ) s -= 2;
      i <= s && (o = e[i], e[i] = e[s], e[s] = o, o = e[i + 1], e[i + 1] = e[s + 1], e[s + 1] = o, i += 2, s -= 2);
    }
    if (s - r < 40 ? W0(t, e, r, s) : Rp(t, e, r, s), n - i < 40) {
      W0(t, e, i, n);
      return;
    }
    r = i, s = n;
  }
}
function W0(t, e, r, n) {
  let i, s;
  for (let a = r + 2; a <= n; a += 2) {
    i = e[a], s = e[a + 1];
    let o;
    for (o = a - 2; o >= r && t[i] < t[e[o]]; o -= 2)
      e[o + 2] = e[o], e[o + 3] = e[o + 1];
    e[o + 2] = i, e[o + 3] = s;
  }
}
function J0(t, e, r, n, i) {
  const s = t[0], a = t[1];
  e = Y0(s, a, e[0], e[1], n, i), r = Y0(s, a, r[0], r[1], n, i);
  const o = e[0] < r[0] ? e : r, c = o == e ? r : e;
  return { x: s, y: a, a: o, b: c };
}
function Y0(t, e, r, n, i, s) {
  let a = r < n ? r : n, o = a === r ? n : r;
  return i[a] == t && s[a] == e ? o = a : i[o] == t && s[o] == e && (a = o), [a, o];
}
function Dp(t) {
  const e = {};
  return t.filter((r) => {
    const n = ex(r);
    return n in e ? !1 : (e[n] = !0, !0);
  });
}
function ex(t) {
  return `${t.a.join(",")};${t.b.join(",")}`;
}
class rx {
  _i = 0;
  _n = 0;
  _inc = 1;
  _xx;
  _yy;
  i = 0;
  x = 0;
  y = 0;
  constructor(e, r) {
    this._xx = e, this._yy = r;
  }
}
function nx(t, e, r, n) {
  let i = r | 0;
  const s = isNaN(n) ? t.length - i : n + i;
  let a, o, c, h, f, u;
  if (s > 0)
    c = f = t[i], h = u = e[i];
  else return [void 0, void 0, void 0, void 0];
  for (i++; i < s; i++)
    a = t[i], o = e[i], a < c && (c = a), a > f && (f = a), o < h && (h = o), o > u && (u = o);
  return [c, h, f, u];
}
class oi {
  xmin;
  ymin;
  xmax;
  ymax;
  constructor(...e) {
    e.length > 0 && this.setBounds(e);
  }
  // Return a bounding box with the same extent as this one.
  cloneBounds() {
    return this.clone();
  }
  clone() {
    return new oi(
      this.xmin,
      this.ymin,
      this.xmax,
      this.ymax
    );
  }
  width() {
    return this.xmax - this.xmin || 0;
  }
  height() {
    return this.ymax - this.ymin || 0;
  }
  setBounds(e, r, n, i) {
    let s, a, o, c;
    if (arguments.length == 1)
      if (Kh(e)) {
        const h = e;
        s = h[0], a = h[1], o = h[2], c = h[3];
      } else {
        const h = e;
        s = h.xmin, a = h.ymin, o = h.xmax, c = h.ymax;
      }
    else
      s = e, a = r, o = n, c = i;
    return this.xmin = s, this.ymin = a, this.xmax = o, this.ymax = c, (s > o || a > c) && this.update(), this;
  }
  update() {
    let e;
    this.xmin > this.xmax && (e = this.xmin, this.xmin = this.xmax, this.xmax = e), this.ymin > this.ymax && (e = this.ymin, this.ymin = this.ymax, this.ymax = e);
  }
  mergeBounds(e, ...r) {
    let n, i, s, a;
    return e instanceof oi ? (n = e.xmin, i = e.ymin, s = e.xmax, a = e.ymax) : r.length == 3 ? (n = e, i = r[0], s = r[1], a = r[2]) : e.length == 4 ? (n = e[0], i = e[1], s = e[2], a = e[3]) : Hh("Bounds#mergeBounds() invalid argument:", e), this.xmin === void 0 ? this.setBounds(n, i, s, a) : (n < this.xmin && (this.xmin = n), i < this.ymin && (this.ymin = i), s > this.xmax && (this.xmax = s), a > this.ymax && (this.ymax = a)), this;
  }
}
function oa(t) {
  const e = ["a", "b", "c"].map(
    (r) => t.properties[r].index
  );
  return [
    [0, 1],
    [0, 2],
    [1, 2],
    [0, 1, 2]
  ].map(
    (r) => r.map((n) => e[n]).sort().join("-")
  ).sort();
}
function jp(t, e, r) {
  const n = oa(e.forw), i = oa(e.bakw);
  if (JSON.stringify(n) != JSON.stringify(i))
    throw `${JSON.stringify(e, null, 2)}
${JSON.stringify(
      n
    )}
${JSON.stringify(i)}`;
  for (let s = 0; s < n.length; s++) {
    const a = n[s];
    t[a] || (t[a] = []), t[a].push(e);
  }
  r && (r.forw.features.push(e.forw), r.bakw.features.push(e.bakw));
}
function Q0(t, e, r) {
  const n = oa(e.forw), i = oa(e.bakw);
  if (JSON.stringify(n) != JSON.stringify(i))
    throw `${JSON.stringify(e, null, 2)}
${JSON.stringify(n)}
${JSON.stringify(i)}`;
  if (n.forEach((s) => {
    const a = t[s];
    if (!a) return;
    const o = a.filter((c) => c !== e);
    o.length === 0 ? delete t[s] : t[s] = o;
  }), r) {
    const s = (a, o) => {
      !a || !o || (a.features = a.features.filter((c) => c !== o));
    };
    s(r.forw, e.forw), s(r.bakw, e.bakw);
  }
}
function zs(t, e, r) {
  return Cr(t, { target: { geom: e, index: r } });
}
function qs(t) {
  return Cr(t.properties.target.geom, {
    target: {
      geom: t.geometry.coordinates,
      index: t.properties.target.index
    }
  });
}
function tm(t, e) {
  const r = t.length, n = e.geometry.coordinates;
  return Array.from({ length: r }, (i, s) => s).map((i) => {
    const s = (i + 1) % r, a = t[i], o = t[s], c = a.geometry.coordinates, h = Math.atan2(
      c[0] - n[0],
      c[1] - n[1]
    ), f = [e, a, o, e].map(
      (d) => d.geometry.coordinates
    ), u = {
      a: {
        geom: e.properties.target.geom,
        index: e.properties.target.index
      },
      b: {
        geom: a.properties.target.geom,
        index: a.properties.target.index
      },
      c: {
        geom: o.properties.target.geom,
        index: o.properties.target.index
      }
    }, l = Xe([
      _i([f], u)
    ]);
    return [h, l];
  }).reduce(
    (i, s) => (i[0].push(s[0]), i[1].push(s[1]), i),
    [[], []]
  );
}
function ix(t) {
  const { tins: e, targets: r, includeReciprocals: n, numBoundaryVertices: i = 4 } = t, s = {};
  r.forEach((o) => {
    const c = e[o];
    if (!c || !c.features) return;
    s[o] = {};
    const h = {};
    c.features.forEach((f) => {
      const u = ["a", "b", "c"];
      for (let l = 0; l < 3; l++) {
        const d = (l + 1) % 3, g = u[l], w = u[d], m = f.properties[g].index, v = f.properties[w].index, p = [m, v].sort().join("-");
        if (h[p]) continue;
        h[p] = !0;
        const E = f.geometry.coordinates[0][l], _ = f.geometry.coordinates[0][d], y = f.properties[g].geom, b = f.properties[w].geom, S = Math.sqrt(
          Math.pow(y[0] - b[0], 2) + Math.pow(y[1] - b[1], 2)
        ) / Math.sqrt(
          Math.pow(E[0] - _[0], 2) + Math.pow(E[1] - _[1], 2)
        ), x = s[o];
        x[`${m}:${p}`] = S, x[`${v}:${p}`] = S;
      }
    });
  });
  const a = {};
  return n && (a.bakw = {}), r.forEach((o) => {
    const c = s[o];
    if (a[o] = {}, !c)
      return;
    const h = {};
    Object.keys(c).forEach((u) => {
      const [l] = u.split(":");
      h[l] || (h[l] = []), h[l].push(c[u]);
    }), Object.keys(h).forEach((u) => {
      const l = h[u], d = l.reduce((g, w) => g + w, 0) / l.length;
      a[o][u] = d, n && a.bakw && (a.bakw[u] = 1 / d);
    });
    let f = 0;
    for (let u = 0; u < i; u++) {
      const l = `b${u}`, d = a[o][l] || 0;
      f += d;
    }
    a[o].c = f / i, n && a.bakw && (a.bakw.c = 1 / a[o].c);
  }), a;
}
function Us(t, e = 1e-6) {
  const [r, n] = t[0], [i, s] = t[1], [a, o] = t[2];
  return Math.abs((i - r) * (o - n) - (a - r) * (s - n)) < e;
}
function sx(t, e) {
  const r = t.split("-");
  if (r.length !== 2 || !r.every((s) => /^-?\d+$/.test(s))) return !1;
  const [n, i] = r.map((s) => parseInt(s, 10)).sort((s, a) => s - a);
  return e.some((s) => {
    if (s.length !== 2) return !1;
    const a = s.map((c) => parseInt(`${c}`, 10));
    if (a.some((c) => Number.isNaN(c))) return !1;
    const o = a.sort((c, h) => c - h);
    return o[0] === n && o[1] === i;
  });
}
function Xn(t) {
  return ["a", "b", "c"].map((e, r) => ({
    prop: t.properties[e],
    geom: t.geometry.coordinates[0][r]
  }));
}
const ax = 10;
function ox(t, e, r, n, i, s) {
  if (!t && !e) return !1;
  const a = t ? 0 : 1, o = 1 - a, c = r[a], h = r[o];
  if (!c || !h) return !1;
  const f = Pe(h.geom);
  let u = !1, l = !1;
  for (let d = 0; d <= 1; d++) {
    const g = n[d];
    if (!g) continue;
    const w = [String(g.prop.index), String(c.prop.index)].sort().join("-"), m = i[w];
    if (!m || m.length < 2) continue;
    const v = m.find(
      (k) => k.bakw !== s[a].bakw
    );
    if (!v) continue;
    const p = Xn(v.bakw).find(
      (k) => String(k.prop.index) !== String(g.prop.index) && String(k.prop.index) !== String(c.prop.index)
    );
    if (!p) continue;
    u = !0;
    const E = Pe(p.geom), _ = Pe(g.geom), y = Pe(c.geom), b = y[0] - _[0], S = y[1] - _[1], x = b * (f[1] - _[1]) - S * (f[0] - _[0]), M = b * (E[1] - _[1]) - S * (E[0] - _[0]);
    if (x * M > 0) {
      l = !0;
      break;
    }
  }
  return u && !l;
}
function cx(t, e, r, n) {
  if (!t && !e) return !1;
  if (r[0] && r[1] && n[0] && n[1]) {
    const i = n.map((f) => Pe(f.geom)), s = r.map((f) => Pe(f.geom)), a = i[1][0] - i[0][0], o = i[1][1] - i[0][1], c = a * (s[0][1] - i[0][1]) - o * (s[0][0] - i[0][0]), h = a * (s[1][1] - i[0][1]) - o * (s[1][0] - i[0][0]);
    return c * h < 0;
  }
  return !1;
}
function hx(t, e, r) {
  const n = /* @__PURE__ */ new Set();
  let i = !1;
  for (let s = 0; s < ax; s++) {
    let a = !1;
    for (const o of Object.keys(e)) {
      if (n.has(o)) continue;
      n.add(o);
      const c = e[o];
      if (!c || c.length < 2) continue;
      const h = o.split("-");
      if (h.length !== 2 || sx(o, r)) continue;
      const f = Xn(c[0].bakw), u = Xn(c[1].bakw), l = Xn(c[0].forw), d = Xn(c[1].forw), g = h.map(
        (C) => f.find((F) => `${F.prop.index}` === C) || u.find((F) => `${F.prop.index}` === C)
      ), w = h.map(
        (C) => l.find((F) => `${F.prop.index}` === C) || d.find((F) => `${F.prop.index}` === C)
      );
      if (g.some((C) => !C) || w.some((C) => !C))
        continue;
      const m = [f, u].map(
        (C) => C.find((F) => !h.includes(`${F.prop.index}`))
      ), v = [l, d].map(
        (C) => C.find((F) => !h.includes(`${F.prop.index}`))
      );
      if (m.some((C) => !C) || v.some((C) => !C))
        continue;
      const p = c[0].bakw.geometry.coordinates[0].slice(0, 3).map((C) => Pe(C)), E = c[1].bakw.geometry.coordinates[0].slice(0, 3).map((C) => Pe(C)), _ = c[0].forw.geometry.coordinates[0].slice(0, 3).map((C) => Pe(C)), y = c[1].forw.geometry.coordinates[0].slice(0, 3).map((C) => Pe(C)), b = Us(p), S = Us(E), x = Us(_), M = Us(y), k = ox(
        b,
        S,
        m,
        g,
        e,
        c
      ), $ = cx(
        x,
        M,
        m,
        g
      );
      if (!(k || $ || em(
        Pe(m[0].geom),
        E
      ) || em(
        Pe(m[1].geom),
        p
      )))
        continue;
      const O = w.map(
        (C) => Pe(C.geom)
      ), T = v.map(
        (C) => Pe(C.geom)
      ), I = lx([
        ...O,
        ...T
      ]), N = ux(I), j = rm(
        O[0],
        O[1],
        T[0]
      ) + rm(
        O[0],
        O[1],
        T[1]
      );
      ph(N, j) && (Q0(e, c[0], t), Q0(e, c[1], t), g.forEach((C) => {
        if (!C) return;
        const F = [
          C.geom,
          m[0].geom,
          m[1].geom,
          C.geom
        ], q = {
          a: C.prop,
          b: m[0].prop,
          c: m[1].prop
        }, R = _i([F], q), D = Ce.counterTri(R);
        jp(e, {
          forw: D,
          bakw: R
        }, t);
      }), a = !0, i = !0);
    }
    if (!a) break;
  }
  return i;
}
function Pe(t) {
  return [t[0], t[1]];
}
function em(t, e) {
  const [r, n] = e[0], [i, s] = e[1], [a, o] = e[2], c = a - r, h = o - n, f = i - r, u = s - n, l = t[0] - r, d = t[1] - n, g = c * c + h * h, w = c * f + h * u, m = c * l + h * d, v = f * f + u * u, p = f * l + u * d, E = g * v - w * w;
  if (E === 0) return !1;
  const _ = 1 / E, y = (v * m - w * p) * _, b = (g * p - w * m) * _, S = 1e-9;
  return y >= -S && b >= -S && y + b <= 1 + S;
}
function lx(t) {
  const e = t.map((a) => a.slice()).filter(
    (a, o, c) => c.findIndex(
      (h) => ph(h[0], a[0]) && ph(h[1], a[1])
    ) === o
  );
  if (e.length <= 1) return e;
  const r = e.sort(
    (a, o) => a[0] === o[0] ? a[1] - o[1] : a[0] - o[0]
  ), n = (a, o, c) => (o[0] - a[0]) * (c[1] - a[1]) - (o[1] - a[1]) * (c[0] - a[0]), i = [];
  for (const a of r) {
    for (; i.length >= 2 && n(
      i[i.length - 2],
      i[i.length - 1],
      a
    ) <= 0; )
      i.pop();
    i.push(a);
  }
  const s = [];
  for (let a = r.length - 1; a >= 0; a--) {
    const o = r[a];
    for (; s.length >= 2 && n(
      s[s.length - 2],
      s[s.length - 1],
      o
    ) <= 0; )
      s.pop();
    s.push(o);
  }
  return s.pop(), i.pop(), i.concat(s);
}
function ux(t) {
  if (t.length < 3) return 0;
  let e = 0;
  for (let r = 0; r < t.length; r++) {
    const [n, i] = t[r], [s, a] = t[(r + 1) % t.length];
    e += n * a - s * i;
  }
  return Math.abs(e) / 2;
}
function rm(t, e, r) {
  return Math.abs(
    (t[0] * (e[1] - r[1]) + e[0] * (r[1] - t[1]) + r[0] * (t[1] - e[1])) / 2
  );
}
function ph(t, e, r = 1e-9) {
  return Math.abs(t - e) <= r;
}
const nm = 3;
class Kt extends Ce.Transform {
  importance;
  priority;
  pointsSet;
  useV2Algorithm;
  /**
   * Tinクラスのインスタンスを生成します
   * @param options - 初期化オプション
   */
  constructor(e = {}) {
    super(), e.bounds ? this.setBounds(e.bounds) : (this.setWh(e.wh), this.vertexMode = e.vertexMode || Kt.VERTEX_PLAIN), this.strictMode = e.strictMode || Kt.MODE_AUTO, this.yaxisMode = e.yaxisMode || Kt.YAXIS_INVERT, this.importance = e.importance || 0, this.priority = e.priority || 0, this.stateFull = e.stateFull || !1, this.useV2Algorithm = e.useV2Algorithm ?? !1, e.points && this.setPoints(e.points), e.edges && this.setEdges(e.edges);
  }
  /**
   * フォーマットバージョンを取得します
   */
  getFormatVersion() {
    return this.useV2Algorithm ? Ce.format_version : nm;
  }
  /**
   * 制御点（GCP: Ground Control Points）を設定します。
   * 指定した点群に合わせて内部のTINキャッシュをリセットします。
   */
  setPoints(e) {
    this.yaxisMode === Kt.YAXIS_FOLLOW && (e = e.map((r) => [
      r[0],
      [r[1][0], -1 * r[1][1]]
    ])), this.points = e, this.tins = void 0, this.indexedTins = void 0;
  }
  /**
   * エッジ（制約線）を設定します。
   * 制約線を正規化した上で、依存するキャッシュをリセットします。
   */
  setEdges(e = []) {
    this.edges = Ce.normalizeEdges(e), this.edgeNodes = void 0, this.tins = void 0, this.indexedTins = void 0;
  }
  /**
   * 境界ポリゴンを設定します
   */
  setBounds(e) {
    this.bounds = e;
    let r = e[0][0], n = r, i = e[0][1], s = i;
    const a = [e[0]];
    for (let o = 1; o < e.length; o++) {
      const c = e[o];
      c[0] < r && (r = c[0]), c[0] > n && (n = c[0]), c[1] < i && (i = c[1]), c[1] > s && (s = c[1]), a.push(c);
    }
    a.push(e[0]), this.boundsPolygon = _i([a]), this.xy = [r, i], this.wh = [n - r, s - i], this.vertexMode = Kt.VERTEX_PLAIN, this.tins = void 0, this.indexedTins = void 0;
  }
  /**
   * 現在の設定を永続化可能な形式にコンパイルします
   */
  getCompiled() {
    const e = {};
    e.version = this.useV2Algorithm ? Ce.format_version : nm, e.points = this.points, e.weight_buffer = this.pointsWeightBuffer ?? {}, e.centroid_point = [
      this.centroid.forw.geometry.coordinates,
      this.centroid.forw.properties.target.geom
    ], e.vertices_params = [
      this.vertices_params.forw[0],
      this.vertices_params.bakw[0]
    ], e.vertices_points = [];
    const r = this.vertices_params.forw[1];
    if (r)
      for (let n = 0; n < r.length; n++) {
        const i = r[n].features[0], s = i.geometry.coordinates[0][1], a = i.properties.b.geom;
        e.vertices_points[n] = [s, a];
      }
    return e.strict_status = this.strict_status, e.tins_points = [[]], this.tins.forw.features.map((n) => {
      e.tins_points[0].push(
        ["a", "b", "c"].map(
          (i) => n.properties[i].index
        )
      );
    }), this.strict_status === Kt.STATUS_LOOSE ? (e.tins_points[1] = [], this.tins.bakw.features.map((n) => {
      e.tins_points[1].push(
        ["a", "b", "c"].map(
          (i) => n.properties[i].index
        )
      );
    })) : this.strict_status === Kt.STATUS_ERROR && this.kinks?.bakw && (e.kinks_points = this.kinks.bakw.features.map(
      (n) => n.geometry.coordinates
    )), e.yaxisMode = this.yaxisMode, e.vertexMode = this.vertexMode, e.strictMode = this.strictMode, this.bounds ? (e.bounds = this.bounds, e.boundsPolygon = this.boundsPolygon, this.useV2Algorithm && (e.xy = this.xy, e.wh = this.wh)) : e.wh = this.wh, e.edges = this.edges ?? [], e.edgeNodes = this.edgeNodes ?? [], e;
  }
  /**
   * コンパイルされた設定を適用します（v3+フォーマット対応）
   *
   * バージョン3以上のコンパイル済みデータが渡された場合は restoreV3State() を
   * 使用してN頂点対応の復元を行います。それ以外は基底クラスの実装に委譲します。
   */
  setCompiled(e) {
    super.setCompiled(e);
  }
  /**
   * 幅と高さを設定します
   */
  setWh(e) {
    this.wh = e || [100, 100], this.xy = [0, 0], this.bounds = void 0, this.boundsPolygon = void 0, this.tins = void 0, this.indexedTins = void 0;
  }
  /**
   * 頂点モードを設定します
   */
  setVertexMode(e) {
    this.vertexMode = e, this.tins = void 0, this.indexedTins = void 0;
  }
  /**
   * 厳密性モードを設定します
   */
  setStrictMode(e) {
    this.strictMode = e, this.tins = void 0, this.indexedTins = void 0;
  }
  /**
   * 厳密なTINを計算します
   */
  calcurateStrictTin() {
    const e = this.tins.forw.features.map(
      (i) => Ce.counterTri(i)
    );
    this.tins.bakw = Xe(e);
    const r = {};
    this.tins.forw.features.forEach((i, s) => {
      const a = this.tins.bakw.features[s];
      jp(r, { forw: i, bakw: a });
    }), hx(
      this.tins,
      r,
      this.pointsSet?.edges || []
    );
    const n = ["forw", "bakw"].map((i) => {
      const s = this.tins[i].features.map(
        (a) => a.geometry.coordinates[0]
      );
      return jM(s);
    });
    n[0].length === 0 && n[1].length === 0 ? (this.strict_status = Kt.STATUS_STRICT, delete this.kinks) : (this.strict_status = Kt.STATUS_ERROR, this.kinks = {
      forw: Xe(n[0]),
      bakw: Xe(n[1])
    });
  }
  /**
   * 点群セットを生成します。
  * GCP と中間エッジノードを GeoJSON Point に変換し、後続の三角分割に備えます。
   */
  generatePointsSet() {
    const e = {
      forw: [],
      bakw: []
    };
    for (let i = 0; i < this.points.length; i++) {
      const s = this.points[i][0], a = this.points[i][1], o = zs(s, a, i);
      e.forw.push(o), e.bakw.push(qs(o));
    }
    const r = [];
    let n = 0;
    this.edgeNodes = [], this.edges || (this.edges = []);
    for (let i = 0; i < this.edges.length; i++) {
      const s = this.edges[i][2], a = Object.assign([], this.edges[i][0]), o = Object.assign([], this.edges[i][1]);
      if (a.length === 0 && o.length === 0) {
        r.push(s);
        continue;
      }
      a.unshift(this.points[s[0]][0]), a.push(this.points[s[1]][0]), o.unshift(this.points[s[0]][1]), o.push(this.points[s[1]][1]);
      const c = [a, o].map((h) => {
        const f = h.map((l, d, g) => {
          if (d === 0) return 0;
          const w = g[d - 1];
          return Math.sqrt(
            Math.pow(l[0] - w[0], 2) + Math.pow(l[1] - w[1], 2)
          );
        }), u = f.reduce((l, d, g) => g === 0 ? [0] : (l.push(l[g - 1] + d), l), []);
        return u.map((l, d, g) => {
          const w = l / g[g.length - 1];
          return [h[d], f[d], u[d], w];
        });
      });
      c.map((h, f) => {
        const u = c[f ? 0 : 1];
        return h.filter((l, d) => !(d === 0 || d === h.length - 1 || l[4] === "handled")).flatMap((l) => {
          const d = l[0], g = l[3], w = u.reduce(
            (m, v, p, E) => {
              if (m) return m;
              const _ = E[p + 1];
              if (v[3] === g)
                return v[4] = "handled", [v];
              if (v[3] < g && _ && _[3] > g)
                return [v, _];
            },
            void 0
          );
          if (w && w.length === 1)
            return f === 0 ? [[d, w[0][0], g]] : [[w[0][0], d, g]];
          if (w && w.length === 2) {
            const m = w[0], v = w[1], p = (g - m[3]) / (v[3] - m[3]), E = [
              (v[0][0] - m[0][0]) * p + m[0][0],
              (v[0][1] - m[0][1]) * p + m[0][1]
            ];
            return f === 0 ? [[d, E, g]] : [[E, d, g]];
          }
          return [];
        });
      }).reduce((h, f) => h.concat(f), []).sort((h, f) => h[2] < f[2] ? -1 : 1).map((h, f, u) => {
        this.edgeNodes[n] = [
          h[0],
          h[1]
        ];
        const l = zs(
          h[0],
          h[1],
          `e${n}`
        );
        n++, e.forw.push(l), e.bakw.push(qs(l)), f === 0 ? r.push([s[0], e.forw.length - 1]) : r.push([
          e.forw.length - 2,
          e.forw.length - 1
        ]), f === u.length - 1 && r.push([e.forw.length - 1, s[1]]);
      });
    }
    return {
      forw: e.forw,
      bakw: e.bakw,
      edges: r
    };
  }
  /**
   * 入力データの検証と初期データの準備
   */
  validateAndPrepareInputs() {
    const e = this.xy[0] - 0.05 * this.wh[0], r = this.xy[0] + 1.05 * this.wh[0], n = this.xy[1] - 0.05 * this.wh[1], i = this.xy[1] + 1.05 * this.wh[1];
    if (this.bounds && !this.boundsPolygon) throw new Error("Internal error: bounds is set but boundsPolygon is missing");
    const s = this.bounds ? this.boundsPolygon : void 0;
    if (!this.points.reduce((o, c) => o && (s ? eh(c[0], s) : c[0][0] >= e && c[0][0] <= r && c[0][1] >= n && c[0][1] <= i), !0))
      throw "SOME POINTS OUTSIDE";
    let a = [];
    return this.wh && (a = [[e, n], [r, n], [e, i], [r, i]]), {
      pointsSet: this.generatePointsSet(),
      bbox: a,
      minx: e,
      maxx: r,
      miny: n,
      maxy: i
    };
  }
  /**
   * Compute a bounding box derived from GCP coordinates with a 5% margin.
   * Used in V3 plain mode where no explicit image bounds are available.
   */
  computeGcpBbox() {
    let e = 1 / 0, r = -1 / 0, n = 1 / 0, i = -1 / 0;
    for (const o of this.points) {
      const c = o[0][0], h = o[0][1];
      c < e && (e = c), c > r && (r = c), h < n && (n = h), h > i && (i = h);
    }
    const s = r - e, a = i - n;
    return {
      minx: e - 0.05 * s,
      maxx: r + 0.05 * s,
      miny: n - 0.05 * a,
      maxy: i + 0.05 * a
    };
  }
  /**
   * TINネットワークを同期的に更新し、座標変換の準備を行います。
   * 重めの計算を伴うため、呼び出し側が非同期制御を行いたい場合は
   * {@link updateTinAsync} を利用してください。
   */
  updateTin() {
    let e = this.strictMode;
    e !== Kt.MODE_STRICT && e !== Kt.MODE_LOOSE && (e = Kt.MODE_AUTO);
    const r = !this.useV2Algorithm;
    let n, i, s, a, o;
    if (r) {
      if (this.bounds) {
        const k = this.boundsPolygon;
        if (!k) throw new Error("Internal error: bounds is set but boundsPolygon is missing");
        if (!this.points.every(
          ($) => eh($[0], k)
        )) throw "SOME POINTS OUTSIDE";
      }
      n = this.generatePointsSet(), { minx: i, maxx: s, miny: a, maxy: o } = this.computeGcpBbox();
    } else {
      const k = this.validateAndPrepareInputs();
      n = k.pointsSet, i = k.minx, s = k.maxx, a = k.miny, o = k.maxy;
    }
    const c = {
      forw: Xe(n.forw),
      bakw: Xe(n.bakw)
    }, h = Ls(
      c.forw,
      n.edges,
      "target"
    ), f = Ls(
      c.bakw,
      n.edges,
      "target"
    );
    if (h.features.length === 0 || f.features.length === 0)
      throw "TOO LINEAR1";
    const u = tM(c.forw), l = q0(c.forw);
    if (!l) throw "TOO LINEAR2";
    const d = {}, g = l.geometry.coordinates[0];
    let w;
    try {
      w = g.map((k) => ({
        forw: k,
        bakw: Ce.transformArr(Cr(k), h)
      })), w.forEach((k) => {
        d[`${k.forw[0]}:${k.forw[1]}`] = k;
      });
    } catch {
      throw "TOO LINEAR2";
    }
    const m = q0(c.bakw);
    if (!m) throw "TOO LINEAR2";
    const v = m.geometry.coordinates[0];
    try {
      w = v.map((k) => ({
        bakw: k,
        forw: Ce.transformArr(Cr(k), f)
      })), w.forEach((k) => {
        d[`${k.forw[0]}:${k.forw[1]}`] = k;
      });
    } catch {
      throw "TOO LINEAR2";
    }
    let p;
    if (r) {
      const k = u.geometry.coordinates, $ = h.features.find(
        (O) => eh(
          Cr(k),
          O
        )
      );
      if ($) {
        const O = $.geometry.coordinates[0], T = $.properties.a.geom, I = $.properties.b.geom, N = $.properties.c.geom;
        p = {
          forw: [
            (O[0][0] + O[1][0] + O[2][0]) / 3,
            (O[0][1] + O[1][1] + O[2][1]) / 3
          ],
          bakw: [
            (T[0] + I[0] + N[0]) / 3,
            (T[1] + I[1] + N[1]) / 3
          ]
        };
      } else
        p = {
          forw: k,
          bakw: Ce.transformArr(u, h)
        };
    } else
      p = {
        forw: u.geometry.coordinates,
        bakw: Ce.transformArr(u, h)
      };
    const E = zs(p.forw, p.bakw, "c");
    this.centroid = {
      forw: E,
      bakw: qs(E)
    };
    const _ = [
      ...this.points.map((k) => ({ forw: k[0], bakw: k[1] })),
      ...(this.edgeNodes ?? []).map((k) => ({ forw: k[0], bakw: k[1] }))
    ], y = {
      convexBuf: d,
      centroid: p,
      allGcps: _,
      minx: i,
      maxx: s,
      miny: a,
      maxy: o
    }, b = this.vertexMode === Kt.VERTEX_BIRDEYE ? DM(y, r) : RM(y, r), S = {
      forw: [],
      bakw: []
    };
    for (let k = 0; k < b.length; k++) {
      const $ = b[k].forw, O = b[k].bakw, T = zs($, O, `b${k}`), I = qs(T);
      n.forw.push(T), n.bakw.push(I), S.forw.push(T), S.bakw.push(I);
    }
    this.pointsSet = {
      forw: Xe(n.forw),
      bakw: Xe(n.bakw),
      edges: n.edges
    }, this.tins = {
      forw: Ce.rotateVerticesTriangle(
        Ls(
          this.pointsSet.forw,
          n.edges,
          "target"
        )
      )
    }, (e === Kt.MODE_STRICT || e === Kt.MODE_AUTO) && this.calcurateStrictTin(), (e === Kt.MODE_LOOSE || e === Kt.MODE_AUTO && this.strict_status === Kt.STATUS_ERROR) && (this.tins.bakw = Ce.rotateVerticesTriangle(
      Ls(
        this.pointsSet.bakw,
        n.edges,
        "target"
      )
    ), delete this.kinks, this.strict_status = Kt.STATUS_LOOSE), this.vertices_params = {
      forw: tm(S.forw, this.centroid.forw),
      bakw: tm(S.bakw, this.centroid.bakw)
    }, this.addIndexedTin();
    const x = ["forw"];
    this.strict_status === Kt.STATUS_LOOSE && x.push("bakw");
    const M = this.strict_status === Kt.STATUS_STRICT;
    this.pointsWeightBuffer = ix({
      tins: this.tins,
      targets: x,
      includeReciprocals: M,
      numBoundaryVertices: b.length
    });
  }
  /**
   * 非同期ラッパーを提供します。
   * 互換性のために Promise ベースの API を維持しますが、内部処理は同期的です。
   */
  async updateTinAsync() {
    this.updateTin();
  }
}
Ce.format_version;
async function fx(t, e, r, n, i, s) {
  return t.length < 3 ? "tooLessGcps" : new Promise((a, o) => {
    const c = new Kt({});
    if (r)
      c.setWh(r);
    else if (n)
      c.setBounds(n);
    else {
      o("Both wh and bounds are missing");
      return;
    }
    c.setStrictMode(i), c.setVertexMode(s), c.setPoints(t), c.setEdges(e), c.updateTinAsync().then(() => {
      a(c.getCompiled());
    }).catch((h) => {
      const f = String(h);
      console.log("[mapedit:updateTin] TIN error:", f), f.includes("SOME POINTS OUTSIDE") ? a("pointsOutside") : f.indexOf("TOO LINEAR") === 0 ? a("tooLinear") : f.includes("Vertex indices") || f.includes("is degenerate!") || f.includes("already exists or intersects with an existing edge!") ? a("edgeError") : o(h);
    });
  });
}
const dx = () => {
  Ot.handle("mapedit:request", async (r, n) => {
    try {
      return await k0.request(n);
    } catch (i) {
      throw console.error("Failed to handle mapedit:request", i), i;
    }
  }), Ot.handle("mapedit:save", async (r, n, i) => {
    try {
      return await k0.save(n, i);
    } catch (s) {
      return console.error("Failed to handle mapedit:save", s), "Error";
    }
  }), Ot.handle("mapedit:checkID", async (r, n) => {
    try {
      return !await (await Er.getDBInstance()).findOneAsync({ _id: n });
    } catch (i) {
      return console.error("Failed to handle mapedit:checkID", i), !1;
    }
  }), Ot.handle("mapedit:updateTin", async (r, n, i, s, a, o, c) => {
    try {
      const u = await fx(n, i, s === 0 ? a : null, s !== 0 ? a : null, o, c);
      return [s, u];
    } catch (h) {
      throw console.error("Failed to handle mapedit:updateTin", h), h;
    }
  }), Ot.handle("mapedit:getWmtsFolder", async () => {
    const r = ae.get("saveFolder");
    return lt.join(r, "wmts");
  }), Ot.handle("mapedit:download", async (r, n, i) => {
    const s = We.fromWebContents(r.sender), a = n.mapID, o = ae.get("tmpFolder"), c = ae.get("saveFolder"), h = lt.join(c, "tiles"), f = lt.join(c, "tmbs"), u = await kp(n, i), l = lt.join(o, `${a}.json`);
    await gt.ensureDir(o), await gt.writeFile(l, JSON.stringify(u));
    const d = [
      [l, "maps", `${a}.json`],
      [lt.join(f, `${a}.jpg`), "tmbs", `${a}.jpg`]
    ];
    try {
      const { files: p } = await H_.read(lt.join(h, a));
      for (const E of p) {
        const _ = lt.resolve(E), y = lt.basename(_), b = lt.dirname(_).match(/[/\\](tiles[/\\].+$)/)?.[1];
        b && d.push([_, b, y]);
      }
    } catch {
    }
    const g = new Bh(
      "mapedit:taskProgress",
      d.length,
      "mapdownload.adding_zip",
      "mapdownload.creating_zip"
    );
    g.setWindow(s), g.update(0);
    const w = lt.join(o, `${a}.zip`), m = new Hm();
    for (let p = 0; p < d.length; p++) {
      const [E, _, y] = d[p];
      gt.existsSync(E) && m.addLocalFile(E, _, y), g.update(p + 1);
    }
    m.writeZip(w);
    const v = await In.showSaveDialog(s, {
      defaultPath: lt.join(xe.getPath("documents"), `${a}.zip`),
      filters: [{ name: "Output file", extensions: ["zip"] }]
    });
    return await gt.remove(l), !v.canceled && v.filePath ? (await gt.move(w, v.filePath, { overwrite: !0 }), "Success") : (await gt.remove(w), "Canceled");
  }), Ot.handle("mapedit:uploadCsv", async (r, n, i) => {
    const s = We.fromWebContents(r.sender), a = await In.showOpenDialog(s, {
      defaultPath: xe.getPath("documents"),
      properties: ["openFile"],
      filters: [{ name: n, extensions: [] }]
    });
    if (a.canceled || a.filePaths.length === 0)
      return { err: "Canceled" };
    const o = a.filePaths[0], c = [], h = {
      strict: !0,
      headers: !1,
      skipLines: i.ignoreHeader ? 1 : 0
    };
    return new Promise((f) => {
      gt.createReadStream(o).pipe(W_(h)).on("data", (u) => c.push(u)).on("end", () => {
        let u = null;
        const l = [];
        c.length === 0 && (u = "csv_format_error"), c.forEach((d) => {
          if (!u)
            try {
              const g = [], w = [];
              g[0] = parseFloat(d[i.pixXColumn - 1]), g[1] = parseFloat(d[i.pixYColumn - 1]), i.reverseMapY && (g[1] = -1 * g[1]), w[0] = parseFloat(d[i.lngColumn - 1]), w[1] = parseFloat(d[i.latColumn - 1]);
              const m = _p(i.projText, "EPSG:3857", w);
              l.push([g, m]);
            } catch {
              u = "csv_format_error";
            }
        }), f(u ? { err: u } : { gcps: l });
      }).on("error", (u) => f({ err: String(u) }));
    });
  });
  let t = !1, e = null;
  Ot.handle("mapedit:checkExtentMap", async (r, n) => {
    const i = We.fromWebContents(r.sender);
    if (i) {
      if (t)
        e = n;
      else if (!(e && e.every((s, a) => s === n[a]))) {
        t = !0, e = n;
        const s = await Er.searchExtent(n);
        i.webContents.send("mapedit:extentMapList", s), setTimeout(() => {
          const a = e;
          t = !1, e = null, a && !a.every((o, c) => o === n[c]) && i.webContents.send("mapedit:checkExtentMapRetry", a);
        }, 1e3);
      }
    }
  });
};
let _r;
async function mx(t, e) {
  const r = await gn.read(t), n = r.width, i = r.height, s = n > i ? 52 : Math.ceil(52 * n / i), a = n > i ? Math.ceil(52 * i / n) : 52;
  await r.resize({ w: s, h: a }).write(e);
}
async function px(t, e, r) {
  try {
    const n = /([^\\/]+)\.([^.]+)$/, i = e.match(n);
    if (!i) return { err: "画像拡張子エラー" };
    let s = i[2].toLowerCase();
    s === "jpeg" && (s = "jpg"), _r = lt.resolve(r, "tiles");
    try {
      await gt.stat(_r), await gt.remove(_r);
    } catch {
    }
    await gt.ensureDir(_r);
    const a = await gn.read(e), o = a.width, c = a.height, h = Math.ceil(Math.log(Math.max(o, c) / 256) / Math.log(2)), f = [];
    for (let w = h; w >= 0; w--) {
      const m = Math.round(o / Math.pow(2, h - w)), v = Math.round(c / Math.pow(2, h - w));
      for (let p = 0; p * 256 < m; p++) {
        const E = (p + 1) * 256 > m ? m - p * 256 : 256, _ = p * 256 * Math.pow(2, h - w), y = (p + 1) * 256 * Math.pow(2, h - w) > o ? o - _ : 256 * Math.pow(2, h - w), b = lt.resolve(_r, `${w}`, `${p}`);
        await gt.ensureDir(b);
        for (let S = 0; S * 256 < v; S++) {
          const x = (S + 1) * 256 > v ? v - S * 256 : 256, M = S * 256 * Math.pow(2, h - w), k = (S + 1) * 256 * Math.pow(2, h - w) > c ? c - M : 256 * Math.pow(2, h - w), $ = lt.resolve(b, `${S}.${s}`);
          f.push([$, _, M, y, k, E, x]);
        }
      }
    }
    const u = new Bh(
      "mapedit:taskProgress",
      f.length,
      "mapupload.dividing_tile",
      "mapupload.next_thumbnail"
    );
    u.setWindow(t), u.update(0);
    for (let w = 0; w < f.length; w++) {
      const m = f[w];
      await a.clone().crop({ x: m[1], y: m[2], w: m[3], h: m[4] }).resize({ w: m[5], h: m[6] }).write(m[0]), u.update(w + 1), await new Promise((p) => setTimeout(p, 1));
    }
    await gt.copy(e, lt.resolve(_r, `original.${s}`));
    const l = lt.resolve(_r, "0", "0", `0.${s}`), d = lt.resolve(_r, "thumbnail.jpg");
    await mx(l, d);
    const g = `${uh(_r)}/{z}/{x}/{y}.${s}`;
    return { width: o, height: c, url: g, imageExtension: s };
  } catch (n) {
    return { err: n };
  }
}
async function yx(t, e, r) {
  const n = await In.showOpenDialog(t, {
    defaultPath: xe.getPath("documents"),
    properties: ["openFile"],
    // 旧実装: filters: [{name: mapImageRepl, extensions: ['jpg', 'png', 'jpeg']}]
    filters: [{ name: r, extensions: ["jpg", "png", "jpeg"] }]
  });
  return n.canceled ? { err: "Canceled" } : await px(t, n.filePaths[0], e);
}
function gx() {
  Ot.handle("mapupload:showMapSelectDialog", async (t, e) => {
    const r = We.fromWebContents(t.sender);
    if (!r) throw new Error("BrowserWindow not found");
    const n = ae.get("tmpFolder");
    return await yx(r, n, e);
  });
}
class wx {
  get folders() {
    const e = ae.get("saveFolder"), r = ae.get("tmpFolder");
    return {
      tileFolder: lt.join(e, "tiles"),
      uiThumbnailFolder: lt.join(e, "tmbs"),
      tmpFolder: r
    };
  }
  async showDataSelectDialog(e) {
    const r = await In.showOpenDialog(e, {
      defaultPath: xe.getPath("documents"),
      properties: ["openFile"],
      filters: [{ name: "Map data zip", extensions: ["zip"] }]
    });
    return r.canceled || r.filePaths.length === 0 ? { err: "Canceled" } : this.extractZip(r.filePaths[0]);
  }
  async extractZip(e) {
    const { tileFolder: r, uiThumbnailFolder: n, tmpFolder: i } = this.folders, s = lt.join(i, "zip");
    try {
      await gt.remove(s), await gt.ensureDir(s), new Hm(e).extractAllTo(s, !0);
      const o = lt.join(s, "maps"), c = lt.join(s, "tiles"), h = lt.join(s, "tmbs"), f = (await gt.readdir(o))[0], u = f.split(".")[0], l = lt.join(o, f), d = await gt.readJson(l), g = lt.join(c, u), w = lt.join(h, `${u}.jpg`), m = lt.join(r, u), v = lt.join(n, `${u}.jpg`), p = await Er.getDBInstance();
      if (await p.findOneAsync({ _id: u })) throw "Exist";
      if (!gt.existsSync(g)) throw "NoTile";
      if (!gt.existsSync(w)) throw "NoTmb";
      await p.updateAsync({ _id: u }, { $set: d }, { upsert: !0 }), await gt.remove(m), await gt.move(g, m), await gt.remove(v), await gt.move(w, v);
      const [_, y] = await xp(d);
      _.mapID = u, _.status = "Update";
      const b = lt.join(m, "0", "0");
      if (gt.existsSync(b)) {
        const x = (await gt.readdir(b)).find((M) => /^0\.(jpg|jpeg|png)$/.test(M));
        if (x) {
          let M = `file://${lt.join(m, "0", "0", x).split(lt.sep).join("/")}`;
          M = M.replace(/\/0\/0\/0\./, "/{z}/{x}/{y}."), _.url_ = M;
        }
      }
      return { mapData: _, tins: y };
    } catch (a) {
      return console.error("[DataUploadService] extractZip error", a), { err: typeof a == "string" ? a : a.message || "Unknown" };
    }
  }
}
const _x = new wx();
function vx() {
  Ot.handle("dataupload:showDataSelectDialog", async (t) => {
    const e = We.fromWebContents(t.sender);
    return _x.showDataSelectDialog(e);
  });
}
const Fe = 20037508342789244e-9;
class Ex {
  get folders() {
    const e = ae.get("saveFolder");
    return {
      originalFolder: lt.join(e, "originals"),
      wmtsFolder: lt.join(e, "wmts")
    };
  }
  async generate(e, r, n, i, s, a, o) {
    try {
      const c = new Kt({});
      c.setCompiled(s), a = a || "jpg";
      const { originalFolder: h, wmtsFolder: f } = this.folders, u = lt.join(h, `${r}.${a}`), l = lt.join(f, r), d = c.transform([0, 0], !1, !0), g = c.transform([n, 0], !1, !0), w = c.transform([n, i], !1, !0), m = c.transform([0, i], !1, !0), v = Math.sqrt(Math.pow(n, 2) + Math.pow(i, 2)), p = Math.sqrt(Math.pow(d[0] - w[0], 2) + Math.pow(d[1] - w[1], 2)), E = Math.sqrt(Math.pow(g[0] - m[0], 2) + Math.pow(g[1] - m[1], 2)), _ = Fe * 2 / 256, y = Math.min(p / v, E / v), b = Math.ceil(Math.log2(_ / y)), S = Math.min(n, i), x = Math.ceil(Math.log2(S / 256)), M = b - x, k = [d, m, g, w];
      for (let P = 1; P < n; P++)
        k.push(c.transform([P, 0], !1, !0)), k.push(c.transform([P, i], !1, !0));
      for (let P = 1; P < i; P++)
        k.push(c.transform([0, P], !1, !0)), k.push(c.transform([n, P], !1, !0));
      const $ = k.map((P) => P[0]), O = k.map((P) => P[1]), T = (Math.min(...$) + Fe) / (2 * Fe) * 256 * Math.pow(2, b), I = (Math.max(...$) + Fe) / (2 * Fe) * 256 * Math.pow(2, b), N = (Fe - Math.max(...O)) / (2 * Fe) * 256 * Math.pow(2, b), j = (Fe - Math.min(...O)) / (2 * Fe) * 256 * Math.pow(2, b), C = Math.floor(T / 256), F = Math.floor(I / 256), q = Math.floor(N / 256), R = Math.floor(j / 256), D = [];
      for (let P = b; P >= M; P--) {
        const U = Math.floor(C / Math.pow(2, b - P)), K = Math.floor(F / Math.pow(2, b - P)), J = Math.floor(q / Math.pow(2, b - P)), et = Math.floor(R / Math.pow(2, b - P));
        for (let rt = U; rt <= K; rt++)
          for (let z = J; z <= et; z++)
            D.push([P, rt, z]);
      }
      const G = new Bh(
        "mapedit:taskProgress",
        D.length,
        "wmtsgenerate.generating_tile",
        ""
      );
      G.setWindow(e), G.update(0);
      const A = (await gn.read(u)).bitmap.data;
      for (let P = 0; P < D.length; P++) {
        const [U, K, J] = D[P];
        U === b ? await this.maxZoomTileLoop(c, U, K, J, A, n, i, l) : await this.upperZoomTileLoop(U, K, J, l), await new Promise((et) => setTimeout(et, 1)), G.update(P + 1);
      }
      return { hash: o };
    } catch (c) {
      return console.error("[WmtsGeneratorService] generate error", c), { hash: o, err: c };
    }
  }
  // 原版 wmts_generator.js maxZoomTileLoop を忠実移植
  async maxZoomTileLoop(e, r, n, i, s, a, o, c) {
    const h = 2 * Fe / (256 * Math.pow(2, r)), f = n * 256, u = i * 256, l = new gn({ width: 256, height: 256 }), d = l.bitmap.data, g = [-1, 0, 1, 2];
    let w = 0;
    for (let p = 0; p < 256; p++) {
      const E = Fe - (p + u) * h;
      for (let _ = 0; _ < 256; _++) {
        const y = (_ + f) * h - Fe;
        let b;
        try {
          b = e.transform([y, E], !0, !0);
        } catch {
          b = null;
        }
        if (!b) {
          d[w] = d[w + 1] = d[w + 2] = d[w + 3] = 0, w += 4;
          continue;
        }
        const S = g.map((T) => T + ~~b[0]), x = g.map((T) => T + ~~b[1]);
        let M = 0, k = 0, $ = 0, O = 0;
        for (const T of x) {
          const I = this.getWeight(T, b[1]);
          for (const N of S) {
            const j = I * this.getWeight(N, b[0]);
            if (j === 0) continue;
            const C = this.rgba(s, a, o, N, T);
            M += C.r * j, k += C.g * j, $ += C.b * j, O += C.a * j;
          }
        }
        d[w] = ~~M, d[w + 1] = ~~k, d[w + 2] = ~~$, d[w + 3] = ~~O, w += 4;
      }
    }
    l.bitmap.data = d;
    const m = lt.join(c, `${r}`, `${n}`), v = lt.join(m, `${i}.png`);
    await gt.ensureDir(m), await l.write(v);
  }
  // 原版 wmts_generator.js upperZoomTileLoop を忠実移植
  // 256x256 キャンバスに 128x128 にリサイズした 4 つの子タイルを合成
  async upperZoomTileLoop(e, r, n, i) {
    const s = e + 1, a = new gn({ width: 256, height: 256 });
    for (let h = 0; h < 2; h++) {
      const f = r * 2 + h, u = h * 128;
      for (let l = 0; l < 2; l++) {
        const d = n * 2 + l, g = l * 128, w = lt.join(i, `${s}`, `${f}`, `${d}.png`);
        try {
          const m = await gn.read(w);
          m.resize({ w: 128, h: 128 }), a.composite(m, u, g);
        } catch {
        }
      }
    }
    const o = lt.join(i, `${e}`, `${r}`), c = lt.join(o, `${n}.png`);
    await gt.ensureDir(o), await a.write(c);
  }
  // 原版と同じ bicubic weight 関数 (a = -1)
  getWeight(e, r) {
    const i = Math.abs(e - r);
    return i < 1 ? 1 * Math.pow(i, 3) - 2 * Math.pow(i, 2) + 1 : i < 2 ? -1 * Math.pow(i, 3) - -5 * Math.pow(i, 2) + -8 * i - -4 : 0;
  }
  // 原版と同じ rgba アクセス（境界外は黒透明）
  rgba(e, r, n, i, s) {
    if (i < 0 || s < 0 || i >= r || s >= n)
      return { r: 0, g: 0, b: 0, a: 0 };
    const a = (r * s + i) * 4;
    return { r: e[a], g: e[a + 1], b: e[a + 2], a: e[a + 3] };
  }
}
const bx = new Ex();
function Sx() {
  Ot.handle("wmtsGen:generate", async (t, e, r, n, i, s, a) => {
    const o = We.fromWebContents(t.sender);
    return bx.generate(o, e, r, n, i, s, a);
  });
}
const Tp = At.dirname(Bp(import.meta.url));
process.env.APP_ROOT = At.join(Tp, "..");
const yh = process.env.VITE_DEV_SERVER_URL, Kx = At.join(process.env.APP_ROOT, "dist-electron"), Cp = At.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = yh ? At.join(process.env.APP_ROOT, "public") : Cp;
let cr, Lp = !1;
function Fp() {
  cr = new We({
    width: 1200,
    height: 800,
    minWidth: 1200,
    // 旧実装に合わせた最小サイズ
    minHeight: 800,
    icon: At.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: At.join(Tp, "preload.mjs"),
      webSecurity: !1
      // file:// などローカルリソース読み込みを許可
    }
  }), cr.webContents.on("did-finish-load", () => {
    cr?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), yh ? cr.loadURL(yh) : cr.loadFile(At.join(Cp, "index.html")), cr.on("close", (t) => {
    process.platform === "darwin" && !Lp && (t.preventDefault(), cr?.hide());
  });
}
xe.on("before-quit", () => {
  Lp = !0;
});
xe.on("window-all-closed", () => {
  process.platform !== "darwin" && (xe.quit(), cr = null);
});
xe.on("activate", () => {
  cr ? cr.show() : Fp();
});
xe.whenReady().then(() => {
  Ot.removeHandler("settings:get"), Ot.removeHandler("settings:set"), Ot.removeHandler("settings:select-folder"), Ot.removeHandler("maplist:request"), Ot.removeHandler("maplist:delete"), Ot.removeHandler("mapedit:request"), Ot.removeHandler("mapedit:get-tms-list"), Ot.removeHandler("mapedit:updateTin"), Ot.removeHandler("mapedit:save"), Ot.removeHandler("mapedit:checkID"), Ot.removeHandler("mapedit:checkExtentMap"), Ot.removeHandler("mapupload:showMapSelectDialog"), Ot.removeHandler("mapedit:getWmtsFolder"), Ot.removeHandler("mapedit:download"), Ot.removeHandler("mapedit:uploadCsv"), Ot.removeHandler("dataupload:showDataSelectDialog"), Ot.removeHandler("wmtsGen:generate"), Ot.removeHandler("dialog:showMessageBox"), Ot.handle("dialog:showMessageBox", async (t, e) => await In.showMessageBox(We.fromWebContents(t.sender), e)), I_(), P_(), dx(), gx(), vx(), Sx(), Fp(), sm(), ae.on("changeLang", () => {
    sm();
  });
});
const im = {
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
let tn = null;
function Mx() {
  if (tn) {
    tn.focus();
    return;
  }
  tn = new We({
    width: 400,
    height: 450,
    resizable: !0,
    minimizable: !1,
    maximizable: !1,
    title: "About MaplatEditor",
    autoHideMenuBar: !0,
    webPreferences: {
      nodeIntegration: !0,
      contextIsolation: !1,
      webSecurity: !1
    }
  }), tn.setMenu(null);
  const t = At.join(process.env.VITE_PUBLIC, "about.html");
  tn.loadFile(t), tn.on("closed", () => {
    tn = null;
  });
}
function sm() {
  const t = ae.get("lang") || "en", e = (i) => im[t]?.[i] || im.en[i] || i, r = [
    {
      label: e("menu.maplateditor"),
      submenu: [
        {
          label: e("menu.quit"),
          accelerator: "CmdOrCtrl+Q",
          click: () => xe.quit()
        },
        { type: "separator" },
        {
          label: e("menu.about"),
          click: Mx
        }
      ]
    },
    {
      label: e("menu.edit"),
      submenu: [
        { role: "undo", label: e("menu.undo") },
        { role: "redo", label: e("menu.redo") },
        { type: "separator" },
        { role: "cut", label: e("menu.cut") },
        { role: "copy", label: e("menu.copy") },
        { role: "paste", label: e("menu.paste") },
        { role: "selectAll", label: e("menu.selectAll") }
      ]
    }
  ];
  r.push({
    label: e("menu.development"),
    submenu: [
      { role: "reload", label: e("menu.reload") },
      { role: "toggleDevTools", label: e("menu.toggleDevTools") }
    ]
  });
  const n = Xh.buildFromTemplate(r);
  Xh.setApplicationMenu(n);
}
export {
  Kx as MAIN_DIST,
  Cp as RENDERER_DIST,
  yh as VITE_DEV_SERVER_URL
};
