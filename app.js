/* =========================================================
   MindSwitch - app.js
   UI・画面遷移・記録集計・変換ルール・初期化
   storage.js より後に読み込んでください。
========================================================= */
"use strict";
/* =========================================================
   6. 記録・集計ロジック
========================================================= */
function getActiveRecords(){ return AppData.records.filter(r=>!r.deleted); }

function findTodayRecord(){
  const t = todayLocalStr();
  return getActiveRecords().find(r=>r.date===t);
}

function recomputeAggregates(){
  const dates = [...new Set(getActiveRecords().filter(r=>r.completed).map(r=>r.date))].sort();
  AppData.meta.streakCurrent = computeCurrentStreak(dates);
  AppData.meta.streakBest = computeBestStreak(dates);
  AppData.meta.totalCompleted = dates.length;
  const now = new Date();
  const ym = now.getFullYear()+"-"+pad2(now.getMonth()+1);
  AppData.meta.monthCount = dates.filter(d=>d.startsWith(ym)).length;
}

function computeCurrentStreak(sortedDates){
  if(!sortedDates.length) return 0;
  const set = new Set(sortedDates);
  const today = todayLocalStr();
  let cursor = set.has(today) ? new Date() : new Date(Date.now()-86400000);
  if(!set.has(todayLocalStr(cursor))) return 0;
  let count = 0;
  while(set.has(todayLocalStr(cursor))){
    count++;
    cursor = new Date(cursor.getTime()-86400000);
  }
  return count;
}
function computeBestStreak(sortedDates){
  if(!sortedDates.length) return 0;
  let best=1, cur=1;
  for(let i=1;i<sortedDates.length;i++){
    const prev = new Date(sortedDates[i-1]+"T00:00:00");
    const cur2 = new Date(sortedDates[i]+"T00:00:00");
    const diffDays = Math.round((cur2-prev)/86400000);
    if(diffDays===1){ cur++; }else{ cur=1; }
    if(cur>best) best=cur;
  }
  return best;
}

/* =========================================================
   7. 変換ルールエンジン（ネガティブ→前向きヒント）
========================================================= */
const REFRAME_RULES = [
  { kws:["失敗"], candidates:[
    "失敗しない準備として、今できる小さな行動を一つ考えてみましょう",
    "結果を完全に決めることはできませんが、準備の質は上げられます",
    "失敗しても、次に改善するための情報が得られます"
  ]},
  { kws:["つらい","しんどい","疲れ"], candidates:[
    "今日一日すべてではなく、最初の10分だけに集中してみましょう",
    "無理をせず、終わらせる範囲を小さく決めてみましょう",
    "体調が悪い場合は、休息や相談も選択肢に入れてください"
  ]},
  { kws:["不安","心配"], candidates:[
    "その不安の中で、今すぐ自分にできることを一つだけ探してみましょう",
    "不安がすべて外れることもあります。今は準備できる範囲に目を向けてみましょう",
    "紙に書き出すだけでも、頭の中が少し整理されることがあります"
  ]},
  { kws:["自信がない","できない","無理"], candidates:[
    "「今はまだできない」と「一生できない」は違います。今日の一歩だけ考えてみましょう",
    "完璧にできなくても、少し前進できれば十分です",
    "できないと感じるときほど、一番小さい行動から始めてみましょう"
  ]},
  { kws:["怒","イライラ"], candidates:[
    "その気持ちの奥にある「大事にしたいこと」は何か、少し考えてみましょう",
    "一呼吸置いてから、伝え方を選んでみましょう",
    "反応する前に、事実と自分の解釈を分けてみましょう"
  ]},
  { kws:["人間関係","苦手","嫌い"], candidates:[
    "相手のすべてに合わせる必要はありません。今日必要な距離感を決めてみましょう",
    "自分の対応だけをコントロールする、と決めてみましょう",
    "小さな挨拶や一言だけ、今日試してみるのも一つの方法です"
  ]}
];
const REFRAME_GENERIC = [
  "その気持ちを否定せず、まず今日一つだけできることを考えてみましょう",
  "全部を一度に解決しなくて大丈夫です。今できる範囲を決めてみましょう",
  "同じ状況でも、見る角度を変えると違う選択肢が見えることがあります",
  "今の気持ちをそのまま認めた上で、次の30分だけ考えてみましょう"
];
function generateReframeCandidates(text, excludeSet){
  const pool = [];
  REFRAME_RULES.forEach(rule=>{
    if(rule.kws.some(k=>text.includes(k))){ pool.push(...rule.candidates); }
  });
  pool.push(...REFRAME_GENERIC);
  const unique = [...new Set(pool)].filter(c=> !excludeSet || !excludeSet.has(c));
  return unique.slice(0,3);
}

const BABY_STEP_SUGGESTIONS = [
  "アプリを開く","必要な道具を机に置く","1分だけ取り組む","最初の1行を書く","最初の1項目だけ確認する","5分のタイマーをセットする"
];

/* =========================================================
   8. 画面遷移
========================================================= */
function showScreen(name, opts){
  opts = opts || {};
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  const el = document.getElementById("screen-"+name);
  if(el) el.classList.add("active");
  currentScreen = name;
  window.scrollTo(0,0);
  if(!opts.noHistory){
    try{ history.pushState({screen:name}, "", "#"+name); }catch(e){}
  }
  const focusTarget = el ? el.querySelector("h1,h2") : null;
  if(focusTarget){ focusTarget.setAttribute("tabindex","-1"); focusTarget.focus({preventScroll:true}); }
}
window.addEventListener("popstate", (ev)=>{
  const state = ev.state || {screen:"home"};
  const screen = state.screen || "home";

  // ウィザード画面内でステップ情報を伴う遷移の場合は、ホームへ抜けるのではなく
  // 該当ステップへ戻す（スマホの「戻る」操作を1ステップ分の巻き戻しにする）
  if(screen === "wizard" && wizardState && typeof state.step === "number"){
    wizardState.step = state.step;
    commitWizardFieldsToDraft();
    document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
    const wizEl = document.getElementById("screen-wizard");
    if(wizEl) wizEl.classList.add("active");
    currentScreen = "wizard";
    renderWizardStep();
    return;
  }

  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  const el = document.getElementById("screen-"+screen);
  if(el) el.classList.add("active");
  currentScreen = screen;
  // ウィザードから離脱する場合は、念のため下書きを保存しておく
  if(wizardState && screen !== "wizard"){ commitWizardFieldsToDraft(); scheduleSave(); }
  renderCurrentScreen();
});

function renderCurrentScreen(){
  if(currentScreen==="home") renderHome();
  else if(currentScreen==="wizard") renderWizardStep();
  else if(currentScreen==="history") renderHistory();
  else if(currentScreen==="detail") renderRecordConfirm();
  else if(currentScreen==="trash") renderTrash();
  else if(currentScreen==="settings") renderSettings();
}

/* =========================================================
   9. トースト・モーダル
========================================================= */
function showToast(msg, actionLabel, actionFn, timeoutMs){
  const root = document.getElementById("toast-root");
  root.innerHTML = "";
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role","status");
  t.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  if(actionLabel){
    const b = document.createElement("button");
    b.textContent = actionLabel;
    b.onclick = ()=>{ root.innerHTML=""; actionFn && actionFn(); };
    t.appendChild(b);
  }
  root.appendChild(t);
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>{ if(root.contains(t)) root.innerHTML=""; }, timeoutMs || 6000);
}

function openModal(html, opts){
  opts = opts || {};
  const root = document.getElementById("modal-root");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay" + (opts.center? " center":"");
  overlay.innerHTML = `<div class="modal-sheet" role="dialog" aria-modal="true">${html}</div>`;
  overlay.addEventListener("click",(e)=>{ if(e.target===overlay && opts.dismissable!==false) closeModal(); });
  root.innerHTML = "";
  root.appendChild(overlay);
  const firstFocusable = overlay.querySelector("button, input, textarea, select, [tabindex]");
  if(firstFocusable) firstFocusable.focus();
  return overlay;
}
function closeModal(){ document.getElementById("modal-root").innerHTML = ""; }

function confirmDialog(title, message, confirmLabel, opts){
  return new Promise(resolve=>{
    opts = opts || {};
    const overlay = openModal(`
      <h2>${escapeHtml(title)}</h2>
      <p class="small" style="margin-bottom:16px;">${escapeHtml(message)}</p>
      ${opts.requireText ? `<div class="field"><label class="field-label" for="confirm-text-input">「${escapeHtml(opts.requireText)}」と入力してください</label><input type="text" id="confirm-text-input"></div>` : ""}
      <div class="btn-row">
        <button class="btn btn-outline" id="confirm-cancel">キャンセル</button>
        <button class="btn ${opts.danger? "btn-danger":"btn-primary"}" id="confirm-ok">${escapeHtml(confirmLabel)}</button>
      </div>
    `, {center:true});
    overlay.querySelector("#confirm-cancel").onclick = ()=>{ closeModal(); resolve(false); };
    overlay.querySelector("#confirm-ok").onclick = ()=>{
      if(opts.requireText){
        const val = overlay.querySelector("#confirm-text-input").value;
        if(val !== opts.requireText){ showToast("入力内容が一致しません"); return; }
      }
      closeModal(); resolve(true);
    };
  });
}

/* =========================================================
   10. ホーム画面
========================================================= */
function renderHome(){
  const d = new Date();
  const weekdays = ["日","月","火","水","木","金","土"];
  document.getElementById("home-date").textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;

  const hour = d.getHours();
  const greetingEl = document.getElementById("home-greeting");
  if(hour>=4 && hour<11){ greetingEl.textContent = "おはよう！今日のマインドをセットしよう"; }
  else if(hour>=11 && hour<17){ greetingEl.textContent = "こんにちは。今からでもマインドをセットできます"; }
  else{ greetingEl.textContent = "こんばんは。落ち着いて、今日を振り返ってみましょう"; }

  recomputeAggregates();
  document.getElementById("stat-current").textContent = AppData.meta.streakCurrent||0;
  document.getElementById("stat-best").textContent = AppData.meta.streakBest||0;
  document.getElementById("stat-month").textContent = AppData.meta.monthCount||0;
  document.getElementById("stat-total").textContent = AppData.meta.totalCompleted||0;

  const todayRec = findTodayRecord();
  const banner = document.getElementById("home-status-banner");
  const startBtn = document.getElementById("btn-start");
  const resumeBtn = document.getElementById("btn-resume");
  const confirmBtn = document.getElementById("btn-today-confirm");
  const editBtn = document.getElementById("btn-today-edit");
  startBtn.textContent = "3分でスタート";
  resumeBtn.textContent = "前回の続きから再開";

  const activeDraft = AppData.draft && AppData.draft.date === todayLocalStr() ? AppData.draft : null;
  const isEditDraft = !!(activeDraft && activeDraft.editingRecordId);

  if(isEditDraft){
    // 「今日の内容を修正」を開始した途中の下書きが残っている場合。
    // 元の完成記録はまだ書き換えられていないため、確認画面では元の内容が見える。
    banner.innerHTML = `<div class="banner banner-warn">今日の内容を修正中です。続きから再開できます。</div>`;
    startBtn.style.display = "none";
    resumeBtn.textContent = "修正の続きから再開";
    resumeBtn.style.display = "block";
    confirmBtn.style.display = todayRec ? "block" : "none";
    editBtn.style.display = "none";
  }else if(todayRec && todayRec.completed){
    banner.innerHTML = `<div class="banner banner-gentle">今日のマインドセットは完了しています。内容を確認するか、修正できます。</div>`;
    startBtn.style.display = "none";
    resumeBtn.style.display = "none";
    confirmBtn.style.display = "block";
    editBtn.style.display = "block";
  }else if(activeDraft){
    banner.innerHTML = `<div class="banner banner-warn">下書きが保存されています。続きから再開できます。</div>`;
    startBtn.style.display = "block";
    resumeBtn.style.display = "block";
    confirmBtn.style.display = "none";
    editBtn.style.display = "none";
  }else{
    banner.innerHTML = "";
    startBtn.style.display = "block";
    resumeBtn.style.display = "none";
    confirmBtn.style.display = "none";
    editBtn.style.display = "none";
  }

  const wordEl = document.getElementById("home-today-word");
  const words = ["今日は昨日より少しだけ前を向ければ十分です。","小さな一歩も、積み重なれば大きな距離になります。","無理をしないことも、今日の立派な選択です。","完璧でなくても、今日の自分を認めてあげましょう。"];
  const wordText = words[d.getDate() % words.length];
  document.getElementById("today-word-text").textContent = wordText;
  wordEl.style.display = "block";
}

document.getElementById("btn-start").addEventListener("click", ()=>{
  const todayRec = findTodayRecord();
  if(todayRec && todayRec.completed){
    beginEditRecord(todayRec);
  }else{
    startWizard();
  }
});
document.getElementById("btn-resume").addEventListener("click", ()=>{ resumeDraft(); });
document.getElementById("btn-today-confirm").addEventListener("click", ()=>{
  const rec = findTodayRecord();
  if(rec) openRecordConfirm(rec.id, "today");
});
document.getElementById("btn-today-edit").addEventListener("click", ()=>{
  const rec = findTodayRecord();
  if(rec) beginEditRecord(rec);
});
document.getElementById("btn-history").addEventListener("click", ()=> showScreen("history"));
document.getElementById("btn-settings").addEventListener("click", ()=> showScreen("settings"));
document.getElementById("btn-help").addEventListener("click", ()=> showScreen("help"));
document.getElementById("btn-help-back").addEventListener("click", ()=> showScreen("home"));

/* =========================================================
   11. ウィザード（4ステップ入力）
========================================================= */
function newWizardFields(){
  return {
    mood:"", promise:false, promiseText:"",
    anxietyText:"", convertedText:"", convertedSelected:"", convertedSkipped:false,
    action:"", babyStep:"", plannedTime:"", duration:"",
    focusTask:"", startTime:"", firstAction:"", obstacle:"", countermeasure:"", declared:false
  };
}

// ウィザード画面に入る際、ステップ番号を history の state に載せて
// pushStateする。以後、ステップの前後移動もすべてhistory経由で行うことで、
// スマホの「戻る」操作がホームへの離脱ではなく「1つ前のステップへ戻る」
// 動作になるようにする。
function enterWizardScreen(){
  showScreen("wizard", {noHistory:true});
  try{ history.pushState({screen:"wizard", step:wizardState.step}, "", "#wizard-step"+wizardState.step); }catch(e){}
  renderWizardStep();
}
function startWizard(){
  const existingDraft = AppData.draft;
  if(existingDraft && existingDraft.date === todayLocalStr()){
    wizardState = sanitizeDraft(deepClone(existingDraft));
  }else{
    wizardState = { date: todayLocalStr(), step:1, fields: newWizardFields(), editingRecordId:null, createdAt: nowIso() };
    AppData.draft = deepClone(wizardState);
    scheduleSave();
  }
  enterWizardScreen();
}
function resumeDraft(){
  if(AppData.draft){
    wizardState = sanitizeDraft(deepClone(AppData.draft));
    enterWizardScreen();
  }else{
    startWizard();
  }
}
function startWizardFromRecord(rec, keepSnapshot){
  rec = sanitizeRecord(rec);
  wizardState = {
    date: rec.date, step:1,
    fields: {
      mood:rec.step1.mood, promise:rec.step1.promise, promiseText:rec.step1.promiseText,
      anxietyText:rec.step2.anxietyText||"", convertedText:rec.step2.convertedText||"", convertedSelected:rec.step2.convertedSelected||"", convertedSkipped:rec.step2.skipped||false,
      action:rec.step3.action, babyStep:rec.step3.babyStep, plannedTime:rec.step3.plannedTime, duration:rec.step3.duration,
      focusTask:rec.step4.focusTask, startTime:rec.step4.startTime, firstAction:rec.step4.firstAction, obstacle:rec.step4.obstacle, countermeasure:rec.step4.countermeasure, declared:rec.step4.declared
    },
    editingRecordId: rec.id, createdAt: rec.createdAt,
    // 修正セッションの場合、破棄時に戻せるよう修正開始前の記録全体を保持しておく。
    // 新規入力時（keepSnapshot未指定）はnullのままにする。
    preEditSnapshot: keepSnapshot ? deepClone(rec) : null
  };
  // 編集用の一時データ（下書き）を直ちに永続化し、リロード後も再開できるようにする。
  commitWizardFieldsToDraft();
  scheduleSave();
  enterWizardScreen();
}

// 「今日の内容を修正」「この記録を修正」から呼ばれる、確認済み記録の修正開始処理。
// 修正前に必ず自動バックアップを作成し、既存の完成記録は直接書き換えず、
// 編集用の一時データ（下書き）とスナップショットのみを新たに作る。
function beginEditRecord(rec){
  rec = sanitizeRecord(rec);
  createBackupGeneration("記録修正前の自動バックアップ");
  saveNowImmediate();
  startWizardFromRecord(rec, true);
}

function commitWizardFieldsToDraft(){
  if(!wizardState) return;
  AppData.draft = deepClone(wizardState);
  AppData.draft.updatedAt = nowIso();
}

let fieldDebounceTimer = null;
function onFieldChange(key, value){
  wizardState.fields[key] = value;
  commitWizardFieldsToDraft();
  clearTimeout(fieldDebounceTimer);
  fieldDebounceTimer = setTimeout(()=>{ scheduleSave(); }, DRAFT_DEBOUNCE_MS);
}

function updateDawnArc(){
  const pct = ((wizardState.step-1)/3)*100;
  document.getElementById("dawn-fill").style.width = pct+"%";
  document.getElementById("dawn-sun").style.left = pct+"%";
  document.getElementById("step-progress-label").textContent = `ステップ ${wizardState.step} / 4`;
}

function renderWizardStep(){
  if(!wizardState) { showScreen("home"); return; }
  updateDawnArc();
  const c = document.getElementById("step-container");
  const f = wizardState.fields;
  const prevBtn = document.getElementById("btn-prev");
  const nextBtn = document.getElementById("btn-next");
  prevBtn.style.visibility = wizardState.step===1 ? "hidden" : "visible";
  nextBtn.textContent = wizardState.step===4 ? "宣言して完了する" : "次へ";

  if(wizardState.step===1){
    const moods = ["ワクワク","穏やか","パワフル","前向き","集中","自然体"];
    c.innerHTML = `
      <h2>今日はどんな気持ちで過ごす？</h2>
      <p class="small">今日の気分を、周囲の出来事だけに任せず、自分で選んでみましょう。</p>
      <fieldset class="field" style="margin-top:14px;">
        <legend>気分を1つ選ぶ</legend>
        <div class="chip-group" id="mood-chips" role="radiogroup" aria-label="今日の気分">
          ${moods.map(m=>`<button type="button" class="chip" role="radio" aria-checked="${f.mood===m}" aria-pressed="${f.mood===m}" data-mood="${m}">${m}</button>`).join("")}
        </div>
      </fieldset>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="promise-check" ${f.promise?"checked":""} style="width:20px;height:20px;">
          <span>自分と約束する</span>
        </label>
      </div>
      <div class="field">
        <label class="field-label" for="promise-text">今日、自分の機嫌を守るために意識すること（任意）</label>
        <textarea id="promise-text" maxlength="200" placeholder="例：嫌なことがあっても一呼吸置く">${escapeHtml(f.promiseText)}</textarea>
        <div class="char-count"><span id="promise-text-count">${f.promiseText.length}</span>/200</div>
      </div>
      <div id="step1-guide"></div>
    `;
    c.querySelectorAll("#mood-chips .chip").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        f.mood = btn.dataset.mood;
        c.querySelectorAll("#mood-chips .chip").forEach(b=>{ b.setAttribute("aria-checked", b===btn); b.setAttribute("aria-pressed", b===btn); });
        onFieldChange("mood", f.mood);
      });
    });
    document.getElementById("promise-check").addEventListener("change",(e)=> onFieldChange("promise", e.target.checked));
    const pt = document.getElementById("promise-text");
    pt.addEventListener("input",(e)=>{
      document.getElementById("promise-text-count").textContent = e.target.value.length;
      onFieldChange("promiseText", e.target.value);
    });
  }

  else if(wizardState.step===2){
    c.innerHTML = `
      <h2>いま頭にある不安や心配ごとは何？</h2>
      <p class="small">現実を否定せず、見方を変えるヒントを一緒に探してみましょう。答えたくない場合はスキップできます。</p>
      <div class="field">
        <label class="field-label" for="anxiety-text">不安や心配ごと（任意）</label>
        <textarea id="anxiety-text" maxlength="300" placeholder="例：失敗したらどうしよう">${escapeHtml(f.anxietyText)}</textarea>
        <div class="char-count"><span id="anxiety-text-count">${f.anxietyText.length}</span>/300</div>
        <p class="hint" id="anxiety-privacy-hint"></p>
      </div>
      <div class="btn-row" style="margin-bottom:14px;">
        <button class="btn btn-outline" id="btn-skip-convert">スキップ</button>
        <button class="btn btn-teal" id="btn-do-convert">見方を変えてみる</button>
      </div>
      <div id="convert-candidates"></div>
      <div class="field" id="convert-edit-wrap" style="display:${f.convertedSelected?"block":"none"};">
        <label class="field-label" for="convert-edit">選んだ内容を自分で修正できます</label>
        <textarea id="convert-edit" maxlength="300">${escapeHtml(f.convertedText)}</textarea>
      </div>
    `;
    const hint = document.getElementById("anxiety-privacy-hint");
    hint.textContent = AppData.settings.saveAnxiety ? "この内容は端末内の履歴に保存されます（設定で変更できます）。" : "設定により、この内容は履歴に保存されません。その場での変換にのみ使われます。";

    const ta = document.getElementById("anxiety-text");
    ta.addEventListener("input",(e)=>{
      document.getElementById("anxiety-text-count").textContent = e.target.value.length;
      onFieldChange("anxietyText", e.target.value);
    });
    document.getElementById("btn-skip-convert").addEventListener("click", ()=>{
      f.convertedSkipped = true; f.convertedSelected=""; f.convertedText="";
      onFieldChange("convertedSkipped", true);
      renderWizardStep();
      announce("変換をスキップしました");
    });
    document.getElementById("btn-do-convert").addEventListener("click", ()=>{
      const text = document.getElementById("anxiety-text").value.trim();
      if(!text){ showToast("よろしければ、不安や心配ごとを一言だけ書いてみてください。書かずに進むこともできます。"); return; }
      lastConvCandidates = generateReframeCandidates(text, null);
      renderConvertCandidates();
    });
    if(f.convertedSelected){ renderConvertCandidates(true); }

    const editArea = document.getElementById("convert-edit");
    editArea.addEventListener("input",(e)=> onFieldChange("convertedText", e.target.value));
  }

  else if(wizardState.step===3){
    c.innerHTML = `
      <h2>今日やることを、今すぐ始められる大きさにしよう</h2>
      <div class="field">
        <label class="field-label" for="action-input">今日やりたい行動</label>
        <input type="text" id="action-input" maxlength="60" placeholder="例：資料を作成する" value="${escapeHtml(f.action)}">
      </div>
      <div class="field">
        <label class="field-label" for="babystep-input">最初の小さな一歩</label>
        <textarea id="babystep-input" maxlength="120" placeholder="例：資料ファイルを開いてタイトルを書く">${escapeHtml(f.babyStep)}</textarea>
        <div id="babystep-guide"></div>
      </div>
      <fieldset class="field">
        <legend>小さな一歩の候補</legend>
        <div class="chip-group">
          ${BABY_STEP_SUGGESTIONS.map(s=>`<button type="button" class="chip" data-suggest="${escapeHtml(s)}">${s}</button>`).join("")}
        </div>
      </fieldset>
      <button class="btn btn-outline btn-sm" id="btn-smaller" style="margin-bottom:14px;">さらに小さくする</button>
      <div class="btn-row">
        <div class="field" style="flex:1;">
          <label class="field-label" for="planned-time">実行予定時間</label>
          <input type="time" id="planned-time" value="${escapeHtml(f.plannedTime)}">
        </div>
        <div class="field" style="flex:1;">
          <label class="field-label" for="duration-input">所要時間の目安</label>
          <input type="text" id="duration-input" maxlength="20" placeholder="例：5分" value="${escapeHtml(f.duration)}">
        </div>
      </div>
    `;
    document.getElementById("action-input").addEventListener("input",(e)=> onFieldChange("action", e.target.value));
    const bs = document.getElementById("babystep-input");
    bs.addEventListener("input",(e)=>{
      onFieldChange("babyStep", e.target.value);
      updateBabyStepGuide(e.target.value);
    });
    updateBabyStepGuide(f.babyStep);
    c.querySelectorAll("[data-suggest]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        bs.value = btn.dataset.suggest;
        onFieldChange("babyStep", btn.dataset.suggest);
        updateBabyStepGuide(btn.dataset.suggest);
      });
    });
    document.getElementById("btn-smaller").addEventListener("click", ()=>{
      const shrink = "まずは「" + (bs.value || "始めること") + "」を30秒だけ試してみる";
      bs.value = shrink;
      onFieldChange("babyStep", shrink);
      updateBabyStepGuide(shrink);
    });
    document.getElementById("planned-time").addEventListener("input",(e)=> onFieldChange("plannedTime", e.target.value));
    document.getElementById("duration-input").addEventListener("input",(e)=> onFieldChange("duration", e.target.value));
  }

  else if(wizardState.step===4){
    c.innerHTML = `
      <h2>今日、一番集中して取り組むことは？</h2>
      <div class="field"><label class="field-label" for="focus-task">集中するタスク</label>
        <input type="text" id="focus-task" maxlength="60" value="${escapeHtml(f.focusTask)}"></div>
      <div class="field"><label class="field-label" for="focus-start">開始予定時刻</label>
        <input type="time" id="focus-start" value="${escapeHtml(f.startTime)}"></div>
      <div class="field"><label class="field-label" for="focus-first">最初に行う具体的な行動</label>
        <input type="text" id="focus-first" maxlength="80" value="${escapeHtml(f.firstAction)}"></div>
      <div class="field"><label class="field-label" for="focus-obstacle">集中を妨げそうなもの</label>
        <input type="text" id="focus-obstacle" maxlength="60" value="${escapeHtml(f.obstacle)}"></div>
      <div class="field"><label class="field-label" for="focus-counter">妨げへの対策</label>
        <input type="text" id="focus-counter" maxlength="80" value="${escapeHtml(f.countermeasure)}"></div>
      <div class="card" style="background:var(--sky-teal-bg);border-color:transparent;">
        <p class="small" style="color:var(--sky-teal);margin:0;">もう無理だと感じたときも、方法を小さく変えれば、もう一歩進める場合があります。ただし、体調や安全を最優先にしてください。</p>
      </div>
      <div class="field" style="margin-top:14px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="declare-check" ${f.declared?"checked":""} style="width:20px;height:20px;">
          <span>無理をせず、目の前の一歩に集中する</span>
        </label>
      </div>
    `;
    ["focus-task","focus-start","focus-first","focus-obstacle","focus-counter"].forEach(id=>{
      const map = {"focus-task":"focusTask","focus-start":"startTime","focus-first":"firstAction","focus-obstacle":"obstacle","focus-counter":"countermeasure"};
      document.getElementById(id).addEventListener("input",(e)=> onFieldChange(map[id], e.target.value));
    });
    document.getElementById("declare-check").addEventListener("change",(e)=> onFieldChange("declared", e.target.checked));
  }
}

function renderConvertCandidates(skipRegenerate){
  const f = wizardState.fields;
  const wrap = document.getElementById("convert-candidates");
  const pool = skipRegenerate && lastConvCandidates.length ? lastConvCandidates : (lastConvCandidates.length ? lastConvCandidates : generateReframeCandidates(f.anxietyText||"", null));
  lastConvCandidates = pool;
  wrap.innerHTML = `
    <div class="field-label" style="margin-bottom:8px;">見方の候補（選ぶと下で編集できます）</div>
    ${pool.map(c=>`<button type="button" class="candidate-btn" aria-pressed="${f.convertedSelected===c}" data-c="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}
    <button class="btn btn-outline btn-sm" id="btn-other-candidate" style="margin-top:4px;">別の候補を表示</button>
  `;
  wrap.querySelectorAll(".candidate-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      f.convertedSelected = btn.dataset.c;
      f.convertedText = btn.dataset.c;
      f.convertedSkipped = false;
      onFieldChange("convertedSelected", f.convertedSelected);
      onFieldChange("convertedText", f.convertedText);
      renderWizardStep();
    });
  });
  document.getElementById("btn-other-candidate").addEventListener("click", ()=>{
    const used = new Set(pool);
    const more = generateReframeCandidates(f.anxietyText||"", used);
    lastConvCandidates = more.length ? more : REFRAME_GENERIC;
    renderConvertCandidates(true);
  });
}

function updateBabyStepGuide(val){
  const g = document.getElementById("babystep-guide");
  if(!g) return;
  if(val && val.length > 20){
    g.innerHTML = `<p class="hint">もっと小さくできそうです。30秒から始められる形にしてみましょう。</p>`;
  }else{
    g.innerHTML = "";
  }
}

document.getElementById("btn-wizard-home").addEventListener("click", ()=>{ commitWizardFieldsToDraft(); scheduleSave(); showScreen("home"); });
document.getElementById("btn-wizard-menu").addEventListener("click", ()=>{
  // 「修正を破棄する」は、既存の完成記録を修正中（修正前スナップショットあり）の場合のみ表示する。
  const canDiscardEdit = !!(wizardState && wizardState.editingRecordId && wizardState.preEditSnapshot);
  openModal(`
    <h2>メニュー</h2>
    <div class="stack">
      <button class="btn btn-outline" id="menu-restart">最初からやり直す</button>
      ${canDiscardEdit ? `<button class="btn btn-outline" id="menu-discard-edit">修正を破棄して元の記録に戻す</button>` : ""}
      <button class="btn btn-outline" id="menu-close">閉じる</button>
    </div>
  `,{center:true});
  document.getElementById("menu-restart").onclick = async ()=>{
    closeModal();
    const ok = await confirmDialog("最初からやり直しますか？","現在の入力内容は削除され、最初のステップからやり直します。","やり直す",{danger:true});
    if(ok){
      wizardState = { date: todayLocalStr(), step:1, fields:newWizardFields(), editingRecordId: wizardState.editingRecordId, createdAt: nowIso(), preEditSnapshot: wizardState.preEditSnapshot||null };
      commitWizardFieldsToDraft(); scheduleSave();
      renderWizardStep();
    }
  };
  if(canDiscardEdit){
    document.getElementById("menu-discard-edit").onclick = async ()=>{
      closeModal();
      const ok = await confirmDialog("修正を破棄しますか？","編集中の内容は削除され、保存済みの記録に戻します。","破棄する",{danger:true});
      if(ok){ discardEditAndRestore(); }
    };
  }
  document.getElementById("menu-close").onclick = closeModal;
});

// 修正を破棄し、修正開始前に保持していたスナップショットへ記録を戻す。
// 編集用の一時データ（下書き）のみを削除し、保存済み記録そのものは
// 修正完了（finishWizard）まで書き換えていないため、ここでの復元は安全に行える。
function discardEditAndRestore(){
  if(!wizardState || !wizardState.preEditSnapshot){ AppData.draft = null; wizardState = null; showScreen("home"); return; }
  const snapshot = deepClone(wizardState.preEditSnapshot);
  const idx = AppData.records.findIndex(r=>r.id===snapshot.id);
  if(idx>=0){ AppData.records[idx] = snapshot; }
  const recId = snapshot.id;
  const recDate = snapshot.date;
  AppData.draft = null;
  wizardState = null;
  recomputeAggregates();
  saveNowImmediate();
  showToast("修正を破棄し、元の記録に戻しました");
  openRecordConfirm(recId, recDate===todayLocalStr() ? "today" : "history");
}

document.getElementById("btn-prev").addEventListener("click", ()=>{
  // 前へボタンも、ハードウェア戻る操作と同じ経路（history.back）に統一する。
  // 実際のステップの巻き戻しはpopstateハンドラ側で行う。
  if(wizardState && wizardState.step>1){
    commitWizardFieldsToDraft(); scheduleSave();
    try{ history.back(); }catch(e){ wizardState.step--; renderWizardStep(); }
  }
});
document.getElementById("btn-next").addEventListener("click", ()=>{
  const f = wizardState.fields;
  if(wizardState.step===1){
    if(!f.mood || !f.promise){
      showToast("気分の選択と「自分と約束する」のチェックをお願いします。無理のない範囲で大丈夫です。");
      return;
    }
  }
  if(wizardState.step<4){
    wizardState.step++;
    commitWizardFieldsToDraft(); scheduleSave();
    try{ history.pushState({screen:"wizard", step:wizardState.step}, "", "#wizard-step"+wizardState.step); }catch(e){}
    renderWizardStep();
  }else{
    finishWizard();
  }
});

function finishWizard(){
  const f = wizardState.fields;
  const date = wizardState.date;
  let rec = wizardState.editingRecordId ? AppData.records.find(r=>r.id===wizardState.editingRecordId) : null;
  // editingRecordIdが無い場合でも、同じ日付の記録（削除済み含む）が既に存在すれば
  // 新規作成せずそちらを更新することで、同日に複数の記録が重複作成されるのを防ぐ。
  if(!rec){ rec = AppData.records.find(r=>r.date===date); }
  const isNew = !rec;
  // 既に完了済みだった記録を修正している場合は、完了画面を経由せず
  // 保存後すぐに「内容確認」画面へ進む（修正フローとして扱う）。
  const wasCompletedBefore = rec ? !!rec.completed : false;
  if(!rec){ rec = { id: uid(), date: date, createdAt: nowIso() }; AppData.records.push(rec); }
  rec.updatedAt = nowIso();
  // 初回完了時のみ完了日時を新規に記録し、修正時は元の完了日時を保持する。
  if(!rec.completedAt){ rec.completedAt = nowIso(); }
  rec.completed = true;
  rec.dataFormatVersion = DATA_FORMAT_VERSION;
  rec.deleted = false;
  rec.currentStep = 4;
  rec.draftStatus = "complete";
  rec.step1 = { mood:f.mood, promise:f.promise, promiseText:f.promiseText };
  rec.step2 = AppData.settings.saveAnxiety
    ? { anxietyText:f.anxietyText, convertedText:f.convertedText, convertedSelected:f.convertedSelected, skipped:f.convertedSkipped }
    : { anxietyText:"", convertedText:f.convertedText, convertedSelected:f.convertedSelected, skipped:f.convertedSkipped };
  rec.step3 = { action:f.action, babyStep:f.babyStep, plannedTime:f.plannedTime, duration:f.duration };
  rec.step4 = { focusTask:f.focusTask, startTime:f.startTime, firstAction:f.firstAction, obstacle:f.obstacle, countermeasure:f.countermeasure, declared:f.declared };

  const wasFirstToday = isNew;
  AppData.draft = null;
  recomputeAggregates();

  if(wasFirstToday){ createBackupGeneration("1日の初回完了時の自動バックアップ"); }
  saveNowImmediate();

  if(AppData.settings.vibrationEnabled && navigator.vibrate){ try{ navigator.vibrate([30,40,30]); }catch(e){} }

  const recId = rec.id;
  const recDate = rec.date;
  wizardState = null;

  if(wasCompletedBefore){
    showToast("修正内容を保存しました");
    openRecordConfirm(recId, recDate===todayLocalStr() ? "today" : "history");
    announce("記録を修正して保存しました");
  }else{
    renderCompleteScreen(rec);
    showScreen("complete");
    announce("今日のマインドセットが完了しました");
  }
}

/* =========================================================
   12. 完了画面
========================================================= */
function renderCompleteScreen(rec){
  rec = sanitizeRecord(rec);
  const d = rec.completedAt ? new Date(rec.completedAt) : new Date();
  document.getElementById("complete-datetime").textContent = `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const body = document.getElementById("complete-body");
  body.innerHTML = `
    <div class="card">
      <p class="small" style="margin:0;">今日の記録を保存しました。内容の確認や、Obsidian用のコピー・共有は「今日の内容を確認」から行えます。</p>
    </div>
  `;
}
document.getElementById("btn-complete-confirm").addEventListener("click", ()=>{
  const rec = findTodayRecord();
  if(rec) openRecordConfirm(rec.id, "today");
  else showScreen("home");
});
document.getElementById("btn-complete-home").addEventListener("click", ()=> showScreen("home"));

/* =========================================================
   12-B. 今日の内容確認 / 記録の詳細（読み取り専用の確認画面）
   ・ここを開くだけでは記録・更新日時・ストリーク・バックアップ世代を変更しない。
   ・source==="today" の場合はホームからの「今日の内容確認」、
     source==="history" の場合は履歴からの「記録の詳細」として振る舞う。
========================================================= */
let confirmRecordId = null;
let confirmSource = "history";

function openRecordConfirm(id, source){
  confirmRecordId = id;
  confirmSource = source || "history";
  renderRecordConfirm();
  showScreen("detail");
}

function renderRecordConfirm(){
  const rawRec = AppData.records.find(r=>r.id===confirmRecordId);
  if(!rawRec){ showScreen(confirmSource==="today" ? "home" : "history"); return; }
  // 表示用に複製を取り、確認画面の描画処理が誤って元データへ触れることを防ぐ。
  const rec = sanitizeRecord(deepClone(rawRec));

  document.getElementById("detail-title").textContent = confirmSource==="today" ? "今日の内容確認" : "記録の詳細";
  const backBtn = document.getElementById("btn-detail-back");
  backBtn.setAttribute("aria-label", confirmSource==="today" ? "ホームへ戻る" : "履歴へ戻る");

  const completedAtStr = rec.completedAt ? new Date(rec.completedAt).toLocaleString("ja-JP") : "未完了";
  const showAnxiety = AppData.settings.saveAnxiety && !!rec.step2.anxietyText;

  const parts = [];
  parts.push(`<div class="section-title">日付</div><p>${rec.date}</p>`);
  parts.push(`<div class="section-title">アプリ名</div><p>${APP_NAME}</p>`);
  parts.push(`<div class="section-title">完了日時</div><p>${completedAtStr}</p>`);
  parts.push(`<div class="divider"></div>`);
  parts.push(`<div class="section-title">今日選んだ気分</div><p>${escapeHtml(rec.step1.mood)||"未入力"}</p>`);
  parts.push(`<div class="section-title">ご機嫌を守るための約束</div><p>${escapeHtml(rec.step1.promiseText)||"未入力"}</p>`);
  if(showAnxiety){ parts.push(`<div class="section-title">不安や心配事</div><p>${escapeHtml(rec.step2.anxietyText)}</p>`); }
  if(rec.step2.convertedText){ parts.push(`<div class="section-title">見方を変えた言葉</div><p>${escapeHtml(rec.step2.convertedText)}</p>`); }
  parts.push(`<div class="section-title">今日やりたい行動</div><p>${escapeHtml(rec.step3.action)||"未入力"}</p>`);
  parts.push(`<div class="section-title">最初の小さな一歩</div><p>${escapeHtml(rec.step3.babyStep)||"未入力"}</p>`);
  if(rec.step3.plannedTime){ parts.push(`<div class="section-title">実行予定時間</div><p>${escapeHtml(rec.step3.plannedTime)}</p>`); }
  if(rec.step3.duration){ parts.push(`<div class="section-title">所要時間</div><p>${escapeHtml(rec.step3.duration)}</p>`); }
  parts.push(`<div class="section-title">集中するタスク</div><p>${escapeHtml(rec.step4.focusTask)||"未入力"}</p>`);
  if(rec.step4.startTime){ parts.push(`<div class="section-title">開始予定時刻</div><p>${escapeHtml(rec.step4.startTime)}</p>`); }
  parts.push(`<div class="section-title">最初に行う具体的な行動</div><p>${escapeHtml(rec.step4.firstAction)||"未入力"}</p>`);
  if(rec.step4.obstacle){ parts.push(`<div class="section-title">集中を妨げそうなもの</div><p>${escapeHtml(rec.step4.obstacle)}</p>`); }
  if(rec.step4.countermeasure){ parts.push(`<div class="section-title">妨げへの対策</div><p>${escapeHtml(rec.step4.countermeasure)}</p>`); }
  if(rec.step4.declared){ parts.push(`<div class="section-title">集中宣言</div><p>無理をせず、目の前の一歩に集中する</p>`); }

  document.getElementById("detail-body").innerHTML = `<div class="card">${parts.join("")}</div>`;
  renderDetailActions(rec, confirmSource);
}

function renderDetailActions(rec, source){
  const wrap = document.getElementById("detail-actions");
  const editLabel = source==="today" ? "今日の内容を修正" : "この記録を修正";
  let html = `
    <button class="btn btn-outline" id="btn-detail-copy">Obsidian用にコピー</button>
    <button class="btn btn-outline" id="btn-detail-share">共有</button>
    <button class="btn btn-secondary" id="btn-detail-edit-dyn">${editLabel}</button>
  `;
  if(source==="history"){
    html += `
      <button class="btn btn-outline" id="btn-detail-duplicate-dyn">この記録を複製</button>
      <button class="btn btn-danger" id="btn-detail-delete-dyn">ゴミ箱へ移動</button>
      <button class="btn btn-text" id="btn-detail-tohistory">履歴へ戻る</button>
    `;
  }else{
    html += `<button class="btn btn-text" id="btn-detail-tohome">ホームへ戻る</button>`;
  }
  wrap.innerHTML = html;

  document.getElementById("btn-detail-copy").addEventListener("click", ()=> openObsidianCopyFlow(rec, "copy"));
  document.getElementById("btn-detail-share").addEventListener("click", ()=> openObsidianCopyFlow(rec, "share"));
  document.getElementById("btn-detail-edit-dyn").addEventListener("click", ()=> beginEditRecord(rec));
  if(source==="history"){
    document.getElementById("btn-detail-duplicate-dyn").addEventListener("click", ()=> duplicateRecord(rec));
    document.getElementById("btn-detail-delete-dyn").addEventListener("click", ()=> deleteRecordToTrash(rec));
    document.getElementById("btn-detail-tohistory").addEventListener("click", ()=> showScreen("history"));
  }else{
    document.getElementById("btn-detail-tohome").addEventListener("click", ()=> showScreen("home"));
  }
}

document.getElementById("btn-detail-back").addEventListener("click", ()=>{
  showScreen(confirmSource==="today" ? "home" : "history");
});

function duplicateRecord(rec){
  const copy = deepClone(rec);
  copy.id = uid();
  copy.date = todayLocalStr();
  copy.createdAt = nowIso(); copy.updatedAt = nowIso(); copy.completedAt = null; copy.completed = false;
  const existingToday = findTodayRecord();
  if(existingToday){ showToast("今日はすでに記録があります。複製は下書きとして保存されます。"); }
  AppData.records.push(copy);
  recomputeAggregates();
  saveNowImmediate();
  showToast("記録を複製しました");
  openRecordConfirm(copy.id, "history");
}

function deleteRecordToTrash(rec){
  confirmDialog("この記録をゴミ箱へ移動しますか？","ゴミ箱からはいつでも復元できます。","ゴミ箱へ移動").then(ok=>{
    if(!ok) return;
    const r = AppData.records.find(x=>x.id===rec.id);
    if(!r) return;
    r.deleted = true; r.deletedAt = nowIso();
    recomputeAggregates();
    saveNowImmediate();
    showScreen("history");
    showToast("ゴミ箱へ移動しました", "元に戻す", ()=>{
      r.deleted = false; r.deletedAt = null; recomputeAggregates(); saveNowImmediate(); renderHistory();
    }, 8000);
  });
}

/* =========================================================
   12-C. Obsidian用Markdownコピー / 共有
   ・先頭は必ず「# YYYY-MM-DD MindSwitch」（対象記録の日付。端末の現在日付ではない）。
   ・不安・心配事は初期状態では含めない。含める場合のみ確認のうえ含める。
   ・Clipboard APIが使えない場合は手動コピー用のモーダルを表示する。
========================================================= */
function buildObsidianMarkdown(rec, opts){
  opts = opts || {};
  const includeAnxiety = !!opts.includeAnxiety;
  rec = sanitizeRecord(rec);
  const lines = [`# ${rec.date} ${APP_NAME}`];
  function addSection(title, value){
    if(value===undefined || value===null) return;
    value = String(value).trim();
    if(!value) return;
    lines.push("");
    lines.push(`## ${title}`);
    lines.push(value);
  }
  addSection("今日の気分", rec.step1.mood);
  addSection("ご機嫌を守るための約束", rec.step1.promiseText);
  if(includeAnxiety && AppData.settings.saveAnxiety){ addSection("不安・心配事", rec.step2.anxietyText); }
  addSection("見方を変えた言葉", rec.step2.convertedText);
  addSection("今日やりたいこと", rec.step3.action);
  addSection("最初の小さな一歩", rec.step3.babyStep);
  addSection("実行予定", rec.step3.plannedTime);
  addSection("所要時間", rec.step3.duration);
  addSection("今日集中すること", rec.step4.focusTask);
  addSection("開始予定時刻", rec.step4.startTime);
  addSection("最初に行う具体的な行動", rec.step4.firstAction);
  addSection("集中を妨げそうなもの", rec.step4.obstacle);
  addSection("妨げへの対策", rec.step4.countermeasure);
  if(rec.step4.declared){ addSection("今日の宣言", "無理をせず、目の前の一歩に集中する"); }
  return lines.join("\n").trim() + "\n";
}

function openObsidianCopyFlow(rec, mode){
  rec = sanitizeRecord(rec);
  const hasAnxiety = AppData.settings.saveAnxiety && !!(rec.step2 && rec.step2.anxietyText && rec.step2.anxietyText.trim());
  if(hasAnxiety){
    openModal(`
      <h2>不安・心配事を含めますか？</h2>
      <p class="small">不安や心配ごとは個人的な内容を含む可能性があります。含めない場合でも、日付・アプリ名や前向きな言葉はコピー・共有されます。</p>
      <div class="stack">
        <button class="btn btn-secondary" id="anx-exclude">含めない（推奨）</button>
        <button class="btn btn-outline" id="anx-include">含める</button>
      </div>
    `, {center:true});
    document.getElementById("anx-exclude").onclick = ()=>{ closeModal(); finalizeObsidianAction(rec, mode, false); };
    document.getElementById("anx-include").onclick = ()=>{ closeModal(); finalizeObsidianAction(rec, mode, true); };
  }else{
    finalizeObsidianAction(rec, mode, false);
  }
}

function finalizeObsidianAction(rec, mode, includeAnxiety){
  const md = buildObsidianMarkdown(rec, {includeAnxiety});
  if(mode==="share"){
    if(navigator.share){
      navigator.share({text: md, title: APP_NAME}).catch(()=>{ /* キャンセルも含む。何もしない */ });
    }else{
      copyMarkdownToClipboard(md);
    }
  }else{
    copyMarkdownToClipboard(md);
  }
}

function copyMarkdownToClipboard(md){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(md)
      .then(()=> showToast("Obsidian用の記録をコピーしました"))
      .catch(()=> manualCopyFallback(md));
  }else{
    manualCopyFallback(md);
  }
}

function manualCopyFallback(md){
  try{
    const ta = document.createElement("textarea");
    ta.value = md; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if(ok){ showToast("Obsidian用の記録をコピーしました"); return; }
  }catch(e){ /* 以降のモーダル表示にフォールバック */ }
  showManualCopyModal(md);
}

function showManualCopyModal(md){
  openModal(`
    <h2>コピーできませんでした</h2>
    <p class="small">コピーできませんでした。文章を表示するので、長押ししてコピーしてください</p>
    <textarea id="manual-copy-text" readonly style="min-height:220px;">${escapeHtml(md)}</textarea>
    <button class="btn btn-primary" id="manual-copy-close" style="margin-top:12px;">閉じる</button>
  `, {center:true});
  const ta = document.getElementById("manual-copy-text");
  if(ta){ ta.focus(); ta.select(); }
  document.getElementById("manual-copy-close").onclick = closeModal;
}

/* =========================================================
   13. 履歴画面
========================================================= */
let historyFilterMood = null;
let historyShowCalendar = false;
function renderHistory(){
  const moods = ["ワクワク","穏やか","パワフル","前向き","集中","自然体"];
  const filterWrap = document.getElementById("history-mood-filter");
  filterWrap.innerHTML = `<button data-m="" aria-pressed="${!historyFilterMood}">すべて</button>` +
    moods.map(m=>`<button data-m="${m}" aria-pressed="${historyFilterMood===m}">${m}</button>`).join("");
  filterWrap.querySelectorAll("button").forEach(b=>{
    b.addEventListener("click", ()=>{ historyFilterMood = b.dataset.m || null; renderHistory(); });
  });

  document.getElementById("history-calendar-wrap").style.display = historyShowCalendar ? "block":"none";
  if(historyShowCalendar) renderHistoryCalendar();

  const search = document.getElementById("history-search").value.trim().toLowerCase();
  // 表示前に全件を正規化し、欠損したstep1〜4によるクラッシュを防ぐ
  let list = getActiveRecords().map(sanitizeRecord).sort((a,b)=> b.date.localeCompare(a.date));
  if(historyFilterMood) list = list.filter(r=> r.step1?.mood===historyFilterMood);
  if(search){
    list = list.filter(r=>{
      const hay = [r.step4?.focusTask, r.step3?.action, r.step3?.babyStep, r.step1?.promiseText].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });
  }
  const listEl = document.getElementById("history-list");
  if(!list.length){
    listEl.innerHTML = `<div class="empty-state">まだ記録がありません。今日のマインドセットから始めてみましょう。</div>`;
    return;
  }
  listEl.innerHTML = list.map(r=>`
    <button class="history-item" data-id="${r.id}">
      <span>
        <strong>${r.date}</strong><br>
        <span class="meta">${escapeHtml(r.step1?.mood||"")} ${r.step4?.focusTask? "・"+escapeHtml(r.step4.focusTask):""}</span>
      </span>
      <span class="badge ${r.completed? "badge-done":"badge-draft"}">${r.completed? "完了":"下書き"}</span>
    </button>
  `).join("");
  listEl.querySelectorAll(".history-item").forEach(btn=>{
    btn.addEventListener("click", ()=> openDetail(btn.dataset.id));
  });
}
function renderHistoryCalendar(){
  const wrap = document.getElementById("history-calendar-wrap");
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const doneDates = new Set(getActiveRecords().filter(r=>r.completed).map(r=>r.date));
  const weekStart = AppData.settings.weekStart || 0;
  const dowLabels = weekStart===1 ? ["月","火","水","木","金","土","日"] : ["日","月","火","水","木","金","土"];
  const firstDay = new Date(y,m,1);
  let startOffset = (firstDay.getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(y,m+1,0).getDate();
  let cells = "";
  for(let i=0;i<startOffset;i++) cells += `<div class="cell"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${y}-${pad2(m+1)}-${pad2(d)}`;
    const done = doneDates.has(dateStr);
    const isToday = dateStr === todayLocalStr();
    cells += `<div class="cell ${done?"done":""} ${isToday?"today":""}">${d}</div>`;
  }
  wrap.innerHTML = `<div class="section-title">${y}年${m+1}月</div><div class="cal-grid">${dowLabels.map(l=>`<div class="dow">${l}</div>`).join("")}${cells}</div>`;
}
document.getElementById("history-search").addEventListener("input", renderHistory);
document.getElementById("btn-history-back").addEventListener("click", ()=> showScreen("home"));
document.getElementById("btn-history-calendar").addEventListener("click", ()=>{ historyShowCalendar = !historyShowCalendar; renderHistory(); });
document.getElementById("btn-open-trash").addEventListener("click", ()=> showScreen("trash"));

/* =========================================================
   14. 詳細画面（履歴からは読み取り専用の確認画面として開く）
========================================================= */
function openDetail(id){
  openRecordConfirm(id, "history");
}

/* =========================================================
   15. ゴミ箱
========================================================= */
function renderTrash(){
  const list = AppData.records.filter(r=>r.deleted).map(sanitizeRecord).sort((a,b)=> new Date(b.deletedAt)-new Date(a.deletedAt));
  const el = document.getElementById("trash-list");
  if(!list.length){ el.innerHTML = `<div class="empty-state">ゴミ箱は空です。</div>`; return; }
  el.innerHTML = list.map(r=>`
    <div class="history-item" style="cursor:default;">
      <span><strong>${r.date}</strong><br><span class="meta">${escapeHtml(r.step1?.mood||"")}</span></span>
      <span class="btn-row" style="width:auto;">
        <button class="btn btn-outline btn-sm" data-restore="${r.id}">復元</button>
        <button class="btn btn-danger btn-sm" data-purge="${r.id}">完全削除</button>
      </span>
    </div>
  `).join("");
  el.querySelectorAll("[data-restore]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const rec = AppData.records.find(r=>r.id===b.dataset.restore);
      rec.deleted = false; rec.deletedAt = null;
      recomputeAggregates(); saveNowImmediate(); renderTrash();
      showToast("復元しました");
    });
  });
  el.querySelectorAll("[data-purge]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      const ok = await confirmDialog("この操作は元に戻せません。完全に削除しますか？","記録は完全に削除され、復元できなくなります。","完全に削除する",{danger:true});
      if(!ok) return;
      AppData.records = AppData.records.filter(r=>r.id!==b.dataset.purge);
      saveNowImmediate(); renderTrash();
      showToast("完全に削除しました");
    });
  });
}
document.getElementById("btn-trash-back").addEventListener("click", ()=> showScreen("history"));

/* =========================================================
   16. 設定画面
========================================================= */
function renderSettings(){
  const s = AppData.settings;
  document.getElementById("set-nickname").value = s.nickname || "";
  setPillGroup("set-theme", s.theme);
  setPillGroup("set-fontsize", s.fontSize);
  setPillGroup("set-weekstart", String(s.weekStart));
  document.getElementById("set-notif-enabled").checked = !!s.notifEnabled;
  document.getElementById("set-notif-time").value = s.notifTime || "07:00";
  document.getElementById("set-save-anxiety").checked = !!s.saveAnxiety;
  document.getElementById("set-sound").checked = !!s.soundEnabled;
  document.getElementById("set-vibration").checked = !!s.vibrationEnabled;

  const noteEl = document.getElementById("notif-support-note");
  if(!("Notification" in window)){
    noteEl.innerHTML = "この端末・ブラウザは通知に対応していません。時間になったらお知らせしたい場合は、スマートフォン標準のアラーム機能をご利用ください。";
  }else{
    noteEl.innerHTML = "<strong>ご注意：</strong>この通知は、アプリを開いている（起動中の）間だけ働く仕組みです。<strong>アプリを完全に閉じている間は通知が届きません。</strong>確実に起きたい時刻がある場合は、必ずスマートフォン標準のアラーム機能も合わせてご利用ください。";
  }

  renderDataProtectionCard();
}
function setPillGroup(id, value){
  document.querySelectorAll("#"+id+" button").forEach(b=> b.setAttribute("aria-pressed", b.dataset.v===String(value)));
}
document.querySelectorAll("#set-theme button").forEach(b=> b.addEventListener("click", ()=>{ AppData.settings.theme=b.dataset.v; applyTheme(); setPillGroup("set-theme",b.dataset.v); scheduleSave(); }));
document.querySelectorAll("#set-fontsize button").forEach(b=> b.addEventListener("click", ()=>{ AppData.settings.fontSize=b.dataset.v; applyFontSize(); setPillGroup("set-fontsize",b.dataset.v); scheduleSave(); }));
document.querySelectorAll("#set-weekstart button").forEach(b=> b.addEventListener("click", ()=>{ AppData.settings.weekStart=Number(b.dataset.v); setPillGroup("set-weekstart",b.dataset.v); scheduleSave(); }));
document.getElementById("set-nickname").addEventListener("input",(e)=>{ AppData.settings.nickname=e.target.value; scheduleSave(); });
document.getElementById("set-notif-enabled").addEventListener("change", async (e)=>{
  AppData.settings.notifEnabled = e.target.checked;
  if(e.target.checked){ await requestNotifPermissionIfNeeded(); setupNotifTimer(); }
  else{ clearNotifTimer(); }
  scheduleSave();
});
document.getElementById("set-notif-time").addEventListener("change",(e)=>{ AppData.settings.notifTime=e.target.value; setupNotifTimer(); scheduleSave(); });
document.getElementById("set-save-anxiety").addEventListener("change",(e)=>{ AppData.settings.saveAnxiety=e.target.checked; scheduleSave(); });
document.getElementById("set-sound").addEventListener("change",(e)=>{ AppData.settings.soundEnabled=e.target.checked; scheduleSave(); });
document.getElementById("set-vibration").addEventListener("change",(e)=>{ AppData.settings.vibrationEnabled=e.target.checked; scheduleSave(); });
document.getElementById("btn-settings-back").addEventListener("click", ()=> showScreen("home"));

function applyTheme(){
  const t = AppData.settings.theme;
  let effective = t;
  if(t==="system"){ effective = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark":"light"; }
  document.documentElement.setAttribute("data-theme", effective==="dark" ? "dark":"light");
}
function applyFontSize(){
  const map = {small:0.9, standard:1, large:1.15, xlarge:1.35};
  document.documentElement.style.setProperty("--font-scale", map[AppData.settings.fontSize]||1);
}
if(window.matchMedia){
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", ()=>{ if(AppData.settings && AppData.settings.theme==="system") applyTheme(); });
}

/* ---- データ保護カード ---- */
async function renderDataProtectionCard(){
  const card = document.getElementById("data-protection-card");
  const idbOk = Storage.idbAvailable;
  const lsOk = Storage.lsAvailable;
  let persisted = "確認できません";
  try{
    if(navigator.storage && navigator.storage.persisted){ persisted = (await navigator.storage.persisted()) ? "許可されています" : "未許可"; }
  }catch(e){}
  let usage = "不明";
  try{
    if(navigator.storage && navigator.storage.estimate){
      const est = await navigator.storage.estimate();
      if(est.usage!=null && est.quota!=null){ usage = `${(est.usage/1024).toFixed(0)}KB / ${(est.quota/1024/1024).toFixed(0)}MB`; }
    }
  }catch(e){}
  const lastSaved = AppData.updatedAt ? new Date(AppData.updatedAt).toLocaleString("ja-JP") : "-";
  const lastBackup = AppData.meta.lastBackupAt ? new Date(AppData.meta.lastBackupAt).toLocaleString("ja-JP") : "まだありません";

  card.innerHTML = `
    <p class="small">この端末に、二重の方法でデータを保存しています。片方が使えない・壊れている場合でも、もう片方から復旧を試みます。</p>
    <div class="settings-row"><span>保存方式A（IndexedDB）</span><span>${idbOk? "利用可能":"利用不可"}</span></div>
    <div class="settings-row"><span>保存方式B（localStorage）</span><span>${lsOk? "利用可能":"利用不可"}</span></div>
    <div class="settings-row"><span>最終保存日時</span><span>${lastSaved}</span></div>
    <div class="settings-row"><span>最終バックアップ</span><span>${lastBackup}</span></div>
    <div class="settings-row"><span>保存されている記録数</span><span>${AppData.records.filter(r=>!r.deleted).length}件</span></div>
    <div class="settings-row"><span>バックアップ世代数</span><span>${AppData.backups.length} / ${MAX_BACKUP_GENERATIONS}</span></div>
    <div class="settings-row"><span>永続ストレージ</span><span>${persisted}</span></div>
    <div class="settings-row"><span>ストレージ使用量</span><span>${usage}</span></div>
    <p class="small" style="margin-top:8px;">「絶対にデータが消えない」ことは技術的に保証できません。大切な記録は、時々エクスポートして端末外にも保管することをおすすめします。</p>
  `;
}

document.getElementById("btn-save-now").addEventListener("click", async ()=>{ await saveNowImmediate(); showToast("保存しました"); });
document.getElementById("btn-backup-now").addEventListener("click", async ()=>{ createBackupGeneration("手動バックアップ"); await saveNowImmediate(); renderDataProtectionCard(); showToast("バックアップを作成しました"); });
document.getElementById("btn-export").addEventListener("click", exportJson);
document.getElementById("btn-import").addEventListener("click", ()=> document.getElementById("file-import").click());
document.getElementById("file-import").addEventListener("change", (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    let obj;
    try{ obj = JSON.parse(reader.result); }
    catch(err){ showToast("ファイルの読み込みに失敗しました。壊れているか、JSON形式ではない可能性があります。"); e.target.value=""; return; }
    const errors = validateImportFile(obj);
    if(errors.length){ showToast(errors[0]); e.target.value=""; return; }
    openModal(`
      <h2>読み込み方法を選択</h2>
      <p class="small">「${escapeHtml(file.name)}」を読み込みます。既存データはインポート前に自動でバックアップされます。</p>
      <div class="stack">
        <button class="btn btn-outline" id="import-merge">追加・統合する（推奨）</button>
        <button class="btn btn-danger" id="import-overwrite">上書きする</button>
        <button class="btn btn-text" id="import-cancel">キャンセル</button>
      </div>
    `,{center:true});
    document.getElementById("import-cancel").onclick = ()=>{ closeModal(); e.target.value=""; };
    const doImport = (mode)=>{
      closeModal();
      const result = importJsonObject(obj, mode);
      e.target.value = "";
      if(result.ok){
        renderSettings();
        showToast(`追加:${result.added} 更新:${result.updated} 無視:${result.ignored} エラー:${result.errorCount}`);
      }else{
        showToast(result.errors[0]);
      }
    };
    document.getElementById("import-merge").onclick = ()=> doImport("merge");
    document.getElementById("import-overwrite").onclick = ()=> doImport("overwrite");
  };
  reader.onerror = ()=> showToast("ファイルの読み込み中にエラーが発生しました。");
  reader.readAsText(file);
});

document.getElementById("btn-backup-list").addEventListener("click", ()=>{
  const list = AppData.backups.slice().sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  openModal(`
    <h2>バックアップ一覧</h2>
    ${list.length? "" : `<p class="small">バックアップはまだありません。</p>`}
    <div class="stack">
      ${list.map(bk=>`
        <div class="card" style="margin-bottom:0;">
          <div style="font-weight:700;">${new Date(bk.createdAt).toLocaleString("ja-JP")}</div>
          <div class="small">${escapeHtml(bk.label)} ・ 記録${bk.recordCount}件</div>
          <button class="btn btn-outline btn-sm" style="margin-top:8px;" data-restore-bk="${bk.id}">この時点へ復元</button>
        </div>
      `).join("")}
    </div>
    <button class="btn btn-text" id="bk-close" style="margin-top:10px;">閉じる</button>
  `,{center:true});
  document.getElementById("bk-close").onclick = closeModal;
  document.querySelectorAll("[data-restore-bk]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      const bk = AppData.backups.find(x=>x.id===b.dataset.restoreBk);
      closeModal();
      const ok = await confirmDialog(
        "このバックアップへ復元しますか？",
        `${new Date(bk.createdAt).toLocaleString("ja-JP")} 時点（記録${bk.recordCount}件）に復元します。現在のデータは復元前に自動でバックアップされます。`,
        "復元する", {danger:true}
      );
      if(!ok) return;
      createBackupGeneration("復元前の自動バックアップ");
      const restored = deepClone(bk.snapshot);
      const keepBackups = AppData.backups;
      AppData = migrateIfNeeded(restored);
      AppData.backups = keepBackups;
      recomputeAggregates();
      await saveNowImmediate();
      renderSettings();
      showToast("復元しました");
    });
  });
});

document.getElementById("btn-integrity").addEventListener("click", async ()=>{
  const idbData = Storage.idbAvailable ? await Storage.idbGet("appData").catch(()=>undefined) : undefined;
  const lsData = Storage.lsAvailable ? Storage.lsGet(LS_KEY) : undefined;
  const idbValid = idbData ? verifyChecksum(idbData) : null;
  const lsValid = lsData ? verifyChecksum(lsData) : null;
  const recordIssues = AppData.records.filter(r=> !r.date || !r.id).length;
  openModal(`
    <h2>データ整合性の確認結果</h2>
    <div class="stack">
      <div class="card" style="margin-bottom:0;">
        <div class="settings-row"><span>IndexedDB</span><span>${idbValid===null?"データなし":idbValid?"正常":"異常の可能性"}</span></div>
        <div class="settings-row"><span>localStorage</span><span>${lsValid===null?"データなし":lsValid?"正常":"異常の可能性"}</span></div>
        <div class="settings-row"><span>不完全な記録</span><span>${recordIssues}件</span></div>
      </div>
    </div>
    <button class="btn btn-primary" id="integrity-close" style="margin-top:12px;">閉じる</button>
  `,{center:true});
  document.getElementById("integrity-close").onclick = closeModal;
});

document.getElementById("btn-repair").addEventListener("click", async ()=>{
  const ok = await confirmDialog("データを修復しますか？","修復前に自動でバックアップを作成します。日付やIDが欠けている記録を安全な形に補正します。","修復する");
  if(!ok) return;
  createBackupGeneration("修復前の自動バックアップ");
  let fixed = 0;
  AppData.records.forEach(r=>{
    if(!r.id){ r.id = uid(); fixed++; }
    if(!r.date){ r.date = todayLocalStr(); fixed++; }
    if(!r.step1) r.step1 = {mood:"",promise:false,promiseText:""};
    if(!r.step2) r.step2 = {anxietyText:"",convertedText:"",convertedSelected:"",skipped:false};
    if(!r.step3) r.step3 = {action:"",babyStep:"",plannedTime:"",duration:""};
    if(!r.step4) r.step4 = {focusTask:"",startTime:"",firstAction:"",obstacle:"",countermeasure:""};
  });
  const beforeDup = AppData.records.length;
  const seen = new Map();
  AppData.records = AppData.records.filter(r=>{
    if(!r.completed) return true;
    const key = r.date;
    if(seen.has(key)){
      const other = seen.get(key);
      return new Date(r.updatedAt||0) >= new Date(other.updatedAt||0) ? true : false;
    }
    seen.set(key, r);
    return true;
  });
  recomputeAggregates();
  await saveNowImmediate();
  renderSettings();
  showToast(`修復が完了しました（補正 ${fixed}件 / 重複整理 ${beforeDup-AppData.records.length}件）`);
});

document.getElementById("btn-persist-storage").addEventListener("click", async ()=>{
  if(!(navigator.storage && navigator.storage.persist)){ showToast("この端末では永続ストレージの要求に対応していません。"); return; }
  try{
    const granted = await navigator.storage.persist();
    showToast(granted ? "永続ストレージが許可されました" : "許可されませんでした（端末やブラウザの設定によります）");
    renderDataProtectionCard();
  }catch(e){ showToast("要求中にエラーが発生しました。"); }
});

document.getElementById("btn-privacy-info").addEventListener("click", ()=>{
  openModal(`
    <h2>プライバシーについて</h2>
    <p class="small">MindSwitchの入力内容は、原則としてこの端末の中だけに保存され、外部のサーバーには送信されません。<br><br>
    不安・心配ごとの入力は、設定でオフにすると履歴に保存されず、その場での見方の変換にのみ使われます。<br><br>
    ブラウザのデータ（キャッシュ・サイトデータ）を削除すると、記録も失われる可能性があります。大切な記録は時々JSONで書き出して保管することをおすすめします。</p>
    <button class="btn btn-primary" id="privacy-close" style="margin-top:12px;">閉じる</button>
  `,{center:true});
  document.getElementById("privacy-close").onclick = closeModal;
});
document.getElementById("btn-app-info").addEventListener("click", ()=>{
  openModal(`
    <h2>アプリ情報</h2>
    <p class="small">${APP_NAME}<br>バージョン ${APP_VERSION}<br>データ形式バージョン ${DATA_FORMAT_VERSION}</p>
    <button class="btn btn-primary" id="info-close" style="margin-top:12px;">閉じる</button>
  `,{center:true});
  document.getElementById("info-close").onclick = closeModal;
});
document.getElementById("btn-reset-all").addEventListener("click", async ()=>{
  const ok = await confirmDialog(
    "すべてのデータを初期化しますか？",
    "この操作の前に緊急バックアップを作成します。初期化後もしばらくの間は一時的に元に戻せます。",
    "初期化する",
    {danger:true, requireText:"初期化"}
  );
  if(!ok) return;
  createBackupGeneration("初期化前の緊急バックアップ");
  const emergencySnapshot = withChecksum(deepClone(AppData));
  try{ Storage.lsSet("mindswitch_emergency_restore", {createdAt: nowIso(), snapshot: emergencySnapshot}); }catch(e){}
  const keepBackups = [emergencySnapshot].length ? AppData.backups.slice(-1) : [];
  AppData = emptyAppData();
  AppData.backups = keepBackups;
  recomputeAggregates();
  await saveNowImmediate();
  applyTheme(); applyFontSize();
  showScreen("home");
  showToast("初期化しました", "元に戻す", async ()=>{
    const emerg = Storage.lsGet("mindswitch_emergency_restore");
    if(emerg && emerg.snapshot){
      AppData = migrateIfNeeded(deepClone(emerg.snapshot));
      recomputeAggregates();
      await saveNowImmediate();
      applyTheme(); applyFontSize();
      showScreen("home");
      showToast("元に戻しました");
    }
  }, 15000);
});

/* =========================================================
   17. 通知
========================================================= */
async function requestNotifPermissionIfNeeded(){
  if(!("Notification" in window)) return "unsupported";
  if(Notification.permission === "granted") return "granted";
  if(Notification.permission === "denied") return "denied";
  try{ return await Notification.requestPermission(); }catch(e){ return "denied"; }
}
function setupNotifTimer(){
  clearNotifTimer();
  if(!AppData.settings.notifEnabled) return;
  notifTimerHandle = setInterval(()=>{
    const now = new Date();
    const hhmm = pad2(now.getHours())+":"+pad2(now.getMinutes());
    if(hhmm === AppData.settings.notifTime){
      const todayRec = findTodayRecord();
      if(!todayRec || !todayRec.completed){ fireNotification(); }
    }
  }, 20000);
}
function clearNotifTimer(){ if(notifTimerHandle){ clearInterval(notifTimerHandle); notifTimerHandle=null; } }
function fireNotification(){
  if("Notification" in window && Notification.permission==="granted"){
    try{ new Notification("MindSwitch", {body:"マインドをセットする時間だよ", tag:"mindswitch-daily"}); }catch(e){}
  }else{
    showToast("マインドをセットする時間だよ");
  }
  if(AppData.settings.vibrationEnabled && navigator.vibrate){ try{ navigator.vibrate(200); }catch(e){} }
}
document.getElementById("btn-notif-test").addEventListener("click", async ()=>{
  const perm = await requestNotifPermissionIfNeeded();
  if(perm==="unsupported"){ showToast("この端末は通知に対応していません。"); return; }
  if(perm==="denied"){ showToast("通知が許可されていません。端末の設定から許可してください。"); return; }
  fireNotification();
});

/* =========================================================
   18. ストレージ容量不足の検知
========================================================= */
async function checkStorageQuota(){
  try{
    if(navigator.storage && navigator.storage.estimate){
      const est = await navigator.storage.estimate();
      if(est.quota && est.usage && (est.usage/est.quota) > 0.9){
        showToast("端末の保存容量が少なくなっています。設定からエクスポートやバックアップの整理をご検討ください。");
      }
    }
  }catch(e){}
}

/* =========================================================
   18-B. PWA化（Service Worker登録・更新通知）
   GitHub Pages上の複数ファイル構成のため、実際のService Workerを
   service-worker.js として登録する。マニフェストはindex.html側で
   静的な manifest.webmanifest を参照する。
========================================================= */
function registerServiceWorker(){
  if(!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async ()=>{
    try{
      const reg = await navigator.serviceWorker.register("./service-worker.js");

      // 既に更新版が待機中の場合
      if(reg.waiting){ notifyUpdateAvailable(reg); }

      reg.addEventListener("updatefound", ()=>{
        const newWorker = reg.installing;
        if(!newWorker) return;
        newWorker.addEventListener("statechange", ()=>{
          if(newWorker.state === "installed" && navigator.serviceWorker.controller){
            notifyUpdateAvailable(reg);
          }
        });
      });
    }catch(e){ console.warn("MindSwitch: Service Workerの登録に失敗しました", e); }
  });

  // 新しいService Workerが制御を引き継いだら、ページを一度だけ再読み込みする
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", ()=>{
    if(refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

function notifyUpdateAvailable(reg){
  showToast(
    "新しいバージョンがあります",
    "更新する",
    ()=>{ if(reg.waiting){ reg.waiting.postMessage({type:"SKIP_WAITING"}); } },
    9000
  );
}

/* =========================================================
   19. 初期化フロー
========================================================= */
async function init(){
  try{ history.replaceState({screen:"home"}, "", "#home"); }catch(e){}
  registerServiceWorker();
  const source = await loadAppData();
  applyTheme(); applyFontSize();
  if(AppData.settings.notifEnabled){ setupNotifTimer(); }
  checkStorageQuota();

  // 初回起動時の自動バックアップ（1時間に1回程度に抑制）
  const lastBk = AppData.meta.lastBackupAt ? new Date(AppData.meta.lastBackupAt).getTime() : 0;
  if(Date.now() - lastBk > 3600*1000){
    createBackupGeneration("起動時の自動バックアップ");
    await saveNowImmediate();
  }

  if(!AppData.meta.firstBackupPromptShownAt){
    AppData.meta.firstBackupPromptShownAt = nowIso();
    scheduleSave();
  }

  if(source === "fresh"){
    showToast("ようこそ。使い方はホームの「使い方・ヘルプ」からご確認いただけます。");
  }else if(source === "backup-recovery"){
    showToast("保存データの一部に問題があったため、直近のバックアップから復旧しました。");
  }

  renderHome();
  showScreen("home", {noHistory:true});

  // 前回起動時に未完了・修正未完了だった場合の軽いリマインド
  if(AppData.draft && AppData.draft.date === todayLocalStr()){
    const msg = AppData.draft.editingRecordId
      ? "前回の修正の続きの下書きがあります。「修正の続きから再開」で再開できます。"
      : "前回の続きの下書きがあります。「前回の続きから再開」で再開できます。";
    setTimeout(()=> showToast(msg), 600);
  }
}
init();

