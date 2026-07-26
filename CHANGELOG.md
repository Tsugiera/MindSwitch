# CHANGELOG

## v1.4.0 - 2026-07-27

- 単一HTMLファイル（`MindSwitch_2026-07-27_v1_3_0.html`）から、GitHub Pages向けのマルチファイル構成へ変換。
- `index.html` / `style.css` / `storage.js` / `app.js` に分割（スマートフォンからの更新のしやすさを最優先し、フォルダ階層は作らず最小限のファイル数に構成）。
- 実際の`service-worker.js`によるオフラインキャッシュと、更新検知・「新しいバージョンがあります」通知を新規実装（旧版は単一HTMLの制約上、Service Workerを登録できなかったため未実装だった機能）。
- `manifest.webmanifest`を静的ファイル化し、実ファイルのアイコン（`icon-192.png`ほか計4種）を追加。旧版のCanvasによるアイコン動的生成・データURIマニフェスト注入は廃止。
- 既存の入力・保存・履歴・検索・カレンダー・ゴミ箱・バックアップ・JSON入出力・設定・通知・ストリーク・テーマ・文字サイズ・IndexedDB／localStorage併用・チェックサム整合性確認機能はすべて維持。IndexedDB名・ストア名・localStorageキー・レコード構造は変更なし。
- 旧・単一HTML版を`legacy.html`として同梱（予備・バックアップ用）。

## v1.3.0 以前

- `legacy.html`（旧・単一HTML版）を参照してください。
