# MindSwitch 仕様書

## 概要

MindSwitchは、毎朝約3分の4ステップ入力によって、その日のマインドを整えることを目的としたPWAです。ビルド不要の静的ファイル構成で、GitHub Pages上でそのまま動作します。

## 技術構成

- 素のHTML / CSS / JavaScriptのみ。フレームワーク・ビルドツール不使用。
- `index.html` … 画面構造（1ファイル）
- `style.css` … スタイル（1ファイル）
- `storage.js` … データ層（先に読み込む）
- `app.js` … UI・画面遷移・ロジック層（`storage.js`の後に読み込む）
- `manifest.webmanifest` / `service-worker.js` … PWA対応

`storage.js` と `app.js` は同じグローバルスコープを共有する前提で分割されています（ES Modulesは使用していません）。読み込み順を入れ替えないでください。

## 4ステップ入力

1. **ご機嫌約束**：今日の気分を選択
2. **ネガティブ変換**：不安・心配ごとに対する前向きな見方のヒントを提示
3. **ベビーステップ**：やりたいことを今すぐ始められる小さな一歩に分解
4. **集中宣言**：一番集中したいことと最初の行動を宣言

各ステップは途中保存（下書き）に対応し、アプリを閉じても再開できます。

## データ構造

保存データのトップレベル構造（変更禁止）:

```
{
  dataFormatVersion, appName, appVersion,
  createdAt, updatedAt,
  settings: { userId, nickname, theme, fontSize, notifEnabled, notifTime, ... },
  records: [ { id, date, completed, deleted, step1, step2, step3, step4, ... } ],
  trash: [ ... ],
  backups: [ { label, createdAt, snapshot } ],
  draft: { date, step, fields, editingRecordId } | null,
  meta: { lastBackupAt, firstBackupPromptShownAt }
}
```

## 保存・整合性

- 保存先はIndexedDB（`mindswitch_db` / ストア `kv`）を主、localStorage（キー `mindswitch_appData_v1`）を補助として併用。
- 保存データには簡易チェックサムを付与し、読み込み時に検証。
- 両方が破損している場合は、直近の正常なバックアップ世代から自動復旧を試みます。
- 復旧不能な壊れたデータは削除せず、`mindswitch_quarantine_*` のキーへ隔離保存します。

これらの名称・キー・構造は今回のファイル分割にあたり変更していません。

## PWA仕様

- `manifest.webmanifest` で名称・アイコン・テーマカラー・`display: standalone` を定義。
- `service-worker.js` がコアファイルをキャッシュし、オフライン起動に対応。
- 新しい`service-worker.js`が検出されると、画面下にトースト「新しいバージョンがあります」を表示し、タップで即時反映（`skipWaiting` → `controllerchange` → リロード）。

## 変更しない前提の項目

- IndexedDBのデータベース名・ストア名
- localStorageのキー名
- レコードのID体系・データ構造
- 4ステップの意味・順序
