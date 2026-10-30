#!/usr/bin/env node
// JSON のキーの重複を見つける検査器。
//
// JSON.parse は同じキーが 2 回出ても後の値で黙って上書きするので、重複を見逃す。
// ここでは資料を字句として読み（文字列・エスケープ・入れ子のオブジェクトと配列を
// 正しく読む小さな走査器）、同じオブジェクトの中で同じキーが 2 回出たら知らせる。
//
// 使い方: node scripts/ci/check-json-duplicate-keys.mjs <file...>
// 出力: 問題なし → `ok: <ファイル数> files`（exit 0）
//       重複あり → `duplicate key: <file>:<キーのパス>`（exit 1）
//       壊れた JSON → `invalid json: <file>: <理由>`（exit 1）
import { readFileSync } from 'node:fs';

class JsonProblem extends Error {
  constructor(message) {
    super(message);
    this.name = 'JsonProblem';
  }
}

function lineColumn(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n');
  return `${line}:${column}`;
}

function scan(text, file) {
  let pos = 0;
  const length = text.length;

  const invalid = (message, at = pos) => {
    throw new JsonProblem(`invalid json: ${file}: ${message} (${lineColumn(text, at)})`);
  };

  const skipWhitespace = () => {
    while (pos < length) {
      const ch = text[pos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') pos += 1;
      else break;
    }
  };

  const parseString = () => {
    // 開きの引用符は呼び出し側で確かめてある
    pos += 1;
    let value = '';
    while (pos < length) {
      const ch = text[pos];
      if (ch === '"') {
        pos += 1;
        return value;
      }
      if (ch === '\\') {
        pos += 1;
        if (pos >= length) invalid('unexpected end of input in string');
        const escape = text[pos];
        if (escape === '"' || escape === '\\' || escape === '/') {
          value += escape;
          pos += 1;
        } else if (escape === 'b') {
          value += '\b';
          pos += 1;
        } else if (escape === 'f') {
          value += '\f';
          pos += 1;
        } else if (escape === 'n') {
          value += '\n';
          pos += 1;
        } else if (escape === 'r') {
          value += '\r';
          pos += 1;
        } else if (escape === 't') {
          value += '\t';
          pos += 1;
        } else if (escape === 'u') {
          const hex = text.slice(pos + 1, pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) invalid('invalid unicode escape');
          value += String.fromCharCode(Number.parseInt(hex, 16));
          pos += 5;
        } else {
          invalid('invalid escape in string');
        }
        continue;
      }
      if (text.charCodeAt(pos) < 0x20) invalid('control character in string');
      value += ch;
      pos += 1;
    }
    invalid('unexpected end of input in string');
    return value;
  };

  const parseObject = (pathParts) => {
    pos += 1; // '{'
    const seen = new Set();
    skipWhitespace();
    if (text[pos] === '}') {
      pos += 1;
      return;
    }
    for (;;) {
      skipWhitespace();
      if (text[pos] !== '"') invalid("expected a key string (object keys must be strings)");
      const key = parseString();
      const keyPath = [...pathParts, key].join('.');
      if (seen.has(key)) {
        throw new JsonProblem(`duplicate key: ${file}:${keyPath}`);
      }
      seen.add(key);
      skipWhitespace();
      if (text[pos] !== ':') invalid("expected ':' after a key");
      pos += 1;
      parseValue([...pathParts, key]);
      skipWhitespace();
      if (text[pos] === ',') {
        pos += 1;
        continue;
      }
      if (text[pos] === '}') {
        pos += 1;
        return;
      }
      invalid("expected ',' or '}'");
    }
  };

  const parseArray = (pathParts) => {
    pos += 1; // '['
    skipWhitespace();
    if (text[pos] === ']') {
      pos += 1;
      return;
    }
    for (;;) {
      parseValue(pathParts);
      skipWhitespace();
      if (text[pos] === ',') {
        pos += 1;
        continue;
      }
      if (text[pos] === ']') {
        pos += 1;
        return;
      }
      invalid("expected ',' or ']'");
    }
  };

  const parseValue = (pathParts) => {
    skipWhitespace();
    if (pos >= length) invalid('unexpected end of input');
    const ch = text[pos];
    if (ch === '{') {
      parseObject(pathParts);
      return;
    }
    if (ch === '[') {
      parseArray(pathParts);
      return;
    }
    if (ch === '"') {
      parseString();
      return;
    }
    if (text.startsWith('true', pos)) {
      pos += 4;
      return;
    }
    if (text.startsWith('false', pos)) {
      pos += 5;
      return;
    }
    if (text.startsWith('null', pos)) {
      pos += 4;
      return;
    }
    const number = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(pos));
    if (number && number[0].length > 0) {
      pos += number[0].length;
      return;
    }
    invalid('unexpected character');
  };

  parseValue([]);
  skipWhitespace();
  if (pos < length) invalid('unexpected character after the top-level value');
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/ci/check-json-duplicate-keys.mjs <file...>');
  process.exit(1);
}

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    console.log(`invalid json: ${file}: cannot read file (${error.code ?? error.message})`);
    process.exit(1);
  }
  try {
    scan(text, file);
  } catch (error) {
    if (error instanceof JsonProblem) {
      console.log(error.message);
      process.exit(1);
    }
    throw error;
  }
}

console.log(`ok: ${files.length} files`);
