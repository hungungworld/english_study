import {members as defaultMembers} from "./config.js";
import {renderMedia,leaveMedia,mediaClick} from "./media.js";
import {shared, readLocal, writeLocal, loadBoard, saveEntry, removePost} from "./data.js";

const main = document.querySelector("#main");
main.addEventListener("error",event => {
  if (event.target.matches?.(".news-thumbnail")) event.target.remove();
},true);
const editor = document.querySelector("#editor");
const memberEditor = document.querySelector("#member-editor");
const savedNames = readLocal("member-names",[]);
const members = defaultMembers.map((name,index) => savedNames?.[index] || name);
const notice = document.querySelector("#notice");
const colors = ["#e3d6fb","#f9dfcc","#d4eadd","#f5dbea","#dce6fa"];
const day = 86400000;
const kst = 9 * 3600000;
const dateFormat = new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"long",day:"numeric"});
const e = (value = "") => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const author = item => members[item.author - 1] ?? item.author_name;
const own = readLocal("own", {});
let board = {posts:[],words:[]};
let loading = true;
let loadError = "";
let period = "week";
let wordMember = 0;
let quiz = null;
let noticeTimer;
let editorChanged = false;

function weekStart(now = Date.now()) {
  const local = new Date(now + kst);
  const offset = (local.getUTCDay() + 6) % 7;
  return Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate() - offset) - kst;
}
function inPeriod(items, value) {
  if (value === "all") return items;
  const start = weekStart() - (value === "last" ? 7 * day : 0);
  return items.filter(item => {
    const time = Date.parse(item.created_at);
    return time >= start && time < start + 7 * day;
  });
}
function weekLabel(value) {
  const start = weekStart() - (value === "last" ? 7 * day : 0);
  return dateFormat.format(start) + "–" + dateFormat.format(start + 6 * day);
}
function sorted(items) {
  return [...items].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
function flash(message) {
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ""; }, 4000);
}
function safeLink(value) {
  try {
    const url = new URL(value);
    return ["https:","http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}
function authorLink(item) {
  return item.author ? `<a href="#member/${item.author}">${e(author(item))}</a>` : e(author(item));
}
function periodTabs(value) {
  return `<div class="tabs" aria-label="기간">${[["week","이번 주"],["last","지난주"],["all","전체"]].map(([id,label]) =>
    `<button type="button" data-period="${id}" aria-pressed="${id === value}">${label}</button>`).join("")}</div>`;
}
function hero(title, description, button = "") {
  return `<section class="hero"><div><h1>${e(title)}</h1><p>${e(description)}</p></div>${button}</section>`;
}
function meta(item) {
  return `<div class="meta"><span>${authorLink(item)}</span><time datetime="${e(item.created_at)}">${dateFormat.format(new Date(item.created_at))}</time>${item.tag ? `<span class="tag">${e(item.tag)}</span>` : ""}</div>`;
}
function postCard(post) {
  return `<article class="card"><h2><a href="#post/${e(post.id)}">${e(post.title)}</a></h2>${meta(post)}<p class="snippet">${e(post.body)}</p></article>`;
}
function wordCard(word) {
  return `<article class="card"><h2>${e(word.term)}</h2><p>${e(word.meaning)}</p>${word.example ? `<p lang="en">${e(word.example)}</p>` : ""}<div class="meta">${authorLink(word)}${word.post_id ? `<a href="#post/${e(word.post_id)}">관련 글 보기</a>` : ""}</div></article>`;
}
const empty = message => `<div class="card empty">${e(message)}</div>`;
const quizButton = (key,label,items) => items.length ? `<button type="button" data-quiz="${key}">${label} · ${items.length}개</button>` : "";
function wordSelection() {
  return inPeriod(board.words,period).filter(word => !wordMember || word.author === wordMember);
}
function render() {
  const [page, key] = (location.hash.slice(1) || "home").split("/");
  const landing = page === "home" || page === "tv";
  const media = landing || page === "news" || page === "videos";
  document.body.classList.toggle("media-mode",landing);
  document.body.classList.toggle("study-mode",!landing);
  const member = page === "member" ? Number(key) : 0;
  document.querySelector("#members").innerHTML = members.map((name,index) =>
    `<a class="member" href="#member/${index + 1}" ${member === index + 1 ? 'aria-current="page"' : ""}><span class="avatar" aria-hidden="true" style="--avatar:${colors[index]}">${index + 1}</span>${e(name)}</a>`).join("");
  document.querySelectorAll("#nav a").forEach(link => {
    const active = link.hash === (landing ? "#home" : media ? "#" + page : ["words","quiz"].includes(page) ? "#words" : "#feed");
    if (active) link.setAttribute("aria-current","page");
    else link.removeAttribute("aria-current");
  });
  if (media) {
    let mediaKey;
    try { mediaKey = key && decodeURIComponent(key); } catch { mediaKey = key; }
    renderMedia(main,mediaKey,page === "news" ? "news" : page === "videos" ? "video" : "");
    return;
  }
  leaveMedia();
  let content;
  if (page === "study") content = hero("스터디 서클","영어 공부 기록을 나누고, 함께 복습해요.") +
    '<nav class="study-links" aria-label="스터디 홈"><a class="card" href="#feed">주간 게시판</a><a class="card" href="#words">공유 단어장</a><a class="card" href="#news">BBC 기사</a><a class="card" href="#videos">영어 영상</a></nav>';
  else if (loading) content = empty("스터디 기록을 불러오는 중이에요.");
  else if (loadError) content = `<div class="card empty"><p>${e(loadError)}</p><button data-refresh>다시 불러오기</button></div>`;
  else if (page === "quiz") content = renderQuiz();
  else if (page === "post") content = renderPost(key);
  else if (page === "words") {
    const words = sorted(wordSelection());
    content = hero("공유 단어장","함께 모은 영어 단어와 표현",'<button type="button" data-new-word>＋ 단어 추가</button>') +
      `<div class="toolbar">${periodTabs(period)}<label><span class="hint">등록자</span><select id="word-member"><option value="0">모든 조원</option>${members.map((name,index) => `<option value="${index+1}" ${wordMember === index+1 ? "selected" : ""}>${e(name)}</option>`).join("")}</select></label></div>
      <div class="toolbar"><span class="count">단어 ${words.length}개</span>${quizButton("words","선택한 단어로 퀴즈",words)}${quizButton("review","다시 볼 단어",reviewWords())}</div>
      <div class="stack">${words.map(wordCard).join("") || empty("이 조건에 해당하는 단어가 없어요.")}</div>`;
  } else {
    const personal = members[member - 1];
    const posts = sorted(personal ? board.posts.filter(post => post.author === member) : inPeriod(board.posts,period));
    const title = personal ? personal + " 게시판" : {week:"이번 주 스터디",last:"지난주 스터디",all:"전체 게시판"}[period];
    const description = personal ? "공유한 영어 공부 기록" : period === "all" ? "다섯 조원의 영어 공부 기록" : weekLabel(period);
    content = hero(title,description,personal ? "" : quizButton("week","이번 주 단어 퀴즈",inPeriod(board.words,"week"))) +
      `<div class="toolbar">${personal ? '<a class="back" href="#feed">← 통합 게시판</a>' : periodTabs(period)}<span class="count">게시글 ${posts.length}개</span></div>
      <div class="stack">${posts.map(postCard).join("") || empty("아직 올라온 글이 없어요.")}</div>`;
  }
  main.innerHTML = (!shared ? '<div class="banner">미리보기 · 예시 글이 표시되며 새 기록은 이 브라우저에만 저장돼요.</div>' : "") + content;
}
function renderPost(id) {
  const post = board.posts.find(item => item.id === id);
  if (!post) return '<a class="back" href="#feed">← 게시판</a>' + empty("글을 찾을 수 없어요.");
  const words = board.words.filter(word => word.post_id === id);
  const link = safeLink(post.link);
  return `<a class="back" href="#feed">← 게시판</a><article class="card"><h1>${e(post.title)}</h1>${meta(post)}<div class="prose"><p>${e(post.body)}</p></div>
  ${link ? `<p><a class="back" href="${e(link)}" target="_blank" rel="noopener noreferrer">참고 링크 ↗</a></p>` : ""}
  ${own[id] ? '<div class="row"><button data-edit>수정</button><button data-delete>삭제</button></div>' : ""}</article>
  ${words.length ? `<h2 class="section-title">이 글의 단어</h2><div class="toolbar">${quizButton("post","이 글의 단어로 퀴즈",words)}</div><div class="stack">${words.map(wordCard).join("")}</div>` : ""}`;
}
function reviewWords() {
  const saved = readLocal("review",[]);
  return board.words.filter(word => saved.includes(word.id));
}
function beginQuiz(words) {
  if (!words.length) return;
  const shuffled = [...words];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i],shuffled[j]] = [shuffled[j],shuffled[i]];
  }
  quiz = {words:shuffled.slice(0,10),index:0,revealed:false,missed:[]};
  if (location.hash === "#quiz") render();
  else location.hash = "quiz";
}
function renderQuiz() {
  const back = '<a class="back" href="#words">← 단어장</a>';
  if (!quiz) return back + empty("단어장에서 풀고 싶은 퀴즈를 골라 주세요.");
  const total = quiz.words.length;
  const word = quiz.words[quiz.index];
  if (!word) {
    return back + `<section class="card quiz"><h1>퀴즈 완료</h1><p>${total}개 중 ${total - quiz.missed.length}개를 맞혔어요.</p>
    ${quiz.missed.length ? '<div class="row"><button class="primary" data-quiz="retry">다시 볼 단어만 풀기</button></div>' : ""}</section>`;
  }
  return back + `<section class="card quiz"><h1>단어 퀴즈</h1><p class="hint">${quiz.index + 1} / ${total}</p>
  <progress value="${quiz.index}" max="${total}" aria-label="퀴즈 진행률"></progress><h2 lang="en">${e(word.term)}</h2>
  ${quiz.revealed ? `<p>${e(word.meaning)}</p>${word.example ? `<p lang="en">${e(word.example)}</p>` : ""}
    <div class="row"><button class="primary" data-answer="correct">맞혔어요</button><button data-answer="missed">다시 볼래요</button></div>` :
    '<p>뜻을 떠올려 보세요.</p><div class="row"><button class="primary" data-reveal>정답 확인</button></div>'}</section>`;
}
function wordFields(word = {}, removable = true) {
  return `<fieldset class="word-fields" data-word-id="${e(word.id)}">
  <label>영어 단어·표현<input name="term" required maxlength="120" value="${e(word.term)}"></label>
  <label>한국어 뜻<input name="meaning" required maxlength="300" value="${e(word.meaning)}"></label>
  <label>예문 (선택)<input name="example" maxlength="600" value="${e(word.example)}"></label>
  ${removable ? '<button type="button" data-remove-word>단어 빼기</button>' : ""}</fieldset>`;
}
function openEditor(standalone, post) {
  const last = readLocal("author",{author:1,author_name:""});
  const selected = post ?? last;
  const words = post ? board.words.filter(word => word.post_id === post.id) : [];
  editorChanged = false;
  editor.innerHTML = `<div class="dialog-head"><h2 id="editor-title">${standalone ? "단어 추가" : post ? "글 수정" : "글쓰기"}</h2><button type="button" data-close aria-label="닫기">✕</button></div>
  <form><label>작성자<select name="author">${members.map((name,index) => `<option value="${index+1}">${e(name)}</option>`).join("")}<option value="0">기타</option></select></label>
  <label id="guest-label">표시 이름<input name="author_name" maxlength="40" value="${e(selected.author_name)}"></label>
  ${standalone ? "" : `<label>제목<input name="title" required maxlength="150" value="${e(post?.title)}"></label>
  <label>본문<textarea name="body" required maxlength="12000">${e(post?.body)}</textarea></label>
  <label>참고 링크 (선택)<input type="url" name="link" value="${e(post?.link)}" maxlength="2000" placeholder="https://"></label>
  <label>태그 (선택)<input name="tag" maxlength="30" value="${e(post?.tag)}" placeholder="기사, 토익, 회화 등"></label>`}
  <div class="stack" id="editor-words">${standalone ? wordFields({},false) : words.map(word => wordFields(word)).join("")}</div>
  <div class="row">${standalone ? "" : '<button type="button" data-add-word>＋ 단어 추가</button>'}<button class="primary" type="submit">${post ? "수정 저장" : "등록하기"}</button></div>
  <p class="form-error" role="alert" hidden></p></form>`;
  editor.setAttribute("aria-labelledby","editor-title");
  const form = editor.querySelector("form");
  form.elements.author.value = selected.author;
  const setGuest = () => {
    const guest = form.elements.author.value === "0";
    form.querySelector("#guest-label").hidden = !guest;
    form.elements.author_name.required = guest;
  };
  setGuest();
  form.oninput = () => { editorChanged = true; };
  form.elements.author.onchange = setGuest;
  form.onsubmit = async event => {
    event.preventDefault();
    const formData = new FormData(form);
    const get = key => String(formData.get(key) ?? "").trim();
    const entry = {author:Number(get("author")),author_name:get("author") === "0" ? get("author_name") : "",
      title:get("title"),body:get("body"),link:get("link"),tag:get("tag"),
      words:[...form.querySelectorAll("fieldset")].map(field => ({
        id:field.dataset.wordId,term:field.querySelector('[name="term"]').value.trim(),
        meaning:field.querySelector('[name="meaning"]').value.trim(),example:field.querySelector('[name="example"]').value.trim()
      }))};
    const error = form.querySelector(".form-error");
    const submit = form.querySelector('[type="submit"]');
    error.hidden = true;
    if ((!standalone && (!entry.title || !entry.body)) || (!entry.author && !entry.author_name) ||
        entry.words.some(word => !word.term || !word.meaning) || (entry.link && !safeLink(entry.link))) {
      error.textContent = "필수 항목과 참고 링크를 확인해 주세요.";
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    try {
      const token = post ? own[post.id] : crypto.randomUUID() + crypto.randomUUID();
      const id = await saveEntry(entry,token,post?.id);
      if (id) {
        own[id] = token;
        writeLocal("own",own);
      }
      writeLocal("author",{author:entry.author,author_name:entry.author_name});
      editorChanged = false;
      editor.close();
      if (standalone) { period = "week"; wordMember = 0; }
      await refresh();
      location.hash = standalone ? "words" : "post/" + id;
      flash("저장했어요.");
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally { submit.disabled = false; }
  };
  editor.showModal();
}
function closeEditor() {
  if (editor.querySelector('[type="submit"]')?.disabled) return;
  if (!editorChanged || confirm("작성 중인 내용을 닫을까요?")) editor.close();
}
editor.addEventListener("cancel",event => { event.preventDefault(); closeEditor(); });
editor.addEventListener("click",event => {
  if (event.target.closest("[data-close]")) closeEditor();
  if (event.target.closest("[data-add-word]")) {
    const fields = editor.querySelector("#editor-words");
    if (fields.children.length >= 20) return flash("글 하나에 단어를 최대 20개 추가할 수 있어요.");
    fields.insertAdjacentHTML("beforeend",wordFields());
    fields.lastElementChild.querySelector("input").focus();
    editorChanged = true;
  }
  const remove = event.target.closest("[data-remove-word]");
  if (remove) { remove.closest("fieldset").remove(); editorChanged = true; }
});
main.addEventListener("change",event => {
  if (event.target.id === "word-member") {
    wordMember = Number(event.target.value);
    render();
    document.querySelector("#word-member")?.focus();
  }
});
main.addEventListener("click",async event => {
  const button = event.target.closest("button");
  if (!button) return;
  if ("tvWrite" in button.dataset) {
    openEditor(false);
    return;
  }
  if (main.querySelector(".tv-home")) {
    mediaClick(button);
    return;
  }
  const id = location.hash.split("/")[1];
  const data = button.dataset;
  if (data.period) {
    period = data.period;
    render();
    main.querySelector(`[data-period="${period}"]`)?.focus();
  }
  if ("newWord" in data) openEditor(true);
  if ("edit" in data) openEditor(false,board.posts.find(post => post.id === id));
  if ("delete" in data && confirm("이 글과 글에 연결된 단어를 삭제할까요?")) {
    button.disabled = true;
    try {
      await removePost(id,own[id]);
      delete own[id];
      writeLocal("own",own);
      location.hash = "feed";
      await refresh();
      flash("글을 삭제했어요.");
    } catch (failure) { flash(failure.message); button.disabled = false; }
  }
  if (data.quiz) {
    const choices = {week:inPeriod(board.words,"week"),words:wordSelection(),post:board.words.filter(word => word.post_id === id),retry:quiz?.missed,review:reviewWords()};
    beginQuiz(choices[data.quiz] ?? []);
  }
  if ("reveal" in data && quiz) {
    quiz.revealed = true;
    render();
    main.querySelector("[data-answer]")?.focus();
  }
  if (data.answer && quiz) {
    const word = quiz.words[quiz.index];
    const review = new Set(readLocal("review",[]));
    if (data.answer === "missed") { quiz.missed.push(word); review.add(word.id); }
    else review.delete(word.id);
    writeLocal("review",[...review]);
    quiz.index++;
    quiz.revealed = false;
    render();
    main.querySelector("[data-reveal], [data-quiz]")?.focus();
  }
  if ("refresh" in data) await refresh();
});
async function refresh() {
  try {
    board = await loadBoard();
    loadError = "";
  } catch (failure) { loadError = failure.message; }
  loading = false;
  render();
}
document.querySelector("#write").addEventListener("click",() => openEditor(false));
document.querySelector("#rename-members").addEventListener("click",() => {
  memberEditor.innerHTML = `<div class="dialog-head"><h2 id="member-editor-title">조원 이름 변경</h2></div>
    <p class="hint">변경한 이름은 이 브라우저에 저장돼요.</p>
    <form>${members.map((name,index) => `<label>조원 ${index + 1}<input required maxlength="24" value="${e(name)}"></label>`).join("")}
    <p class="form-error" role="alert" hidden>조원 이름을 모두 입력해 주세요.</p>
    <div class="row"><button class="primary" type="submit">저장</button><button type="button" id="cancel-rename">취소</button></div></form>`;
  memberEditor.querySelector("#cancel-rename").onclick = () => memberEditor.close();
  memberEditor.querySelector("form").onsubmit = event => {
    event.preventDefault();
    const names = [...memberEditor.querySelectorAll("input")].map(input => input.value.trim());
    if (names.some(name => !name)) {
      memberEditor.querySelector(".form-error").hidden = false;
      return;
    }
    members.splice(0,members.length,...names);
    writeLocal("member-names",members);
    memberEditor.close();
    render();
    flash("조원 이름을 저장했어요.");
  };
  memberEditor.showModal();
});
window.addEventListener("hashchange",event => {
  const previous = new URL(event.oldURL).hash;
  const current = location.hash;
  const inLanding = hash => !hash || hash === "#home" || hash.startsWith("#tv/");
  if (!inLanding(previous) || !inLanding(current)) window.scrollTo(0,0);
  render();
});
render();
refresh();
