# 同梱している外部の部品

CDN から毎回読み込まず、版を固定してここに置く（API キーに外部のスクリプトが触れないようにするため。docs/06）。

| フォルダ | 部品 | 版 | 入手元 | 確認 |
|---|---|---|---|---|
| `anthropic-sdk/` | `@anthropic-ai/sdk`（公式 TypeScript SDK の ESM ビルド） | 0.135.0（2026-10-15 公開） | registry.npmjs.org | npm の integrity（sha512）一致を確認。`index.mjs` から辿れる `.mjs` だけを置く |
| `opentelemetry-api/` | `@opentelemetry/api`（SDK が使う。何も登録しなければ何もしない） | 1.9.1 | registry.npmjs.org | integrity 一致を確認。`build/esm` のみ。**ブラウザで読めるよう、相対 import に `.js` を付け足した**（中身の処理は変えていない） |
| `standardwebhooks-stub.mjs` | `standardwebhooks` の代わり（自作の空の部品） | — | — | このアプリは webhook を使わない |

- 外部の名前（`@opentelemetry/api` など）は `index.html` の import map でこのフォルダに向けている。import map を変えたら CSP のハッシュも計算し直す
- 更新するときは、公開から2週間以上たった版を選び、integrity を確認してから入れ替える
- ライセンス：各フォルダの `LICENSE`（どちらも商用・個人利用可）
