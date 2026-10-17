/**
 * nov26-m7-t3: GitHub Actions の `if:` の式の小さな評価器（smoke 用）。
 *
 * 既存の smoke は `if:` を正規表現・部分一致で見ていた（FULL_COND 等）。部分一致では「条件を足して偽にした」
 * 変更（`&& false` を足す・`==` を `!=` にする）を見逃すため、式を評価して真偽で断言する。
 *
 * 受け付けるもの（それ以外が現れたら例外＝検査を黙って通さない）:
 *   - 演算子: `==`・`!=`・`&&`・`||`・`!`・括弧
 *   - リテラル: '文字列'（'' で ' を表す）・true・false・null・数
 *   - 文脈: github.event_name・inputs.<名前>・needs.<job>.outputs.<名前>・needs.<job>.result
 *   - `${{ … }}` で囲まれていても、囲まれていなくてもよい
 * 関数呼び出し（always()・contains() 等）・steps.*・env.*・secrets.* などは受け付けない。
 *
 * 意味は GitHub の式の規則に合わせる:
 *   - `==`・`!=`: 型が同じなら比べる（文字列は大文字小文字を区別しない）。型が違えば数へ寄せて比べる
 *     （null→0・真偽→1/0・文字列→Number。'' は 0・数でない文字列は NaN で、NaN は何とも等しくない）
 *   - `&&`・`||` は真偽ではなく被演算子の値を返す。偽とみなすのは false・0・-0・''・null・NaN
 *   - 文脈に値が無いときは null（push の inputs.mode 等）
 *
 * evalGhIf(expr, ctx) → 値（any）／ isTruthy(v) → boolean ／ evalGhIfBool(expr, ctx) → boolean
 *   ctx = { github: { event_name }, inputs: {…}, needs: { <job>: { outputs: {…}, result } } }
 */

const TOKEN_RE = /\s*(?:(\(|\)|==|!=|&&|\|\||!)|('(?:[^']|'')*')|(-?\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*))/y;

function tokenize(src) {
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw new Error(`eval-gh-if: 読めない字句（${pos} 文字目）: ${src.slice(pos, pos + 20)}`);
    pos = TOKEN_RE.lastIndex;
    if (m[1]) tokens.push({ t: 'op', v: m[1] });
    else if (m[2]) tokens.push({ t: 'lit', v: m[2].slice(1, -1).replace(/''/g, "'") });
    else if (m[3]) tokens.push({ t: 'lit', v: Number(m[3]) });
    else if (m[4]) {
      if (m[4] === 'true') tokens.push({ t: 'lit', v: true });
      else if (m[4] === 'false') tokens.push({ t: 'lit', v: false });
      else if (m[4] === 'null') tokens.push({ t: 'lit', v: null });
      else tokens.push({ t: 'ref', v: m[4] });
    }
  }
  return tokens;
}

function stripWrapper(expr) {
  const s = String(expr).trim();
  const m = s.match(/^\$\{\{([\s\S]*)\}\}$/);
  if (m) {
    if (m[1].includes('${{')) throw new Error(`eval-gh-if: \${{ }} が入れ子・複数ある: ${s}`);
    return m[1];
  }
  if (s.includes('${{')) throw new Error(`eval-gh-if: 式の一部だけが \${{ }} で囲まれている: ${s}`);
  return s;
}

function resolveRef(name, ctx) {
  const parts = name.split('.');
  const get = (obj, key) => (obj != null && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null);
  if (parts[0] === 'github' && parts.length === 2 && parts[1] === 'event_name') {
    return get(ctx.github ?? {}, 'event_name');
  }
  if (parts[0] === 'inputs' && parts.length === 2) return get(ctx.inputs ?? {}, parts[1]);
  if (parts[0] === 'needs' && parts.length === 4 && parts[2] === 'outputs') {
    return get(get(get(ctx.needs ?? {}, parts[1]), 'outputs'), parts[3]);
  }
  if (parts[0] === 'needs' && parts.length === 3 && parts[2] === 'result') {
    return get(get(ctx.needs ?? {}, parts[1]), 'result');
  }
  throw new Error(`eval-gh-if: 受け付けない文脈の参照: ${name}`);
}

export function isTruthy(v) {
  if (v === null || v === undefined || v === false || v === '') return false;
  if (typeof v === 'number') return !(v === 0 || Number.isNaN(v));
  return true;
}

function toNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === '') return 0;
  return Number(s); // 数でなければ NaN
}

function looseEquals(a, b) {
  const ta = a === null || a === undefined ? 'null' : typeof a;
  const tb = b === null || b === undefined ? 'null' : typeof b;
  if (ta === tb) {
    if (ta === 'string') return a.toLowerCase() === b.toLowerCase();
    if (ta === 'null') return true;
    return a === b;
  }
  const na = toNumber(a);
  const nb = toNumber(b);
  return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb;
}

/** 優先度: || < && < ==・!= < ! < 原子 */
export function evalGhIf(expr, ctx = {}) {
  const tokens = tokenize(stripWrapper(expr));
  if (tokens.length === 0) throw new Error('eval-gh-if: 空の式');
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;

  function primary() {
    const tk = tokens[i++];
    if (!tk) throw new Error('eval-gh-if: 式が途中で終わっている');
    if (tk.t === 'lit') return tk.v;
    if (tk.t === 'ref') {
      if (isOp('(')) throw new Error(`eval-gh-if: 関数呼び出しは受け付けない: ${tk.v}()`);
      return resolveRef(tk.v, ctx);
    }
    if (tk.v === '(') {
      const v = or();
      if (!isOp(')')) throw new Error('eval-gh-if: 括弧が閉じていない');
      i++;
      return v;
    }
    throw new Error(`eval-gh-if: ここに ${tk.v} は来られない`);
  }
  function unary() {
    if (isOp('!')) {
      i++;
      return !isTruthy(unary());
    }
    return primary();
  }
  function eq() {
    let l = unary();
    while (isOp('==') || isOp('!=')) {
      const op = tokens[i++].v;
      const r = unary();
      l = op === '==' ? looseEquals(l, r) : !looseEquals(l, r);
    }
    return l;
  }
  function and() {
    let l = eq();
    while (isOp('&&')) {
      i++;
      const r = eq();
      l = isTruthy(l) ? r : l;
    }
    return l;
  }
  function or() {
    let l = and();
    while (isOp('||')) {
      i++;
      const r = and();
      l = isTruthy(l) ? l : r;
    }
    return l;
  }
  const v = or();
  if (i !== tokens.length) throw new Error(`eval-gh-if: 余った字句がある: ${tokens.slice(i).map((t) => t.v).join(' ')}`);
  return v;
}

export const evalGhIfBool = (expr, ctx) => isTruthy(evalGhIf(expr, ctx));
