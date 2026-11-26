#!/bin/bash
# 試験実行中の macOS の前面アプリを 0.5 秒おきに記録する測定用 script。
# 使い方: record-front-app.sh <記録ファイル>
# 1 行 = 「時刻 アプリ名」。Electron / MaplatEditor の名前が入っていないことを確かめる。
out="${1:?usage: record-front-app.sh <output-file>}"
while true; do
  name="$(lsappinfo info -only name "$(lsappinfo front)" 2>/dev/null | grep -o '"[^"]*"' | head -1)"
  echo "$(date '+%Y-%m-%dT%H:%M:%S') ${name:-<none>}" >> "$out"
  sleep 0.5
done
