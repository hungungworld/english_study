import {members as defaultMembers} from "./config.js";
import {renderMedia,leaveMedia,mediaClick,setLandingFilter} from "./media.js";
import {renderHome,leaveHome} from "./home.js";
import {pagerHtml,pageCount,PER_PAGE} from "./pager.js";
import {shared, readLocal, writeLocal, loadBoard, saveEntry, removePost, addMember, studyState, streakOf, recordStudy, readReactions, toggleReaction, readComments, addComment, removeComment, dayKey, MAX_HEARTS, HEART_EVERY} from "./data.js";

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
let labMember = 0;
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
function hero(title, description, button = "") {
  return `<section class="hero"><div><h1>${e(title)}</h1><p>${e(description)}</p></div>${button}</section>`;
}
function meta(item) {
  return `<div class="meta"><span>${monogram(item)}${authorLink(item)}</span><time datetime="${e(item.created_at)}">${dateFormat.format(new Date(item.created_at))}</time>${item.tag ? `<span class="tag">${e(item.tag)}</span>` : ""}</div>`;
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
  return `<article class="card post-preview" style="--post-delay:${Math.min(index,8)*45}ms"><h2><a href="#post/${e(post.id)}">${e(post.title)}</a></h2>${meta(post)}<p class="snippet">${e(preview)}</p>${postActions(post)}</article>`;
}
function wordCard(word, level = 2, noteLink = true) {
  return `<article class="card"><h${level}>${e(word.term)}</h${level}><p>${e(word.meaning)}</p>${word.example ? `<p lang="en">${e(word.example)}</p>` : ""}<div class="meta">${authorLink(word)}${noteLink && word.post_id ? `<a href="#post/${e(word.post_id)}">노트 보기</a>` : ""}</div></article>`;
}
const empty = message => `<div class="card empty">${e(message)}</div>`;
const emptyAction = (message, action) => `<div class="card empty"><p>${e(message)}</p><p>${action}</p></div>`;
const activeMember = () => readLocal("active-member",0);
function reactionButton(post, names = false) {
  const list = readReactions()[post.id] ?? [];
  const mine = list.includes(activeMember());
  const who = names && list.length ? `<span class="meta">${list.map(id => e(members[id - 1] ?? "")).filter(Boolean).join(", ")}님이 응원했어요</span>` : "";
  return `<button type="button" class="react" data-react="${e(post.id)}" aria-pressed="${mine}" aria-label="응원하기, 지금 ${list.length}명"><span class="ic thumb" aria-hidden="true"></span>응원하기 · ${list.length}</button>${who}`;
}
const commentCount = post => (readComments()[post.id] ?? []).length;
const postActions = post => `<div class="post-actions">${reactionButton(post)}<a class="comment-link" href="#post/${e(post.id)}/comment"><span class="ic chat" aria-hidden="true"></span>댓글쓰기 · ${commentCount(post)}</a></div>`;
function commentsSection(post) {
  const list = readComments()[post.id] ?? [];
  const me = activeMember();
  return `<section class="comments" aria-labelledby="comments-title"><h2 id="comments-title" class="section-title">댓글 ${list.length}</h2>
    ${list.length ? `<ul class="comment-list">${list.map(item => `<li><div class="meta"><span>${e(members[item.member - 1] ?? "조원")}</span><time datetime="${e(item.at)}">${dateFormat.format(new Date(item.at))}</time>${item.member === me ? `<button type="button" data-comment-delete="${e(item.id)}" data-post-id="${e(post.id)}">삭제</button>` : ""}</div><p>${e(item.text)}</p></li>`).join("")}</ul>` : '<p class="hint">첫 댓글을 남겨 보세요.</p>'}
    <form class="comment-form" data-comment-form="${e(post.id)}" novalidate><label>댓글<textarea name="text" maxlength="500" rows="3" placeholder="응원이나 궁금한 점을 남겨 보세요"></textarea></label><p class="form-error" role="alert" hidden></p><div class="row"><button class="primary" type="submit">댓글 남기기</button></div></form></section>`;
}
const writerName = post => e(author(post ?? {author:readLocal("active-member",0),author_name:""}));
const monogram = item => item.author ? `<span class="mono" aria-hidden="true">${item.author}</span>` : "";
const MONTHS = ["Jan.","Feb.","Mar.","Apr.","May","Jun.","Jul.","Aug.","Sep.","Oct.","Nov.","Dec."];
const TAGS = ["기사","영상","토익","회화","기타"];
function tagOptions(current = "") {
  const list = current && !TAGS.includes(current) ? [...TAGS,current] : TAGS;
  return `<fieldset class="tag-options"><legend>태그 (선택)</legend>${["",...list].map(tag => `<label class="chip-radio"><input type="radio" name="tag" value="${e(tag)}" ${tag === current ? "checked" : ""}><span>${tag ? e(tag) : "없음"}</span></label>`).join("")}</fieldset>`;
}
const hearts = count => `<span class="hearts" role="img" aria-label="하트 ${count}개">${Array.from({length:MAX_HEARTS},(_,i) => `<span class="ic heart${i < count ? "" : " off"}" aria-hidden="true"></span>`).join("")}</span>`;
const weekdays = ["월","화","수","목","금","토","일"];
function studyPanel() {
  const member = activeMember();
  const name = members[member - 1];
  const state = studyState(member);
  const streak = streakOf(state);
  const start = weekStart();
  const done = new Set([...state.days,...state.saved]);
  const dots = weekdays.map((label,i) => `<li class="${done.has(dayKey(start + i * day)) ? "on" : ""}"><span class="sr-only">${label}요일 ${done.has(dayKey(start + i * day)) ? "공부함" : "쉼"}</span><span aria-hidden="true">${label}</span></li>`).join("");
  const week = members.map((who,index) => ({who,id:index + 1,notes:inPeriod(board.posts.filter(post => boardKind(post) === "study"),"week").filter(post => post.author === index + 1).length,
    words:inPeriod(board.words,"week").filter(word => word.author === index + 1).length})).filter(row => row.who);
  const into = streak % HEART_EVERY;
  return `<section class="card study-panel" aria-labelledby="study-panel-title"><h2 id="study-panel-title">${name ? e(name) + "님의 " : ""}연속 학습</h2>
    ${name ? `<p class="streak"><strong>${streak}일</strong> 연속 · 하트 ${hearts(state.hearts)}</p>
    <ol class="week-dots" aria-label="이번 주 공부한 날">${dots}</ol>
    <p class="hint">퀴즈를 풀거나 노트·단어를 올리면 그날이 채워져요. ${HEART_EVERY}일 연속마다 하트가 1개 생기고(최대 ${MAX_HEARTS}개), 하루를 놓치면 하트 1개로 연속을 지켜요. ${streak ? `다음 하트까지 ${HEART_EVERY - into}일.` : ""}</p>` :
    '<p>오른쪽 위에서 내 이름을 고르면 연속 학습일이 쌓여요.</p>'}
    <h3>이번 주 우리 조 참여</h3>
    <ul class="week-members">${week.map(row => `<li><span>${e(row.who)}</span><span>노트 ${row.notes}개 · 단어 ${row.words}개</span></li>`).join("")}</ul></section>`;
}
function studied() {
  const member = activeMember();
  if (!members[member - 1]) return;
  const result = recordStudy(member);
  if (result.spent) flash("하트 1개로 연속 학습을 지켰어요.");
  else if (result.earned) flash(`${result.streak}일 연속! 하트를 1개 얻었어요.`);
  else if (result.newDay && result.streak > 1) flash(`${result.streak}일 연속 학습 중이에요.`);
}
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
    <div class="meta"><span>${monogram(post)}${e(author(post))}</span><time datetime="${e(post.created_at)}">${dateFormat.format(new Date(post.created_at))}</time></div>
    ${postActions(post)}
    ${own[post.id] ? `<div class="row"><button type="button" data-edit-id="${e(post.id)}">수정</button><button type="button" data-delete-id="${e(post.id)}">삭제</button></div>` : ""}</article>`;
}
function wordSelection() {
  return inPeriod(board.words,period).filter(word => !wordMember || word.author === wordMember);
}
function homeContext() {
  const studyPosts = board.posts.filter(post => boardKind(post) === "study");
  const start = weekStart();
  const fmt = ms => { const date = new Date(ms + kst); return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`; };
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
  if (page === "feed") return key === "chat" ? "자유 게시판" : "공부 게시판";
  if (page === "member") return "게시판 · " + (members[Number(key) - 1] ?? "조원");
  if (page === "post") return board.posts.find(post => post.id === key)?.title ?? "노트";
  if (page === "words") return key === "list" ? "단어장 · 단어 목록" : "단어장 · 퀴즈";
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
  const legacy = {study:"home",quiz:"words",news:"explore",videos:"explore"};
  if (legacy[page]) {
    if (page === "news") setLandingFilter("news");
    if (page === "videos") setLandingFilter("video");
    location.replace("#" + legacy[page]);
    return;
  }
  if (page === "lab") {
    location.replace("#feed" + (key ? "/" + key : ""));
    return;
  }
  const route = page + "/" + (key ?? "");
  if (route !== lastRoute) {
    if (page === "feed" && !/^(feed|member)\//.test(lastRoute)) labMember = 0;
    lastRoute = route;
    Object.assign(pages,{feed:1,words:1,groups:1,articles:1});
  }
  document.title = titleFor(page,key) + " – axciting";
  const homePage = page === "home";
  const landing = page === "explore" || page === "tv";
  const media = landing || page === "scraps";
  if (!homePage) leaveHome();
  document.body.classList.toggle("media-mode",landing || homePage);
  document.body.classList.toggle("home-mode",homePage);
  document.body.classList.toggle("study-mode",!(landing || homePage));
  const member = page === "member" ? Number(key) : 0;
  if (page === "member") labMember = member;
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
  else if (page === "words") content = renderWords(key);
  else if (page === "feed" || page === "member") content = renderBoard(page === "feed" && key === "chat");
  else content = renderBoard(false);
  main.innerHTML = (!shared ? '<div class="banner">체험 모드 · 예시 노트가 보이고, 쓴 내용은 이 브라우저에만 저장돼요.</div>' : "") + content;
}
// 포스터 레이아웃(왼쪽 정보 칸 + 큰 제목 + 목록): 게시판·단어장이 함께 쓴다. 홈과 같은 가로 행을 공유한다.
function posterPage({title,sub,action = "",label = "정보와 필터",bottom,body}) {
  const now = new Date(Date.now() + kst);
  return `<div class="poster-page">
    <header class="pr-head"><div><h1>${title}</h1><p>${sub}</p></div>${action}</header>
    <aside class="pr-rail" aria-label="${label}">
      <div class="pr-rail-top"><div class="pr-date" aria-hidden="true">${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}<span>${now.getUTCFullYear()}</span></div></div>
      <div class="pr-rail-bottom">${bottom}</div>
    </aside>
    <div class="pr-body">${body}</div>
  </div>`;
}
function renderBoard(chat) {
  const kind = chat ? "chat" : "study";
  const posts = sorted(board.posts.filter(post => boardKind(post) === kind && (!labMember || post.author === labMember)));
  const shown = paged("feed",posts);
  const weekCount = which => inPeriod(board.posts.filter(post => boardKind(post) === which),"week").length;
  const write = chat ? '<button type="button" class="primary" data-new-chat>＋ 글쓰기</button>' : '<button type="button" class="primary" data-new-note>＋ 노트 쓰기</button>';
  const blank = chat ? emptyAction("아직 올라온 글이 없어요. 첫 글을 써 보세요.",'<button type="button" data-new-chat>＋ 글쓰기</button>') :
    emptyAction("아직 올라온 노트가 없어요. 첫 노트를 남겨 보세요.",'<button type="button" data-new-note>＋ 노트 쓰기</button>');
  const names = [[0,"모든 조원"],...members.map((name,index) => [index + 1,name]).filter(([,name]) => name)];
  return posterPage({title:chat ? "자유 게시판" : "공부 게시판",sub:chat ? "서로 안부를 묻고 응원하는 이야기" : "조원들의 영어 공부 노트",action:write,label:"게시판 정보와 필터",
    bottom:`<nav class="pr-group" aria-label="게시판 종류"><b>게시판</b><a href="#feed" ${chat ? "" : 'aria-current="page"'}>공부 게시판</a><a href="#feed/chat" ${chat ? 'aria-current="page"' : ""}>자유 게시판</a></nav>
      <div class="pr-group"><b>이번 주</b><span>노트 ${weekCount("study")}개</span><span>글 ${weekCount("chat")}개</span><span>조원 ${members.filter(Boolean).length}명</span></div>
      <div class="pr-group" role="group" aria-label="조원"><b>조원</b>${names.map(([id,name]) => `<button type="button" data-lab-member="${id}" aria-pressed="${labMember === id}">${e(name)}</button>`).join("")}</div>`,
    body:`<div class="stack">${shown.items.map(chat ? chatCard : postCard).join("") || blank}</div>${shown.nav}`});
}
function renderWords(key) {
  const quizView = key !== "list";
  const nav = `<nav class="pr-group" aria-label="단어장 보기"><b>단어장</b><a href="#words" ${quizView ? 'aria-current="page"' : ""}>퀴즈</a><a href="#words/list" ${quizView ? "" : 'aria-current="page"'}>단어 목록</a></nav>`;
  if (quizView) {
    return posterPage({title:"단어장",sub:"함께 모은 단어로 퀴즈를 풀어요",label:"단어장 정보",
      bottom:nav + `<div class="pr-group"><b>이번 주</b><span>새 단어 ${inPeriod(board.words,"week").length}개</span><span>전체 ${board.words.length}개</span></div>`,
      body:studyPanel() + renderQuiz()});
  }
  const words = sorted(wordSelection());
  const names = [[0,"모든 조원"],...members.map((name,index) => [index + 1,name]).filter(([,name]) => name)];
  return posterPage({title:"단어장",sub:"함께 모은 영어 단어와 표현",action:'<button type="button" class="primary" data-new-word>＋ 단어 추가</button>',label:"단어장 정보와 필터",
    bottom:nav + `<div class="pr-group" role="group" aria-label="보기 방식"><b>보기</b><button type="button" data-wview="all" aria-pressed="${wordView === "all"}">단어별</button><button type="button" data-wview="group" aria-pressed="${wordView === "group"}">노트별</button></div>
      <div class="pr-group"><b>단어</b><span>${words.length}개</span></div>
      <div class="pr-group" role="group" aria-label="작성자"><b>조원</b>${names.map(([id,name]) => `<button type="button" data-word-member="${id}" aria-pressed="${wordMember === id}">${e(name)}</button>`).join("")}</div>`,
    body:wordView === "group" ? groupedWords(words) : wordList(words)});
}
function renderPost(id) {
  const post = board.posts.find(item => item.id === id);
  if (!post) return '<a class="back" href="#feed"><span class="ar l" aria-hidden="true"></span>공부 게시판</a>' + empty("노트를 찾을 수 없어요.");
  const words = board.words.filter(word => word.post_id === id);
  const link = safeLink(post.link);
  const notes = readNotes(post.body);
  const body = notes ? `<div class="study-notes">
    ${notes.summary ? `<section><h2>주제 요약</h2><p class="prose">${e(notes.summary)}</p></section>` : ""}
    ${notes.reflection ? `<section><h2>내 생각 요약</h2><p class="prose">${e(notes.reflection)}</p></section>` : ""}
    ${notes.sentence ? `<section><h2>핵심 문장 한 줄</h2><blockquote lang="en">${e(notes.sentence)}</blockquote></section>` : ""}
  </div>` : `<div class="prose"><p>${e(post.body)}</p></div>`;
  const chatPost = boardKind(post) === "chat";
  return `<a class="back" href="${chatPost ? "#feed/chat" : "#feed"}"><span class="ar l" aria-hidden="true"></span>${chatPost ? "자유 게시판" : "공부 게시판"}</a><article class="card">${chatPost ? "" : `<h1>${e(post.title)}</h1>`}${meta(post)}${body}
  <div class="post-actions">${reactionButton(post,true)}<a class="comment-link" href="#post/${e(post.id)}/comment"><span class="ic chat" aria-hidden="true"></span>댓글쓰기 · ${commentCount(post)}</a></div>
  ${link ? `<p><a class="back" href="${e(link)}" target="_blank" rel="noopener noreferrer">참고 링크<span class="ar ne" aria-hidden="true"></span></a></p>` : ""}
  ${own[id] ? '<div class="row"><button data-edit>수정</button><button data-delete>삭제</button></div>' : ""}</article>
  ${commentsSection(post)}
  ${words.length ? `<h2 class="section-title">이 노트의 단어</h2><div class="toolbar">${quizButton("post","이 노트 단어 퀴즈 풀기",words)}</div><div class="stack">${words.map(word => wordCard(word,3,false)).join("")}</div>` : ""}`;
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
  if (location.hash === "#words" || location.hash === "#words/quiz") render();
  else location.hash = "words";
}
function renderQuiz() {
  if (!quiz) {
    const wrong = reviewWords();
    const wrongBox = wrong.length ? `<div class="wrong-box"><h3>틀린 단어 다시 풀기</h3><p class="hint">지난 퀴즈에서 틀린 단어 ${wrong.length}개예요. 맞히면 목록에서 빠져요.</p>
      <ul class="wrong-list">${wrong.slice(0,6).map(word => `<li><strong lang="en">${e(word.term)}</strong><span>${e(word.meaning)}</span></li>`).join("")}</ul>
      <div class="row"><button type="button" class="primary" data-quiz="review">틀린 단어 ${wrong.length}개 풀기</button></div></div>` : "";
    const options = [quizButton("week","이번 주 단어",inPeriod(board.words,"week")),quizButton("all","전체 단어",board.words)].join("");
    return `<section class="card quiz"><h2>퀴즈 범위 고르기</h2>${options
      ? `${wrongBox}<p>범위를 고르면 최대 10문제가 나와요.</p><div class="row">${options}</div>`
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
  editor.innerHTML = `<div class="dialog-head"><h2 id="editor-title">${post ? "글 수정" : "글쓰기"}</h2><button type="button" data-close aria-label="닫기">✕</button></div>
  <form novalidate><p class="hint">작성자 · <strong>${writerName(post)}</strong></p><label class="sr-only">작성자<select name="author" disabled>${authorOptions(post)}</select></label>
  <label data-guest>표시 이름<input name="author_name" maxlength="40" value="${e(selected.author_name)}"></label>
  <label>내용<textarea name="body" required maxlength="1000" rows="6" placeholder="오늘의 이야기, 응원, 수다 무엇이든 좋아요.">${e(post?.body ?? "")}</textarea></label>
  <div class="row"><button class="primary" type="submit">${post ? "수정 저장" : "글 올리기"}</button></div>
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
      flash("글을 올렸어요.");
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
  <form novalidate><p class="hint">작성자 · <strong>${writerName(post)}</strong></p><label class="sr-only">작성자<select name="author" disabled>${authorOptions(post)}</select></label>
  <label data-guest>표시 이름<input name="author_name" maxlength="40" value="${e(selected.author_name)}"></label>
  ${standalone ? "" : `<label>제목<input name="title" required maxlength="150" value="${e(post?.title ?? source?.title.slice(0,150))}"></label>
  <label>주제 요약<textarea name="summary" required maxlength="12000" rows="3" placeholder="무엇을 다루는 자료인지 핵심을 정리해 주세요.">${e(notes.summary)}</textarea></label>
  <label>내 생각 요약<textarea name="reflection" maxlength="4000" rows="3" placeholder="새롭게 알게 된 점이나 내 의견을 적어 주세요.">${e(notes.reflection)}</textarea></label>
  <label>핵심 문장 한 줄<input name="sentence" lang="en" maxlength="500" value="${e(notes.sentence)}" placeholder="기사나 영상에서 가장 중요하다고 생각한 영어 문장"></label>
  <label>참고 링크 (선택)<input type="url" name="link" value="${e(post?.link ?? source?.url)}" maxlength="2000" placeholder="https://"></label>
  ${tagOptions(post?.tag ?? (source ? source.type === "video" ? "영상" : "기사" : ""))}`}
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
        studied();
        flash("저장했어요.");
        return;
      }
      editor.close();
      if (standalone) { period = "all"; wordMember = 0; }
      await refresh();
      studied();
      location.hash = standalone ? "words/list" : "post/" + id;
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
main.addEventListener("submit",event => {
  const form = event.target.closest("[data-comment-form]");
  if (!form) return;
  event.preventDefault();
  const text = form.elements.text.value.trim();
  const error = form.querySelector(".form-error");
  if (!text) {
    error.textContent = "댓글 내용을 입력해 주세요.";
    error.hidden = false;
    form.elements.text.setAttribute("aria-invalid","true");
    form.elements.text.focus();
    return;
  }
  const member = activeMember();
  if (!members[member - 1]) { chooseMember(() => form.requestSubmit()); return; }
  addComment(form.dataset.commentForm,member,text);
  render();
  flash("댓글을 남겼어요.");
  main.querySelector("#comments-title")?.scrollIntoView({block:"start"});
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
  if (data.commentDelete) {
    if (!confirm("이 댓글을 삭제할까요? 되돌릴 수 없어요.")) return;
    removeComment(data.postId,data.commentDelete);
    render();
    return;
  }
  if ("wordMember" in data) {
    wordMember = Number(data.wordMember);
    pages.words = pages.groups = 1;
    render();
    main.querySelector(`[data-word-member="${wordMember}"]`)?.focus();
    return;
  }
  if ("labMember" in data) {
    labMember = Number(data.labMember);
    pages.feed = 1;
    render();
    main.querySelector(`[data-lab-member="${labMember}"]`)?.focus();
    return;
  }
  if (data.react) {
    const member = activeMember();
    if (!members[member - 1]) { chooseMember(() => { toggleReaction(data.react,activeMember()); render(); }); return; }
    toggleReaction(data.react,member);
    render();
    main.querySelector(`[data-react="${CSS.escape(data.react)}"]`)?.focus();
    return;
  }
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
    if (!confirm("이 글을 삭제할까요? 되돌릴 수 없어요.")) return;
    button.disabled = true;
    try {
      await removePost(data.deleteId,own[data.deleteId]);
      delete own[data.deleteId];
      writeLocal("own",own);
      await refresh();
      flash("글을 삭제했어요.");
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
    location.hash = data.view === "quiz" ? "words" : "words/list";
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
    return target && boardKind(target) === "chat" ? "이 글을 삭제할까요? 되돌릴 수 없어요." : `노트와 연결된 단어 ${count}개도 함께 삭제돼요. 되돌릴 수 없어요.`;
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
    studied();
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
  if (location.hash.endsWith("/comment")) main.querySelector(".comment-form textarea")?.focus();
});
document.querySelector(".skip-link")?.addEventListener("click",event => {
  event.preventDefault();
  main.focus();
});
render();
refresh();
