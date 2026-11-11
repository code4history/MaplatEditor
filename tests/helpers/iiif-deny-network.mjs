// 子プロセスの import 前に通信を禁止する。fixture の URL を間違って取得したら失敗。
import { Socket } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('IIIF fixture 試験ではネットワークを使えません'); };
globalThis.fetch = deny;
Socket.prototype.connect = deny;
http.request = http.get = https.request = https.get = deny;
syncBuiltinESMExports();
