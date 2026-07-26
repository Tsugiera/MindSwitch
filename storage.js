/* =========================================================
   MindSwitch - storage.js
   データ層：IndexedDB / localStorage / バックアップ / 復旧
   このファイルは app.js より先に読み込んでください。
   （ここで定義するデータ・状態はグローバルに共有され、
     app.js から参照されます）
========================================================= */
"use strict";

/* =========================================================
   0. 定数・ユーティリティ
========================================================= */
const APP_NAME = "MindSwitch";
const APP_VERSION = "1.4.0";
const DATA_FORMAT_VERSION = 1;
const IDB_NAME = "mindswitch_db";
const IDB_STORE = "kv";
const LS_KEY = "mindswitch_appData_v1";
const LS_QUARANTINE_PREFIX = "mindswitch_quarantine_";
const MAX_BACKUP_GENERATIONS = 10;
const DRAFT_DEBOUNCE_MS = 500;

function pad2(n){ return String(n).padStart(2,"0"); }
function todayLocalStr(d){
  d = d || new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate());
}
function nowIso(){ return new Date().toISOString(); }
function uid(){ return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,9); }
function escapeHtml(s){
  if(s===undefined || s===null) return "";
  return String(s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function announce(msg){
  const el = document.getElementById("liveregion");
  if(el){ el.textContent = ""; requestAnimationFrame(()=>{ el.textContent = msg; }); }
}
// 簡易チェックサム（暗号学的ではない整合性検証用）
function simpleChecksum(str){
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i=0;i<str.length;i++){
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
  h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1>>>0)).toString(36);
}
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }

/* =========================================================
   1. デフォルトデータ構造
========================================================= */
function defaultSettings(){
  return {
    userId: uid(),
    nickname: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    theme: "system",
    fontSize: "standard",
    notifEnabled: false,
    notifTime: "07:00",
    saveAnxiety: true,
    soundEnabled: true,
    vibrationEnabled: true,
    weekStart: 0
  };
}
function emptyAppData(){
  return {
    dataFormatVersion: DATA_FORMAT_VERSION,
    appName: APP_NAME,
    appVersion: APP_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    settings: defaultSettings(),
    records: [],
    trash: [],
    backups: [],
    draft: null,
    meta: {
      lastBackupAt: null,
      firstBackupPromptShownAt: null
    }
  };
}

/* =========================================================
   2. ストレージ層（IndexedDB 主 + localStorage 補助）
========================================================= */
const Storage = {
  idb: null,
  idbAvailable: false,
  lsAvailable: false,

  async init(){
    this.lsAvailable = this._testLocalStorage();
    this.idbAvailable = await this._openIdb();
  },

  _testLocalStorage(){
    try{
      const k = "__mindswitch_test__";
      localStorage.setItem(k,"1");
      localStorage.removeItem(k);
      return true;
    }catch(e){ return false; }
  },

  _openIdb(){
    return new Promise((resolve)=>{
      if(!window.indexedDB){ resolve(false); return; }
      try{
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function(ev){
          const db = ev.target.result;
          if(!db.objectStoreNames.contains(IDB_STORE)){
            db.createObjectStore(IDB_STORE, {keyPath:"key"});
          }
        };
        req.onsuccess = (ev)=>{ this.idb = ev.target.result; resolve(true); };
        req.onerror = ()=> resolve(false);
        req.onblocked = ()=> resolve(false);
      }catch(e){ resolve(false); }
    });
  },

  idbGet(key){
    return new Promise((resolve,reject)=>{
      if(!this.idb){ reject("no-idb"); return; }
      try{
        const tx = this.idb.transaction(IDB_STORE,"readonly");
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(key);
        req.onsuccess = ()=> resolve(req.result ? req.result.value : undefined);
        req.onerror = ()=> reject(req.error);
      }catch(e){ reject(e); }
    });
  },

  idbSet(key, value){
    return new Promise((resolve,reject)=>{
      if(!this.idb){ reject("no-idb"); return; }
      let settled = false;
      try{
        const tx = this.idb.transaction(IDB_STORE,"readwrite");
        const store = tx.objectStore(IDB_STORE);
        store.put({key:key, value:value});
        // req.onsuccess だけでは書き込みがディスクへ確定した保証にならないため、
        // トランザクション全体の完了（tx.oncomplete）を待ってから確定とみなす。
        tx.oncomplete = ()=>{ if(!settled){ settled = true; resolve(true); } };
        tx.onerror = ()=>{ if(!settled){ settled = true; reject(tx.error); } };
        tx.onabort = ()=>{ if(!settled){ settled = true; reject(tx.error || "aborted"); } };
      }catch(e){ reject(e); }
    });
  },

  lsGet(key){
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    }catch(e){ return undefined; }
  },

  lsSet(key, value){
    try{
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    }catch(e){ return false; }
  },

  quarantine(raw, reason){
    try{
      const key = LS_QUARANTINE_PREFIX + Date.now();
      localStorage.setItem(key, typeof raw==="string" ? raw : JSON.stringify(raw));
      console.warn("MindSwitch: 破損の疑いがあるデータを隔離しました", reason, key);
    }catch(e){ /* 隔離も失敗した場合は諦める（既存データは削除しない） */ }
  }
};

function withChecksum(data){
  const clone = deepClone(data);
  delete clone._checksum;
  const cs = simpleChecksum(JSON.stringify(clone));
  clone._checksum = cs;
  return clone;
}
function verifyChecksum(data){
  if(!data || typeof data !== "object") return false;
  const stored = data._checksum;
  if(!stored) return false;
  const clone = deepClone(data);
  delete clone._checksum;
  return simpleChecksum(JSON.stringify(clone)) === stored;
}
function structureLooksValid(data){
  return data && typeof data==="object" && Array.isArray(data.records) && Array.isArray(data.trash) &&
    Array.isArray(data.backups) && data.settings && typeof data.settings==="object";
}

/* =========================================================
   3. アプリ状態
========================================================= */
let AppData = null;
let currentScreen = "home";
let wizardState = null; // { date, step(1-4), fields:{...}, editingRecordId }
let saveTimer = null;
let idbWriteFailedOnce = false;
let notifTimerHandle = null;
let lastConvCandidates = [];

/* =========================================================
   4. 読み込み・保存・復旧ロジック
========================================================= */
async function loadAppData(){
  await Storage.init();

  let idbData, lsData;
  try{ idbData = Storage.idbAvailable ? await Storage.idbGet("appData") : undefined; }catch(e){ idbData = undefined; }
  try{ lsData = Storage.lsAvailable ? Storage.lsGet(LS_KEY) : undefined; }catch(e){ lsData = undefined; }

  const idbValid = idbData && verifyChecksum(idbData) && structureLooksValid(idbData);
  const lsValid = lsData && verifyChecksum(lsData) && structureLooksValid(lsData);

  let chosen = null, source = null;

  if(idbValid && lsValid){
    // 両方正常 → 更新日時が新しい方を優先
    chosen = (new Date(idbData.updatedAt||0) >= new Date(lsData.updatedAt||0)) ? idbData : lsData;
    source = "both";
  }else if(idbValid){
    chosen = idbData; source = "idb-only";
    if(lsData) Storage.quarantine(lsData, "localStorage checksum invalid");
  }else if(lsValid){
    chosen = lsData; source = "ls-only";
    if(idbData) Storage.quarantine(idbData, "IndexedDB checksum invalid");
  }else{
    // 両方無効 → バックアップ世代から復旧を試みる
    const candidates = [idbData, lsData].filter(Boolean);
    for(const c of candidates){
      if(c && Array.isArray(c.backups) && c.backups.length){
        const sorted = [...c.backups].sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
        for(const bk of sorted){
          if(bk && bk.snapshot && verifyChecksum(bk.snapshot) && structureLooksValid(bk.snapshot)){
            chosen = bk.snapshot; source = "backup-recovery"; break;
          }
        }
      }
      if(chosen) break;
    }
    if(!chosen){
      if(idbData) Storage.quarantine(idbData, "both invalid, idb raw");
      if(lsData) Storage.quarantine(lsData, "both invalid, ls raw");
      chosen = emptyAppData();
      source = "fresh";
    }
  }

  chosen = migrateIfNeeded(chosen);
  AppData = chosen;
  recomputeAggregates();
  return source;
}

/* ---- レコード構造の自動検出・正規化（sanitizeRecord） ----
   欠落・破損したstep1〜step4を安全な既定値で補い、
   表示・描画処理でのTypeErrorを未然に防ぐ。
   loadAppData()（migrateIfNeeded経由）とimportJsonObject()の
   両方の入口で必ず通す。 */
function defaultStep1(){ return {mood:"", promise:false, promiseText:""}; }
function defaultStep2(){ return {anxietyText:"", convertedText:"", convertedSelected:"", skipped:false}; }
function defaultStep3(){ return {action:"", babyStep:"", plannedTime:"", duration:""}; }
function defaultStep4(){ return {focusTask:"", startTime:"", firstAction:"", obstacle:"", countermeasure:"", declared:false}; }

function sanitizeRecord(r){
  if(!r || typeof r !== "object") r = {};
  if(!r.id || typeof r.id !== "string") r.id = uid();
  if(!r.date || typeof r.date !== "string") r.date = todayLocalStr();
  r.completed = !!r.completed;
  r.deleted = !!r.deleted;
  if(!r.createdAt) r.createdAt = r.updatedAt || nowIso();
  if(!r.updatedAt) r.updatedAt = r.createdAt;

  r.step1 = Object.assign(defaultStep1(), (r.step1 && typeof r.step1==="object") ? r.step1 : {});
  r.step2 = Object.assign(defaultStep2(), (r.step2 && typeof r.step2==="object") ? r.step2 : {});
  r.step3 = Object.assign(defaultStep3(), (r.step3 && typeof r.step3==="object") ? r.step3 : {});
  r.step4 = Object.assign(defaultStep4(), (r.step4 && typeof r.step4==="object") ? r.step4 : {});

  if(typeof r.step1.mood !== "string") r.step1.mood = "";
  if(typeof r.step1.promiseText !== "string") r.step1.promiseText = "";
  r.step1.promise = !!r.step1.promise;

  if(typeof r.step2.anxietyText !== "string") r.step2.anxietyText = "";
  if(typeof r.step2.convertedText !== "string") r.step2.convertedText = "";
  if(typeof r.step2.convertedSelected !== "string") r.step2.convertedSelected = "";
  r.step2.skipped = !!r.step2.skipped;

  if(typeof r.step3.action !== "string") r.step3.action = "";
  if(typeof r.step3.babyStep !== "string") r.step3.babyStep = "";
  if(typeof r.step3.plannedTime !== "string") r.step3.plannedTime = "";
  if(typeof r.step3.duration !== "string") r.step3.duration = "";

  if(typeof r.step4.focusTask !== "string") r.step4.focusTask = "";
  if(typeof r.step4.startTime !== "string") r.step4.startTime = "";
  if(typeof r.step4.firstAction !== "string") r.step4.firstAction = "";
  if(typeof r.step4.obstacle !== "string") r.step4.obstacle = "";
  if(typeof r.step4.countermeasure !== "string") r.step4.countermeasure = "";
  r.step4.declared = !!r.step4.declared;

  return r;
}
function sanitizeRecords(arr){
  if(!Array.isArray(arr)) return [];
  return arr.map(sanitizeRecord);
}
// 下書き（wizardStateの保存形）の欠落フィールドを既定値で補う
function sanitizeDraft(draft){
  if(!draft || typeof draft !== "object") return draft;
  draft.fields = Object.assign(newWizardFields(), (draft.fields && typeof draft.fields==="object") ? draft.fields : {});
  if(!draft.date) draft.date = todayLocalStr();
  if(!draft.step || draft.step<1 || draft.step>4) draft.step = 1;
  return draft;
}

function migrateIfNeeded(data){
  if(!data.dataFormatVersion || data.dataFormatVersion < DATA_FORMAT_VERSION){
    // 将来の形式変更に備えた移行フック。現状はv1のみ。
    data.dataFormatVersion = DATA_FORMAT_VERSION;
  }
  if(!data.settings) data.settings = defaultSettings();
  if(!Array.isArray(data.records)) data.records = [];
  if(!Array.isArray(data.trash)) data.trash = [];
  if(!Array.isArray(data.backups)) data.backups = [];
  if(!data.meta) data.meta = {lastBackupAt:null, firstBackupPromptShownAt:null};
  // レコード構造を強制的に正規化し、欠落したstep1〜4を補う
  data.records = sanitizeRecords(data.records);
  data.trash = sanitizeRecords(data.trash);
  if(data.draft) data.draft = sanitizeDraft(data.draft);
  return data;
}

let saveInFlight = false;
let saveQueued = false;
async function persist(opts){
  opts = opts || {};
  if(saveInFlight){ saveQueued = true; return; }
  saveInFlight = true;
  setSaveStatus("saving");
  AppData.updatedAt = nowIso();
  const payload = withChecksum(AppData);

  let idbOk = false, lsOk = false;
  try{
    if(Storage.idbAvailable){ await Storage.idbSet("appData", payload); idbOk = true; }
  }catch(e){ idbOk = false; }
  try{
    if(Storage.lsAvailable){ lsOk = Storage.lsSet(LS_KEY, payload); }
  }catch(e){ lsOk = false; }

  saveInFlight = false;
  if(saveQueued){ saveQueued = false; persist(opts); return; }

  if(idbOk || lsOk){
    setSaveStatus("saved");
  }else{
    setSaveStatus("error");
    announce("保存に失敗しました。入力内容は画面に保持されています。");
  }
  return idbOk || lsOk;
}

function setSaveStatus(state){
  const el = document.getElementById("save-status");
  const txt = document.getElementById("save-status-text");
  if(!el || !txt) return;
  el.className = "save-status " + state;
  if(state==="saving"){ txt.textContent = "保存中…"; }
  else if(state==="saved"){ txt.textContent = "保存済み"; }
  else if(state==="error"){ txt.textContent = "保存に失敗しました（再試行します）"; }
}

function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{ persist(); }, DRAFT_DEBOUNCE_MS);
}
function saveNowImmediate(){
  clearTimeout(saveTimer);
  return persist();
}

// pagehide / visibilitychange は非同期処理の完了を待たずにページが破棄される可能性があるため、
// まず同期的な localStorage への書き込みを即座に確定させ、そのうえで非同期のIndexedDB保存も試みる。
function emergencySaveSync(){
  try{
    clearTimeout(saveTimer);
    if(!AppData) return;
    AppData.updatedAt = nowIso();
    const payload = withChecksum(AppData);
    if(Storage.lsAvailable){ Storage.lsSet(LS_KEY, payload); }
    if(Storage.idbAvailable){ Storage.idbSet("appData", payload).catch(()=>{}); }
  }catch(e){ /* 緊急保存自体が失敗しても、画面遷移をブロックしない */ }
}

// 終了・非表示イベントでの保存
["pagehide","visibilitychange","beforeunload"].forEach(evt=>{
  window.addEventListener(evt, ()=>{
    if(document.visibilityState === "hidden" || evt !== "visibilitychange"){
      emergencySaveSync();
    }
  });
});
window.addEventListener("error", function(ev){
  // JS例外発生時も、下書きだけは緊急保存を試みる
  try{ if(wizardState){ commitWizardFieldsToDraft(); saveNowImmediate(); } }catch(e){}
});

/* =========================================================
   5. バックアップ / エクスポート / インポート
========================================================= */
function createBackupGeneration(label){
  const snapshot = deepClone(AppData);
  delete snapshot.backups; // バックアップ自身は入れ子にしない
  snapshot.backups = [];
  const entry = {
    id: uid(),
    createdAt: nowIso(),
    label: label || "自動バックアップ",
    recordCount: AppData.records.length,
    snapshot: withChecksum(snapshot)
  };
  AppData.backups.push(entry);
  AppData.backups.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
  while(AppData.backups.length > MAX_BACKUP_GENERATIONS){ AppData.backups.shift(); }
  AppData.meta.lastBackupAt = nowIso();
  return entry;
}

function exportJson(){
  const payload = {
    appName: APP_NAME,
    appVersion: APP_VERSION,
    dataFormatVersion: DATA_FORMAT_VERSION,
    exportedAt: nowIso(),
    settings: AppData.settings,
    records: AppData.records,
    trash: AppData.trash
  };
  const withCs = withChecksum(payload);
  const blob = new Blob([JSON.stringify(withCs, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const fname = "MindSwitch_export_" + todayLocalStr() + ".json";
  a.href = url; a.download = fname;
  document.body.appendChild(a);
  try{ a.click(); }catch(e){ showToast("ダウンロードに失敗しました。ブラウザの設定をご確認ください。"); }
  document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 4000);
}

function validateImportFile(obj){
  const errors = [];
  if(!obj || typeof obj !== "object") errors.push("ファイルの形式が正しくありません。");
  else{
    if(!Array.isArray(obj.records)) errors.push("記録データが見つかりません。");
    if(!obj.dataFormatVersion) errors.push("データ形式のバージョン情報がありません。");
  }
  return errors;
}

function importJsonObject(obj, mode){
  const errors = validateImportFile(obj);
  if(errors.length){ return {ok:false, errors}; }

  createBackupGeneration("インポート前の自動バックアップ");

  let added=0, updated=0, ignored=0, errorCount=0;
  const existingById = new Map(AppData.records.map(r=>[r.id,r]));
  const existingByDate = new Map(AppData.records.map(r=>[r.date,r]));

  if(mode === "overwrite"){
    AppData.records = [];
    existingById.clear(); existingByDate.clear();
  }

  (obj.records||[]).forEach(rawRec=>{
    try{
      if(!rawRec || !rawRec.date){ errorCount++; return; }
      // インポートされたレコードは、形式の新旧・破損有無に関わらず
      // ここで必ずstep1〜4を補正・正規化してから取り込む
      const rec = sanitizeRecord(deepClone(rawRec));
      const dupById = rec.id && existingById.get(rec.id);
      const dupByDate = existingByDate.get(rec.date);
      const dup = dupById || dupByDate;
      if(dup){
        const incomingTime = new Date(rec.updatedAt||0).getTime();
        const existingTime = new Date(dup.updatedAt||0).getTime();
        if(incomingTime > existingTime){
          Object.assign(dup, rec);
          sanitizeRecord(dup);
          updated++;
        }else{
          ignored++;
        }
      }else{
        AppData.records.push(rec);
        existingById.set(rec.id, rec);
        existingByDate.set(rec.date, rec);
        added++;
      }
    }catch(e){ errorCount++; }
  });

  if(Array.isArray(obj.trash)){
    obj.trash.forEach(t=>{
      if(t && t.id && !AppData.trash.find(x=>x.id===t.id)){
        try{ AppData.trash.push(sanitizeRecord(deepClone(t))); }catch(e){}
      }
    });
  }

  recomputeAggregates();
  saveNowImmediate();
  return {ok:true, added, updated, ignored, errorCount};
}

