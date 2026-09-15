# CI のテスト実行（smoke / e2e）と除外表

`.github/workflows/test.yml`（`Tests`）が、push（master・glm52・foss4g-hiroshima）・PR・手動実行で次を行う（#121・oct26-m4-t5）。

| job | 内容 |
|---|---|
| `smoke` | install → `pnpm run build` → `scripts/ci/run-smokes.mjs`（`smoke:*` を全数・直列）→ `scripts/ci/judge-test-results.mjs smoke` |
| `e2e (1)〜(3)` | install → `pnpm run build` → `playwright test --forbid-only --shard=N/3`（exit を `playwright-exit.txt` に記録）→ `judge-test-results.mjs e2e` |

e2e job は Playwright の前に Electron（`com.github.Electron`）の言語を `ja` に固定し（`defaults write com.github.Electron AppleLanguages -array ja`）、`scripts/ci/electron-locale-check.cjs` で `app.getLocale()` が `ja` であることを確かめる。
macOS runner の言語は en-US で、MaplatEditor は設定が無いと OS の言語で UI を起動するため、日本語の文言を待つ e2e が英語 UI で落ちるのを防ぐ（マージ判断 oct26-m4-t5 追補 1）。

**job の合否は判定器の exit だけで決まる。** 判定器は fail-closed で、報告が無い・壊れている・数が合わない・中断された、はすべて赤。

## 除外表 `ci/test-exclusions.json`

| kind | 意味 | 判定 |
|---|---|---|
| `excluded`（smoke のみ） | 実行しない（runner に無いツール・非公開の前提・時間） | 実行されたら赤（実行集合の不一致） |
| `known-failure` | 起点から赤の既知失敗 | smoke: 失敗し、出力に `expect` を含めば緑。**通ったら赤**・別の理由（`expect` 不一致）で落ちたら赤。e2e: `unexpected` なら緑・`flaky` なら緑（Summary に「間欠化」）・**1 回目で通ったら赤**・skipped なら赤 |
| `intermittent`（e2e のみ） | 間欠する失敗。**載せるのは同じ commit で合格と失敗の両方を観測したものだけ** | `unexpected`・`flaky`・`expected` のいずれも緑（Summary に毎回 `intermittent（許容）: … （結果 …）` を出す）・skipped なら赤・同じ file が実行されたのに報告に無ければ赤。`issue` 必須（直す Issue）。smoke では使えない（形式検査で赤）。**通っても落ちても緑なので、本当に壊れても見えない** → 件数を最小に保ち、Issue の修正と同じ変更で表から外す |

- 全エントリに `kind`・`reason`・`issue` が必須（空文字は不可）。smoke の `known-failure` は `expect`（失敗出力の固定部分。パスや乱数を含めない）が必須
- e2e のエントリは `file`（`tests/e2e/` からの相対）・`line`（`test(` のある行）・`title`（その `test(` の第 1 引数。describe 名は含めない）
- 表に書いていない smoke・spec は自動で実行対象になる（新しい smoke・spec を足したときに表を触る必要は無い）
- **失敗を集めてから最後にまとめて throw する型の smoke** を `known-failure` に載せるときは、`expect` に失敗件数を含める（例: `3 件失敗`）。固定文言だけだと、同じ smoke の中で新しく増えた失敗が既知失敗に隠れる

## 手元で判定を通す

```bash
cp ci/pnpm-workspace.ci.yaml pnpm-workspace.yaml   # 単独 clone のときだけ（Maplats 配下の checkout では行わない）
pnpm install --frozen-lockfile
pnpm run build
# runner に無いツール（bun 等）を PATH から外し、TMPDIR を使い捨ての場所に向ける
node scripts/ci/run-smokes.mjs --report smoke-report.json       # = pnpm run ci:smoke
node scripts/ci/judge-test-results.mjs smoke --report smoke-report.json   # = pnpm run ci:judge

# e2e の前に Electron の言語が ja であることを確かめる（NG なら測らない。Electron.app の .lproj が欠けても NG になる）
./node_modules/.bin/electron scripts/ci/electron-locale-check.cjs

# e2e は 3 シャードすべてを回し、シャードごとに --shard n/3 を付けて判定する
# 手元では m12-t18-os-trash-delete.spec.ts を外す（実際の ~/.Trash に書くため。runner では実行される）。
# --grep-invert を使うときは 3 シャードすべてに同じものを付ける（シャードの割り当てがそろい、取りこぼしが出ない）
for n in 1 2 3; do
  PLAYWRIGHT_JSON_OUTPUT_NAME=e2e-report-$n.json ./node_modules/.bin/playwright test --forbid-only --shard=$n/3 --reporter=json,list \
    --grep-invert "m12-t18-os-trash-delete"
  echo $? > playwright-exit-$n.txt
  node scripts/ci/judge-test-results.mjs e2e --report e2e-report-$n.json --exit-file playwright-exit-$n.txt --shard $n/3
done

# 取りこぼし（表のエントリがどのシャードにも現れない = not-observed）は 3 シャードの報告をまとめて measure-exclusions で見る
node scripts/ci/measure-exclusions.mjs --smoke-report smoke-report.json \
  --e2e-reports e2e-report-1.json,e2e-report-2.json,e2e-report-3.json --out exclusions-diff.json --fail-on-diff 1
```

- 判定器はシャード単位でしか判定しない（`--shard` を付けずに複数シャードをまとめて与える使い方は無い）。シャードをまたぐ検査は measure-exclusions が受け持つ
- 手元で e2e のファイルを外すとシャードの割り当てが runner と変わる。手元の結果は外した上での参考値で、runner の結果が正本
- `--forbid-only` を必ず付ける（`test.only` の混入で一部だけ実行した報告を緑と読まない）
- 判定を**合流の証跡**に使うときは、中断（Ctrl-C・タイムアウト）していない報告であることが判定器で確かめられる（`interrupted`・注記の無い skipped・exit 0/1 以外は赤）
- 報告ファイル（`smoke-report*.json`・`e2e-report*.json`・`playwright-exit*.txt`・`exclusions-diff.json`）は `.gitignore` 済み。commit しない

## 除外表の測り直し（`scripts/ci/measure-exclusions.mjs`）

```bash
node scripts/ci/measure-exclusions.mjs --smoke-report smoke-report.json \
  --e2e-reports e2e-report-1.json,e2e-report-2.json,e2e-report-3.json --out exclusions-diff.json
```

表は書き換えない。差分案（`unregistered-failure`・`registered-but-passed`・`expect-mismatch`・`intermittent`（known-failure が再試行で合格した）・`registered-but-skipped`・`not-observed`）を JSON で出す（kind `intermittent` のエントリは結果を問わず差分にしない）。各行の `reason`・`issue`・`expect` を人（またはエージェント）が埋めて表を直す。**新しく出た失敗を `known-failure` に載せるときは、原因がその変更の外にあることを失敗ログで示し、`issue` に既存 Issue か新 Issue を書く。原因が分からない失敗は載せずに合流を止める。**

## 合流の順序と、表を直す責任（t5 と並行タスク）

表の中身は、**t5（本 CI）を合流する直前の master で測り直して確定する**。並行中の oct26-m4-t2ff 第 2 版・oct26-m4-t2s との順序で、次の 2 通りがある。

| 状況 | 表を確定する時点 | 後から合流する側の手順 |
|---|---|---|
| **t2ff 第 2 版・t2s が先に master へ合流済み**（予定: 09-23 まで） | 両者の合流後の master に t5 を載せた tree で測る | —（両者の結果は測り直しで表に取り込まれる） |
| **t5 が先に合流する**（t2ff・t2s が 09-23 までに合流しない場合） | その時点の master で測って t5 を合流 | **t2ff・t2s は合流前に手元で `ci:smoke` → `ci:judge`（t2ff は e2e とその判定も）を通し、表を直した状態で合流する**。t2s は直した smoke のエントリを表から外す（`expect` が変わるものは直す） |

t5 合流後に入るすべての変更（#117 の是正・oct26-m4-t6 CSP など）も同じ:

- 既知失敗を直した → **同じ変更で表から外す**（外さないと「通ったのに表に残っている」で赤）
- 新しい失敗が出た → 直すか、上の根拠を付けて表に載せる
- MaplatEditor は master へ直接 push するため、手元で確かめずに合流すると赤は合流後の master で出る。**その場合は赤にした合流の担当が直す**

## 実行器の打ち切りについて

- 1 本 600 秒（`--timeout-sec`）で打ち切り、`signal`・`timedOut` を報告に残す（判定は赤）
- 打ち切りはプロセスグループごとの SIGKILL に加え、打ち切り時点の子孫（別のプロセスグループへ移ったものも含む）を `ps` の親子関係で辿って SIGKILL する。本体の exit 後もパイプを握る子孫がいれば 5 秒で切り離して次へ進む
- 届かないのは「打ち切りより前に親が終了し、pid 1 に付け替えられた別グループの孫」だけ。runner は使い捨てなので実害は無いが、手元では孤児が残りうる（既存の smoke・spec に `detached`・`setsid`・`nohup` は無い）
