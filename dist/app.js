import {members as defaultMembers} from "./config.js";
import {renderMedia,leaveMedia,mediaClick,setLandingFilter} from "./media.js";
import {renderHome,leaveHome} from "./home.js";
import {pagerHtml,pageCount,PER_PAGE} from "./pager.js";
import {shared, readLocal, writeLocal, loadBoard, saveEntry, removePost, addMember} from "./data.js";

const main = document.querySelector("#main");
main.addEventListener("error",event => {
  if (event.target.matches?.(".news-thumbnail")) event.target.remove();
},true);
const editor = document.querySelector("#editor");
const memberEditor = document.querySelector("#member-editor");
const memberPicker = document.querySelector("#member-picker");
const savedNames = readLocal("member-names",[]);
let members = shared ? [] : defaultMembers.map((name,index) => savedNames?.[index] || name)
  .concat(Array.isArray(savedNames) ? savedNames.slice(defaultMembers.length) : []);
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
let period = "all";
let boardPeriod = "all";
let wordMember = 0;
let wordView = "all";
const pages = {feed:1,words:1,groups:1,articles:1};
let lastRoute = "";
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
const boardKind = post => post.board === "chat" ? "chat" : "study";
const boardTabs = current => `<div class="tabs" role="group" aria-label="게시판 종류"><a href="#feed" ${current === "study" ? 'aria-current="page"' : ""}>공부 노트</a><a href="#feed/chat" ${current === "chat" ? 'aria-current="page"' : ""}>사담·응원</a></div>`;
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
const notesPrefix = "study-notes:v1\n";
function readNotes(body = "") {
  if (body.startsWith(notesPrefix)) {
    try {
      const notes = JSON.parse(body.slice(notesPrefix.length));
      if ([notes?.summary,notes?.reflection,notes?.sentence].every(value => typeof value === "string")) return notes;
    } catch { /* Display the saved text if it cannot be decoded. */ }
  }
  return null;
}
function postCard(post, index) {
  const notes = readNotes(post.body);
  const preview = notes ? notes.summary || notes.reflection || notes.sentence : post.body;
  return `<article class="card post-preview" style="--post-delay:${Math.min(index,8)*45}ms"><h2><a href="#post/${e(post.id)}">${e(post.title)}</a></h2>${meta(post)}<p class="snippet">${e(preview)}</p></article>`;
}
function wordCard(word, level = 2) {
  return `<article class="card"><h${level}>${e(word.term)}</h${level}><p>${e(word.meaning)}</p>${word.example ? `<p lang="en">${e(word.example)}</p>` : ""}<div class="meta">${authorLink(word)}${word.post_id ? `<a href="#post/${e(word.post_id)}">노트 보기</a>` : ""}</div></article>`;
}
const empty = message => `<div class="card empty">${e(message)}</div>`;
const emptyAction = (message, action) => `<div class="card empty"><p>${e(message)}</p><p>${action}</p></div>`;
const quizButton = (key,label,items) => items.length ? `<button type="button" data-quiz="${key}">${label} · ${items.length}개</button>` : "";
// Five per page; the page number is kept per list and reset when the route or a filter changes.
function paged(key, list) {
  const total = pageCount(list.length);
  pages[key] = Math.min(Math.max(1,pages[key]),total);
  const start = (pages[key] - 1) * PER_PAGE;
  return {items:list.slice(start,start + PER_PAGE),nav:pagerHtml(key,pages[key],total)};
}
function wordList(words) {
  const shown = paged("words",words);
  return `<div class="stack">${shown.items.map(word => wordCard(word)).join("") || empty("조건에 맞는 단어가 없어요. 작성자를 바꾸거나 단어를 추가해 보세요.")}</div>${shown.nav}`;
}
// 글별 묶음: words grouped under the article (post) they were written for.
function groupedWords(words) {
  const byPost = new Map();
  for (const word of words) {
    const key = board.posts.some(post => post.id === word.post_id) ? word.post_id : "";
    if (!byPost.has(key)) byPost.set(key,[]);
    byPost.get(key).push(word);
  }
  const groups = [...byPost.entries()].map(([id,list]) => ({post:board.posts.find(post => post.id === id),list}))
    .sort((x,y) => (x.post ? 0 : 1) - (y.post ? 0 : 1) || Date.parse(y.post?.created_at ?? 0) - Date.parse(x.post?.created_at ?? 0));
  if (!groups.length) return empty("조건에 맞는 단어가 없어요. 작성자를 바꾸거나 단어를 추가해 보세요.");
  const shown = paged("groups",groups);
  return `<div class="stack">${shown.items.map(({post,list}) => `<section class="card word-group">
    <div class="word-group-head"><h2>${post ? `<a href="#post/${e(post.id)}">${e(post.title)}</a>` : "노트 없이 따로 추가한 단어"}</h2>
      <div class="meta">${post ? `<span>${authorLink(post)}</span><time datetime="${e(post.created_at)}">${dateFormat.format(new Date(post.created_at))}</time>` : ""}<span>단어 ${list.length}개</span></div>
      ${post ? `<button type="button" data-quiz="post" data-post-id="${e(post.id)}">이 노트 퀴즈 풀기</button>` : ""}</div>
    ${list.map(word => `<div class="word-row"><strong lang="en">${e(word.term)}</strong><span>${e(word.meaning)}</span>${word.example ? `<em lang="en">${e(word.example)}</em>` : ""}</div>`).join("")}
  </section>`).join("")}</div>${shown.nav}`;
}
function chatCard(post) {
  return `<article class="card chat-post"><p class="chat-body">${e(post.body)}</p>
    <div class="meta"><span>${e(author(post))}</span><time datetime="${e(post.created_at)}">${dateFormat.format(new Date(post.created_at))}</time></div>
    ${own[post.id] ? `<div class="row"><button type="button" data-edit-id="${e(post.id)}">수정</button><button type="button" data-delete-id="${e(post.id)}">삭제</button></div>` : ""}</article>`;
}
function renderChat() {
  const posts = sorted(board.posts.filter(post => boardKind(post) === "chat"));
  const shown = paged("feed",posts);
  return hero("게시판","서로 안부를 묻고 응원하는 이야기",'<button type="button" data-new-chat>＋ 한마디 남기기</button>') +
    `<div class="toolbar filters-row">${boardTabs("chat")}<span class="count">글 ${posts.length}개</span></div>
    <div class="stack">${shown.items.map(chatCard).join("") || emptyAction("아직 올라온 한마디가 없어요. 첫 응원을 남겨 보세요.",'<button type="button" data-new-chat>＋ 한마디 남기기</button>')}</div>${shown.nav}`;
}
function wordSelection() {
  return inPeriod(board.words,period).filter(word => !wordMember || word.author === wordMember);
}
function homeContext() {
  const studyPosts = board.posts.filter(post => boardKind(post) === "study");
  const start = weekStart();
  const fmt = ms => { const date = new Date(ms + kst); return `${date.getUTCDate()}.${date.getUTCMonth() + 1}.`; };
  const weekWords = inPeriod(board.words,"week");
  return {loading,error:loadError,shared,memberCount:members.filter(Boolean).length,
    today:{label:fmt(Date.now()),year:new Date(Date.now() + kst).getUTCFullYear()},
    postCount:inPeriod(studyPosts,"week").length,wordCount:weekWords.length,
    posts:sorted(studyPosts).slice(0,2).map(post => ({id:post.id,title:post.title,by:author(post),date:dateFormat.format(new Date(post.created_at))})),
    words:sorted(weekWords.length ? weekWords : board.words).slice(0,3).map(word => ({term:word.term,meaning:word.meaning}))};
}
function titleFor(page, key) {
  if (page === "home") return "홈";
  if (page === "explore" || page === "tv") return "둘러보기";
  if (page === "feed") return key === "chat" ? "게시판 · 사담·응원" : "게시판 · 공부 노트";
  if (page === "member") return "게시판 · " + (members[Number(key) - 1] ?? "조원");
  if (page === "post") return board.posts.find(post => post.id === key)?.title ?? "노트";
  if (page === "words") return key === "quiz" ? "단어장 · 퀴즈" : "단어장 · 단어 목록";
  if (page === "scraps") return "내 스크랩";
  return "axciting";
}
// After a page change: move focus to the new page's heading and announce its name.
function announceRoute() {
  if (location.hash.startsWith("#tv/")) return;
  const heading = main.querySelector("h1") ?? document.querySelector(".tv-intro h1");
  if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); }
  const live = document.querySelector("#route-announcer");
  if (live) {
    live.textContent = "";
    setTimeout(() => { live.textContent = document.title; },60);
  }
}
function render() {
  const [page, key] = (location.hash.slice(1) || "home").split("/");
  // Old addresses keep working: 홈 -> 게시판, 퀴즈 -> 단어장 > 퀴즈, 뉴스/영상 -> 둘러보기 filters.
  const legacy = {study:"home",quiz:"words/quiz",news:"explore",videos:"explore"};
  if (legacy[page]) {
    if (page === "news") setLandingFilter("news");
    if (page === "videos") setLandingFilter("video");
    location.replace("#" + legacy[page]);
    return;
  }
  const route = page + "/" + (key ?? "");
  if (route !== lastRoute) {
    lastRoute = route;
    Object.assign(pages,{feed:1,words:1,groups:1,articles:1});
  }
  document.title = titleFor(page,key) + " – axciting";
  const writeButton = document.querySelector("#write");
  writeButton.textContent = page === "feed" && key === "chat" ? "＋ 한마디 남기기" : "＋ 노트 쓰기";
  const homePage = page === "home";
  const landing = page === "explore" || page === "tv";
  const media = landing || page === "scraps";
  if (!homePage) leaveHome();
  document.body.classList.toggle("media-mode",landing || homePage);
  document.body.classList.toggle("home-mode",homePage);
  document.body.classList.toggle("study-mode",!(landing || homePage));
  const member = page === "member" ? Number(key) : 0;
  document.body.classList.toggle("board-view",page === "feed" || page === "member");
  document.querySelector("#members").innerHTML = '<a class="member" href="#feed">모든 조원</a>' + members.map((name,index) =>
    `<a class="member" href="#member/${index + 1}" ${member === index + 1 ? 'aria-current="page"' : ""}><span class="avatar" aria-hidden="true" style="--avatar:${colors[index % colors.length]}">${index + 1}</span>${e(name)}</a>`).join("");
  document.querySelectorAll("#nav a").forEach(link => {
    const current = homePage ? "#home" : landing ? "#explore" : page === "scraps" ? "#scraps" : page === "words" ? "#words" : "#feed";
    const active = link.hash === current;
    if (active) link.setAttribute("aria-current","page");
    else link.removeAttribute("aria-current");
  });
  if (homePage) {
    leaveMedia();
    renderHome(main,homeContext());
    return;
  }
  if (media) {
    let mediaKey;
    try { mediaKey = key && decodeURIComponent(key); } catch { mediaKey = key; }
    renderMedia(main,mediaKey,page === "scraps" ? "scraps" : "");
    return;
  }
  leaveMedia();
  let content;
  if (loading) content = empty("불러오는 중이에요.");
  else if (loadError) content = `<div class="card empty"><p>${e(loadError)}</p><button data-refresh>다시 시도</button></div>`;
  else if (page === "post") content = renderPost(key);
  else if (page === "words") {
    const quizView = key === "quiz";
    const views = `<div class="tabs" role="group" aria-label="단어장 보기"><a href="#words" ${quizView ? "" : 'aria-current="page"'}>단어 목록</a><a href="#words/quiz" ${quizView ? 'aria-current="page"' : ""}>퀴즈</a></div>`;
    if (quizView) content = hero("단어장","함께 모은 단어로 퀴즈를 풀어요") + `<div class="toolbar">${views}</div>` + renderQuiz();
    else {
      const words = sorted(wordSelection());
      content = hero("단어장","함께 모은 영어 단어와 표현",'<button type="button" data-new-word>＋ 단어 추가</button>') +
        `<div class="toolbar filters-row">${views}
        <select id="word-member" aria-label="작성자"><option value="0">모든 조원</option>${members.map((name,index) => `<option value="${index+1}" ${wordMember === index+1 ? "selected" : ""}>${e(name)}</option>`).join("")}</select>
        <div class="tabs" aria-label="단어 보기"><button type="button" data-wview="all" aria-pressed="${wordView === "all"}">단어별</button><button type="button" data-wview="group" aria-pressed="${wordView === "group"}">노트별 묶음</button></div>
        <span class="count">단어 ${words.length}개</span>${quizButton("words","퀴즈 풀기",words)}</div>
        ${wordView === "group" ? groupedWords(words) : wordList(words)}`;
    }
  } else if (page === "feed" && key === "chat") {
    content = renderChat();
  } else {
    const personal = members[member - 1];
    const posts = sorted(inPeriod(board.posts.filter(post => boardKind(post) === "study"),boardPeriod).filter(post => !personal || post.author === member));
    const shown = paged("feed",posts);
    const description = boardPeriod === "all" ? "조원들의 영어 공부 노트" : weekLabel(boardPeriod);
    content = hero("게시판",description,quizButton("week","이번 주 단어 퀴즈 풀기",inPeriod(board.words,"week"))) +
      `<div class="toolbar filters-row">${boardTabs("study")}${periodTabs(boardPeriod)}<div class="row"><button type="button" data-board-author aria-haspopup="dialog">${e(personal || "모든 조원")} ▾</button><span class="count">노트 ${posts.length}개</span></div></div>
      <div class="stack">${shown.items.map(postCard).join("") || emptyAction("아직 올라온 노트가 없어요. 첫 노트를 남겨 보세요.",'<button type="button" data-new-note>＋ 노트 쓰기</button>')}</div>${shown.nav}`;
  }
  main.innerHTML = (!shared ? '<div class="banner">체험 모드 · 예시 노트가 보이고, 쓴 내용은 이 브라우저에만 저장돼요.</div>' : "") + content;
}
function renderPost(id) {
  const post = board.posts.find(item => item.id === id);
  if (!post) return '<a class="back" href="#feed">← 공부 노트 목록</a>' + empty("노트를 찾을 수 없어요.");
  const words = board.words.filter(word => word.post_id === id);
  const link = safeLink(post.link);
  const notes = readNotes(post.body);
  const body = notes ? `<div class="study-notes">
    ${notes.summary ? `<section><h2>주제 요약</h2><p class="prose">${e(notes.summary)}</p></section>` : ""}
    ${notes.reflection ? `<section><h2>내 생각 요약</h2><p class="prose">${e(notes.reflection)}</p></section>` : ""}
    ${notes.sentence ? `<section><h2>핵심 문장 한 줄</h2><blockquote lang="en">${e(notes.sentence)}</blockquote></section>` : ""}
  </div>` : `<div class="prose"><p>${e(post.body)}</p></div>`;
  const chatPost = boardKind(post) === "chat";
  return `<a class="back" href="${chatPost ? "#feed/chat" : "#feed"}">← ${chatPost ? "사담·응원" : "공부 노트 목록"}</a><article class="card">${chatPost ? "" : `<h1>${e(post.title)}</h1>`}${meta(post)}${body}
  ${link ? `<p><a class="back" href="${e(link)}" target="_blank" rel="noopener noreferrer">참고 링크 ↗</a></p>` : ""}
  ${own[id] ? '<div class="row"><button data-edit>수정</button><button data-delete>삭제</button></div>' : ""}</article>
  ${words.length ? `<h2 class="section-title">이 노트의 단어</h2><div class="toolbar">${quizButton("post","이 노트 단어 퀴즈 풀기",words)}</div><div class="stack">${words.map(word => wordCard(word,3)).join("")}</div>` : ""}`;
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
  if (location.hash === "#words/quiz") render();
  else location.hash = "words/quiz";
}
function renderQuiz() {
  if (!quiz) {
    const options = [quizButton("week","이번 주 단어",inPeriod(board.words,"week")),quizButton("all","전체 단어",board.words),
      quizButton("review","다시 볼 단어",reviewWords())].join("");
    const articles = sorted(board.posts).map(post => ({post,count:board.words.filter(word => word.post_id === post.id).length})).filter(item => item.count);
    const shownArticles = paged("articles",articles);
    const byArticle = articles.length ? `<h3 class="section-title">노트별로 풀기</h3><div class="stack">${shownArticles.items.map(({post,count}) =>
      `<div class="word-row"><strong>${e(post.title)}</strong><span>단어 ${count}개</span><button type="button" data-quiz="post" data-post-id="${e(post.id)}">퀴즈 풀기</button></div>`).join("")}</div>${shownArticles.nav}` : "";
    return `<section class="card quiz"><h2>퀴즈 범위 고르기</h2>${options
      ? `<p>범위를 고르면 최대 10문제가 나와요.</p><div class="row">${options}</div>${byArticle}`
      : "<p>아직 퀴즈로 풀 단어가 없어요. 노트를 쓰면서 단어를 추가해 보세요.</p>"}</section>`;
  }
  const total = quiz.words.length;
  const word = quiz.words[quiz.index];
  if (!word) {
    return `<section class="card quiz"><h2>퀴즈 완료</h2><p>${total}개 중 ${total - quiz.missed.length}개를 맞혔어요.</p>${quiz.missed.length ? '<p class="hint">틀린 단어는 \'다시 볼 단어\'에 모아 뒀어요.</p>' : ""}
    <div class="row">${quiz.missed.length ? '<button class="primary" data-quiz="retry">다시 볼 단어만 풀기</button>' : ""}<button data-quiz="reset">다른 범위 고르기</button></div></section>`;
  }
  return `<section class="card quiz"><h2>단어 퀴즈</h2><p class="hint">${quiz.index + 1} / ${total}</p>
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
// Forms use novalidate: each problem is named, tied to its field (aria-invalid +
// aria-describedby) and the first field is focused, so errors are clear to everyone.
function showFormError(form, message, fields = []) {
  const error = form.querySelector(".form-error");
  form.querySelectorAll("[aria-invalid]").forEach(field => { field.removeAttribute("aria-invalid"); field.removeAttribute("aria-describedby"); });
  error.textContent = message;
  error.hidden = false;
  for (const field of fields) { field.setAttribute("aria-invalid","true"); field.setAttribute("aria-describedby",error.id); }
  fields[0]?.focus();
}
function clearInvalid(event) {
  const field = event.target;
  if (field.getAttribute?.("aria-invalid")) { field.removeAttribute("aria-invalid"); field.removeAttribute("aria-describedby"); }
}
const authorOptions = post => members.map((name,index) => name ? `<option value="${index+1}">${e(name)}</option>` : "").join("") + (post?.author === 0 ? '<option value="0">기타</option>' : "");
// 사담·응원: a short plain message with no title, words or link.
function openChatEditor(post) {
  const selected = post ?? {author:readLocal("active-member",0),author_name:""};
  editorChanged = false;
  editor.innerHTML = `<div class="dialog-head"><h2 id="editor-title">${post ? "한마디 수정" : "한마디 남기기"}</h2><button type="button" data-close aria-label="닫기">✕</button></div>
  <form novalidate><label>작성자<select name="author" disabled>${authorOptions(post)}</select></label>
  <label data-guest>표시 이름<input name="author_name" maxlength="40" value="${e(selected.author_name)}"></label>
  <label>내용<textarea name="body" required maxlength="1000" rows="6" placeholder="오늘의 한마디, 응원, 수다 무엇이든 좋아요.">${e(post?.body ?? "")}</textarea></label>
  <div class="row"><button class="primary" type="submit">${post ? "수정 저장" : "남기기"}</button></div>
  <p class="form-error" id="editor-error" role="alert" hidden></p></form>`;
  editor.setAttribute("aria-labelledby","editor-title");
  const form = editor.querySelector("form");
  form.elements.author.value = selected.author;
  const setGuest = () => {
    const guest = form.elements.author.value === "0";
    form.querySelector("[data-guest]").hidden = !guest;
    form.elements.author_name.required = guest;
  };
  setGuest();
  form.oninput = event => { editorChanged = true; clearInvalid(event); };
  form.onsubmit = async event => {
    event.preventDefault();
    const text = String(form.elements.body.value).trim();
    const guestName = String(form.elements.author_name.value).trim();
    const submit = form.querySelector('[type="submit"]');
    if (selected.author === 0 && !guestName) return showFormError(form,"표시 이름을 입력해 주세요.",[form.elements.author_name]);
    if (!text) return showFormError(form,"내용을 입력해 주세요.",[form.elements.body]);
    form.querySelector(".form-error").hidden = true;
    const entry = {author:selected.author,author_name:selected.author === 0 ? guestName : "",
      title:[...text.replace(/\s+/g," ")].slice(0,40).join(""),body:text,link:"",tag:"",board:"chat",words:[]};
    submit.disabled = true;
    try {
      const token = post ? own[post.id] : crypto.randomUUID() + crypto.randomUUID();
      const id = await saveEntry(entry,token,post?.id);
      if (id) {
        own[id] = token;
        writeLocal("own",own);
      }
      editorChanged = false;
      editor.close();
      await refresh();
      location.hash = "feed/chat";
      flash("남겼어요.");
    } catch (failure) {
      showFormError(form,failure.message);
    } finally { submit.disabled = false; }
  };
  editor.showModal();
  form.elements.body.focus();
}
function openEditor(standalone, post, source, host, kind) {
  if (!post && !members[readLocal("active-member",0) - 1]) {
    chooseMember(() => openEditor(standalone,post,source,host,kind));
    return;
  }
  if ((post?.board ?? kind) === "chat") return openChatEditor(post);
  const pre = host ? "writer" : "editor";
  const notes = readNotes(post?.body) ?? {summary:post?.body ?? "",reflection:"",sentence:""};
  const selected = post ?? {author:readLocal("active-member",0),author_name:""};
  const words = post ? board.words.filter(word => word.post_id === post.id) : [];
  editorChanged = false;
  const target = host ?? editor;
  const heading = standalone ? "단어 추가" : post ? "노트 수정" : source ? "이 자료로 노트 쓰기" : "노트 쓰기";
  target.innerHTML = `<div class="dialog-head"><h2 id="${pre}-title">${heading}</h2><button type="button" data-close aria-label="닫기">✕</button></div>
  <form novalidate><label>작성자<select name="author" disabled>${authorOptions(post)}</select></label>
  <label data-guest>표시 이름<input name="author_name" maxlength="40" value="${e(selected.author_name)}"></label>
  ${standalone ? "" : `<label>제목<input name="title" required maxlength="150" value="${e(post?.title ?? source?.title.slice(0,150))}"></label>
  <label>주제 요약<textarea name="summary" required maxlength="12000" rows="3" placeholder="무엇을 다루는 자료인지 핵심을 정리해 주세요.">${e(notes.summary)}</textarea></label>
  <label>내 생각 요약<textarea name="reflection" maxlength="4000" rows="3" placeholder="새롭게 알게 된 점이나 내 의견을 적어 주세요.">${e(notes.reflection)}</textarea></label>
  <label>핵심 문장 한 줄<input name="sentence" lang="en" maxlength="500" value="${e(notes.sentence)}" placeholder="기사나 영상에서 가장 중요하다고 생각한 영어 문장"></label>
  <label>참고 링크 (선택)<input type="url" name="link" value="${e(post?.link ?? source?.url)}" maxlength="2000" placeholder="https://"></label>
  <label>태그 (선택)<input name="tag" maxlength="30" value="${e(post?.tag ?? (source ? source.type === "video" ? "영상" : "기사" : ""))}" placeholder="기사, 토익, 회화 등"></label>`}
  <div class="stack" data-words>${standalone ? wordFields({},false) : words.map(word => wordFields(word)).join("")}</div>
  <div class="row">${standalone ? "" : '<button type="button" data-add-word>＋ 단어 추가</button>'}<button class="primary" type="submit">${standalone ? "추가하기" : post ? "수정 저장" : "노트 올리기"}</button></div>
  <p class="form-error" id="${pre}-error" role="alert" hidden></p></form>`;
  if (!host) editor.setAttribute("aria-labelledby","editor-title");
  const form = target.querySelector("form");
  form.elements.author.value = selected.author;
  const setGuest = () => {
    const guest = form.elements.author.value === "0";
    form.querySelector("[data-guest]").hidden = !guest;
    form.elements.author_name.required = guest;
  };
  setGuest();
  form.oninput = event => { editorChanged = true; clearInvalid(event); };
  form.elements.author.onchange = setGuest;
  form.onsubmit = async event => {
    event.preventDefault();
    const formData = new FormData(form);
    const get = key => String(formData.get(key) ?? "").trim();
    const summary = get("summary");
    const reflection = get("reflection");
    const sentence = get("sentence");
    const legacyUnchanged = post && !readNotes(post.body) && summary === post.body.trim() && !reflection && !sentence;
    const body = standalone ? "" : legacyUnchanged ? post.body : notesPrefix + JSON.stringify({summary,reflection,sentence});
    const entry = {author:selected.author,author_name:selected.author === 0 ? get("author_name") : "",
      title:get("title"),body,link:get("link"),tag:get("tag"),
      words:[...form.querySelectorAll("fieldset")].map(field => ({
        id:field.dataset.wordId,term:field.querySelector('[name="term"]').value.trim(),
        meaning:field.querySelector('[name="meaning"]').value.trim(),example:field.querySelector('[name="example"]').value.trim()
      }))};
    const submit = form.querySelector('[type="submit"]');
    const problems = [];
    if (selected.author === 0 && !entry.author_name) problems.push(["표시 이름을 입력해 주세요.",[form.elements.author_name]]);
    if (!standalone) {
      const missing = [!entry.title && form.elements.title,!summary && form.elements.summary].filter(Boolean);
      if (missing.length === 2) problems.push(["제목과 주제 요약을 입력해 주세요.",missing]);
      else if (!entry.title) problems.push(["제목을 입력해 주세요.",[form.elements.title]]);
      else if (!summary) problems.push(["주제 요약을 입력해 주세요.",[form.elements.summary]]);
    }
    const incomplete = [...form.querySelectorAll("fieldset")].flatMap(field => [field.querySelector('[name="term"]'),field.querySelector('[name="meaning"]')]).filter(input => !input.value.trim());
    if (incomplete.length) problems.push(["단어와 뜻을 모두 입력해 주세요.",incomplete]);
    if (entry.link && !safeLink(entry.link)) problems.push(["참고 링크는 https://로 시작해야 해요.",[form.elements.link]]);
    if ([...body].length > 12000) problems.push(["저장할 수 있는 분량을 넘었어요. 요약을 조금 줄여 주세요.",[form.elements.summary]]);
    if (problems.length) return showFormError(form,problems.map(problem => problem[0]).join(" "),problems.flatMap(problem => problem[1]));
    form.querySelector(".form-error").hidden = true;
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
      if (host) {
        // Written beside a video/article: stay on the page so the video keeps playing.
        await refresh();
        host.innerHTML = `<div class="dialog-head"><h2 id="writer-title">저장했어요</h2><button type="button" data-close aria-label="닫기">✕</button></div>
          <p>노트를 올렸어요. 자료는 그대로 볼 수 있어요.</p>
          <div class="row"><a class="writer-link" href="#post/${e(id)}">올린 노트 보기</a><button type="button" data-write-again>노트 하나 더 쓰기</button></div>`;
        flash("저장했어요.");
        return;
      }
      editor.close();
      if (standalone) { period = "all"; wordMember = 0; }
      await refresh();
      location.hash = standalone ? "words" : "post/" + id;
      flash("저장했어요.");
    } catch (failure) {
      showFormError(form,failure.message);
    } finally { submit.disabled = false; }
  };
  if (!host) {
    editor.showModal();
    (form.querySelector('[name="title"]') ?? form.querySelector('[name="term"]'))?.focus();
  }
}
function closeEditor() {
  if (editor.querySelector('[type="submit"]')?.disabled) return;
  if (!editorChanged || confirm("저장하지 않은 내용은 사라져요. 닫을까요?")) editor.close();
}
editor.addEventListener("cancel",event => { event.preventDefault(); closeEditor(); });
function formClick(event, container, close) {
  if (event.target.closest("[data-close]")) close();
  if (event.target.closest("[data-add-word]")) {
    const fields = container.querySelector("[data-words]");
    if (fields.children.length >= 20) return flash("노트 하나에 단어는 20개까지 추가할 수 있어요.");
    fields.insertAdjacentHTML("beforeend",wordFields());
    fields.lastElementChild.querySelector("input").focus();
    editorChanged = true;
  }
  const remove = event.target.closest("[data-remove-word]");
  if (remove) { remove.closest("fieldset").remove(); editorChanged = true; }
}
editor.addEventListener("click",event => formClick(event,editor,closeEditor));

// Writing beside a video or article: the form lives in a side panel inside the detail window.
const overlayEl = document.querySelector("#tv-overlay");
let writerSource;
function closeWriter(host) {
  if (!host || host.querySelector('[type="submit"]')?.disabled) return;
  if (editorChanged && host.querySelector("form") && !confirm("저장하지 않은 내용은 사라져요. 닫을까요?")) return;
  editorChanged = false;
  host.replaceChildren();
  host.hidden = true;
  overlayEl.classList.remove("is-writing");
}
overlayEl.addEventListener("click",event => {
  const host = event.target.closest(".tv-writer");
  if (!host) return;
  formClick(event,host,() => closeWriter(host));
  if (event.target.closest("[data-write-again]")) {
    openEditor(false,undefined,writerSource,host);
    host.querySelector("textarea")?.focus();
  }
});
overlayEl.addEventListener("click",event => {
  if (event.target.closest(".tv-close") && overlayEl.classList.contains("is-writing") && editorChanged &&
      overlayEl.querySelector(".tv-writer form") && !confirm("저장하지 않은 내용은 사라져요. 닫을까요?")) event.stopImmediatePropagation();
},true);
overlayEl.addEventListener("cancel",event => {
  if (!overlayEl.classList.contains("is-writing")) return;
  event.preventDefault();
  closeWriter(overlayEl.querySelector(".tv-writer"));
});
overlayEl.addEventListener("close",() => { editorChanged = false; });
main.addEventListener("change",event => {
  if (event.target.id === "word-member") {
    wordMember = Number(event.target.value);
    pages.words = pages.groups = 1;
    render();
    document.querySelector("#word-member")?.focus();
  }
});
main.addEventListener("click",async event => {
  if (event.target.closest("[data-all-posts]")) boardPeriod = "all";
  const button = event.target.closest("button");
  if (!button) return;
  if ("tvMember" in button.dataset) {
    chooseMember();
    return;
  }
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
  if ("newNote" in data) {
    openEditor(false);
    return;
  }
  if (data.board) {
    location.hash = data.board === "chat" ? "feed/chat" : "feed";
    return;
  }
  if ("newChat" in data) {
    openEditor(false,undefined,undefined,undefined,"chat");
    return;
  }
  if (data.editId) {
    const target = board.posts.find(post => post.id === data.editId);
    if (target) openEditor(false,target);
    return;
  }
  if (data.deleteId) {
    if (!confirm("이 한마디를 삭제할까요? 되돌릴 수 없어요.")) return;
    button.disabled = true;
    try {
      await removePost(data.deleteId,own[data.deleteId]);
      delete own[data.deleteId];
      writeLocal("own",own);
      await refresh();
      flash("한마디를 삭제했어요.");
    } catch (failure) { flash(failure.message); button.disabled = false; }
    return;
  }
  if (data.pageKey) {
    pages[data.pageKey] = Number(data.page);
    render();
    window.scrollTo({top:0});
    return;
  }
  if (data.view) {
    location.hash = data.view === "quiz" ? "words/quiz" : "words";
    return;
  }
  if (data.wview) {
    wordView = data.wview;
    pages.words = pages.groups = 1;
    render();
    main.querySelector(`[data-wview="${wordView}"]`)?.focus();
    return;
  }
  if (data.quiz === "reset") {
    quiz = null;
    render();
    return;
  }
  if ("boardAuthor" in data) {
    memberDrawer.showModal();
    return;
  }
  if (data.period) {
    pages.feed = pages.words = pages.groups = 1;
    if (document.body.classList.contains("board-view")) boardPeriod = data.period;
    else period = data.period;
    render();
    main.querySelector(`[data-period="${data.period}"]`)?.focus();
  }
  if ("newWord" in data) openEditor(true);
  if ("edit" in data) openEditor(false,board.posts.find(post => post.id === id));
  if ("delete" in data && confirm((() => {
    const target = board.posts.find(post => post.id === id);
    const count = board.words.filter(word => word.post_id === id).length;
    return target && boardKind(target) === "chat" ? "이 한마디를 삭제할까요? 되돌릴 수 없어요." : `노트와 연결된 단어 ${count}개도 함께 삭제돼요. 되돌릴 수 없어요.`;
  })())) {
    button.disabled = true;
    try {
      await removePost(id,own[id]);
      delete own[id];
      writeLocal("own",own);
      location.hash = "feed";
      await refresh();
      flash("삭제했어요.");
    } catch (failure) { flash(failure.message); button.disabled = false; }
  }
  if (data.quiz) {
    const choices = {week:inPeriod(board.words,"week"),all:board.words,words:wordSelection(),post:board.words.filter(word => word.post_id === (data.postId || id)),retry:quiz?.missed,review:reviewWords()};
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
    if (shared) {
      members = [];
      for (const {id,name} of board.members) members[id - 1] = name;
    }
    loadError = "";
  } catch (failure) { loadError = failure.message; }
  loading = false;
  render();
  updateMemberLabel();
  if (!loadError && members.length && !members[readLocal("active-member",0) - 1] && !memberPicker.open) chooseMember();
}
document.querySelector("#write").addEventListener("click",() => location.hash === "#feed/chat" ? openEditor(false,undefined,undefined,undefined,"chat") : openEditor(false));
overlayEl.addEventListener("write-media",event => {
  const {item,host} = event.detail;
  writerSource = item;
  openEditor(false,undefined,item,host);
  host.querySelector("textarea")?.focus();
});
function chooseMember(afterSelection) {
  if (memberPicker.open) return;
  if (!members.length) return flash("조원 목록을 불러온 뒤 다시 시도해 주세요.");
  const active = readLocal("active-member",0);
  memberPicker.innerHTML = `<div class="dialog-head"><h2 id="member-picker-title">내 이름 선택</h2></div>
    <p class="hint">선택한 이름으로 노트와 단어를 올려요.</p>
    <form method="dialog"><label>조원<select name="member" required>
      <option value="">이름을 선택해 주세요</option>
      ${members.map((name,index) => `<option value="${index+1}" ${active === index+1 ? "selected" : ""}>${e(name)}</option>`).join("")}
    </select></label><button class="primary">이 이름으로 시작</button></form>`;
  memberPicker.querySelector("form").onsubmit = event => {
    event.preventDefault();
    writeLocal("active-member",Number(event.currentTarget.elements.member.value));
    memberPicker.close();
    updateMemberLabel();
    afterSelection?.();
  };
  memberPicker.showModal();
}
function updateMemberLabel() {
  const name = members[readLocal("active-member",0) - 1];
  document.querySelector("#choose-member").textContent = name ? name + " ▾" : "내 이름 선택";
}
document.querySelector("#choose-member").onclick = () => chooseMember();
const memberDrawer = document.querySelector("#member-drawer");
document.querySelector("#open-members").onclick = () => memberDrawer.showModal();
memberDrawer.addEventListener("click",event => {
  if (event.target === memberDrawer || event.target.closest("#members a")) memberDrawer.close();
});
document.querySelector("#rename-members").onclick = () => {
  memberDrawer.close();
  if (!shared) return flash("지금은 체험 모드라 조원을 추가할 수 없어요.");
  memberEditor.innerHTML = `<div class="dialog-head"><h2 id="member-editor-title">관리자 · 조원 추가</h2></div>
    <form><label>관리자 이메일<input name="email" type="email" autocomplete="username" required></label>
    <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
    <label>새 조원 이름<input name="name" required maxlength="24"></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="row"><button class="primary" type="submit">조원 추가</button><button type="button" id="cancel-rename">취소</button></div></form>`;
  memberEditor.querySelector("#cancel-rename").onclick = () => memberEditor.close();
  memberEditor.querySelector("form").onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("[type=submit]");
    const error = form.querySelector(".form-error");
    error.hidden = true;
    submit.disabled = true;
    try {
      await addMember(form.elements.email.value.trim(),form.elements.password.value,form.elements.name.value.trim());
      memberEditor.close();
      await refresh();
      flash("조원을 추가했어요.");
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally { submit.disabled = false; }
  };
  memberEditor.showModal();
};
window.addEventListener("hashchange",event => {
  const previous = new URL(event.oldURL).hash;
  const current = location.hash;
  const inLanding = hash => !hash || hash === "#home" || hash === "#explore" || hash.startsWith("#tv/");
  if (!inLanding(previous) || !inLanding(current)) window.scrollTo(0,0);
  render();
  announceRoute();
});
document.querySelector(".skip-link")?.addEventListener("click",event => {
  event.preventDefault();
  main.focus();
});
render();
refresh();
