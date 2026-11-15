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
const dateFormat = new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",month:"short",day:"numeric"});
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
window.addEventListener("sync-failed",() => flash("Could not save to the shared database. Check your connection."));
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
  return `<article class="card"><h${level}>${e(word.term)}</h${level}><p>${e(word.meaning)}</p>${word.example ? `<p lang="en">${e(word.example)}</p>` : ""}<div class="meta">${authorLink(word)}${noteLink && word.post_id ? `<a href="#post/${e(word.post_id)}">View note</a>` : ""}</div></article>`;
}
const empty = message => `<div class="card empty">${e(message)}</div>`;
const emptyAction = (message, action) => `<div class="card empty"><p>${e(message)}</p><p>${action}</p></div>`;
const activeMember = () => readLocal("active-member",0);
function reactionButton(post, names = false) {
  const list = readReactions()[post.id] ?? [];
  const mine = list.includes(activeMember());
  const who = names && list.length ? `<span class="meta">${list.map(id => e(members[id - 1] ?? "")).filter(Boolean).join(", ")} cheered</span>` : "";
  return `<button type="button" class="react" data-react="${e(post.id)}" aria-pressed="${mine}" aria-label="Cheer, ${list.length} so far"><span class="ic thumb" aria-hidden="true"></span>Cheer · ${list.length}</button>${who}`;
}
const commentCount = post => (readComments()[post.id] ?? []).length;
const postActions = post => `<div class="post-actions">${reactionButton(post)}<a class="comment-link" href="#post/${e(post.id)}/comment"><span class="ic chat" aria-hidden="true"></span>Comment · ${commentCount(post)}</a></div>`;
function commentsSection(post) {
  const list = readComments()[post.id] ?? [];
  const me = activeMember();
  return `<section class="comments" aria-labelledby="comments-title"><h2 id="comments-title" class="section-title">Comments ${list.length}</h2>
    ${list.length ? `<ul class="comment-list">${list.map(item => `<li><div class="meta"><span>${e(members[item.member - 1] ?? "Member")}</span><time datetime="${e(item.at)}">${dateFormat.format(new Date(item.at))}</time>${item.member === me ? `<button type="button" data-comment-delete="${e(item.id)}" data-post-id="${e(post.id)}">Delete</button>` : ""}</div><p>${e(item.text)}</p></li>`).join("")}</ul>` : '<p class="hint">Be the first to comment.</p>'}
    <form class="comment-form" data-comment-form="${e(post.id)}" novalidate><label>Comment<textarea name="text" maxlength="500" rows="3" placeholder="Leave a cheer or a question"></textarea></label><p class="form-error" role="alert" hidden></p><div class="row"><button class="primary" type="submit">Post comment</button></div></form></section>`;
}
const writerName = post => e(author(post ?? {author:readLocal("active-member",0),author_name:""}));
const monogram = item => item.author ? `<span class="mono" aria-hidden="true">${item.author}</span>` : "";
const MONTHS = ["Jan.","Feb.","Mar.","Apr.","May","Jun.","Jul.","Aug.","Sep.","Oct.","Nov.","Dec."];
const TAGS = ["Article","Video","TOEIC","Speaking","Other"];
function tagOptions(current = "") {
  const list = current && !TAGS.includes(current) ? [...TAGS,current] : TAGS;
  return `<fieldset class="tag-options"><legend>Tag (optional)</legend>${["",...list].map(tag => `<label class="chip-radio"><input type="radio" name="tag" value="${e(tag)}" ${tag === current ? "checked" : ""}><span>${tag ? e(tag) : "None"}</span></label>`).join("")}</fieldset>`;
}
const hearts = count => `<span class="hearts" role="img" aria-label="${count} hearts">${Array.from({length:MAX_HEARTS},(_,i) => `<span class="ic heart${i < count ? "" : " off"}" aria-hidden="true"></span>`).join("")}</span>`;
const weekdays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
function studyPanel() {
  const member = activeMember();
  const name = members[member - 1];
  const state = studyState(member);
  const streak = streakOf(state);
  const start = weekStart();
  const done = new Set([...state.days,...state.saved]);
  const dots = weekdays.map((label,i) => `<li class="${done.has(dayKey(start + i * day)) ? "on" : ""}"><span class="sr-only">${label}: ${done.has(dayKey(start + i * day)) ? "studied" : "rest"}</span><span aria-hidden="true">${label}</span></li>`).join("");
  const week = members.map((who,index) => ({who,id:index + 1,notes:inPeriod(board.posts.filter(post => boardKind(post) === "study"),"week").filter(post => post.author === index + 1).length,
    words:inPeriod(board.words,"week").filter(word => word.author === index + 1).length})).filter(row => row.who);
  const into = streak % HEART_EVERY;
  return `<section class="card study-panel" aria-labelledby="study-panel-title"><h2 id="study-panel-title">${name ? e(name) + "’s " : ""}study streak</h2>
    ${name ? `<p class="streak"><strong>${streak} ${streak === 1 ? "day" : "days"}</strong> in a row · Hearts ${hearts(state.hearts)}</p>
    <ol class="week-dots" aria-label="Days studied this week">${dots}</ol>
    <p class="hint">Take a quiz or post a note or word and today fills in. Every ${HEART_EVERY} days in a row earns a heart (up to ${MAX_HEARTS}), and a heart covers one missed day. ${streak ? `${HEART_EVERY - into} more ${HEART_EVERY - into === 1 ? "day" : "days"} to the next heart.` : ""}</p>` :
    '<p>Choose your name at the top right to start a streak.</p>'}
    <h3>This week’s activity</h3>
    <ul class="week-members">${week.map(row => `<li><span>${e(row.who)}</span><span>${row.notes} ${row.notes === 1 ? "note" : "notes"} · ${row.words} ${row.words === 1 ? "word" : "words"}</span></li>`).join("")}</ul></section>`;
}
function studied() {
  const member = activeMember();
  if (!members[member - 1]) return;
  const result = recordStudy(member);
  if (result.spent) flash("A heart covered your missed day.");
  else if (result.earned) flash(`${result.streak} days in a row! You earned a heart.`);
  else if (result.newDay && result.streak > 1) flash(`${result.streak} days in a row.`);
}
const quizButton = (key,label,items) => items.length ? `<button type="button" data-quiz="${key}">${label} · ${items.length}</button>` : "";
// Five per page; the page number is kept per list and reset when the route or a filter changes.
function paged(key, list) {
  const total = pageCount(list.length);
  pages[key] = Math.min(Math.max(1,pages[key]),total);
  const start = (pages[key] - 1) * PER_PAGE;
  return {items:list.slice(start,start + PER_PAGE),nav:pagerHtml(key,pages[key],total)};
}
function wordList(words) {
  const shown = paged("words",words);
  return `<div class="stack">${shown.items.map(word => wordCard(word)).join("") || empty("No words match. Change the author or add a word.")}</div>${shown.nav}`;
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
  if (!groups.length) return empty("No words match. Change the author or add a word.");
  const shown = paged("groups",groups);
  return `<div class="stack">${shown.items.map(({post,list}) => `<section class="card word-group">
    <div class="word-group-head"><h2>${post ? `<a href="#post/${e(post.id)}">${e(post.title)}</a>` : "Words added without a note"}</h2>
      <div class="meta">${post ? `<span>${authorLink(post)}</span><time datetime="${e(post.created_at)}">${dateFormat.format(new Date(post.created_at))}</time>` : ""}<span>${list.length} ${list.length === 1 ? "word" : "words"}</span></div>
      ${post ? `<button type="button" data-quiz="post" data-post-id="${e(post.id)}">Quiz this note</button>` : ""}</div>
    ${list.map(word => `<div class="word-row"><strong lang="en">${e(word.term)}</strong><span>${e(word.meaning)}</span>${word.example ? `<em lang="en">${e(word.example)}</em>` : ""}</div>`).join("")}
  </section>`).join("")}</div>${shown.nav}`;
}
function chatCard(post) {
  return `<article class="card chat-post"><p class="chat-body">${e(post.body)}</p>
    <div class="meta"><span>${monogram(post)}${e(author(post))}</span><time datetime="${e(post.created_at)}">${dateFormat.format(new Date(post.created_at))}</time></div>
    ${postActions(post)}
    ${own[post.id] ? `<div class="row"><button type="button" data-edit-id="${e(post.id)}">Edit</button><button type="button" data-delete-id="${e(post.id)}">Delete</button></div>` : ""}</article>`;
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
  if (page === "home") return "Home";
  if (page === "explore" || page === "tv") return "Explore";
  if (page === "feed") return key === "chat" ? "Free board" : "Study board";
  if (page === "member") return "Board · " + (members[Number(key) - 1] ?? "Member");
  if (page === "post") return board.posts.find(post => post.id === key)?.title ?? "Note";
  if (page === "words") return key === "list" ? "Vocab · Word list" : "Vocab · Quiz";
  if (page === "scraps") return "Saved";
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
  document.querySelector("#members").innerHTML = '<a class="member" href="#feed">All members</a>' + members.map((name,index) =>
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
  if (loading) content = empty("Loading…");
  else if (loadError) content = `<div class="card empty"><p>${e(loadError)}</p><button data-refresh>Try again</button></div>`;
  else if (page === "post") content = renderPost(key);
  else if (page === "words") content = renderWords(key);
  else if (page === "feed" || page === "member") content = renderBoard(page === "feed" && key === "chat");
  else content = renderBoard(false);
  main.innerHTML = (!shared ? '<div class="banner">Demo mode · sample notes are shown, and what you write stays in this browser.</div>' : "") + content;
}
// 포스터 레이아웃(왼쪽 정보 칸 + 큰 제목 + 목록): 게시판·단어장이 함께 쓴다. 홈과 같은 가로 행을 공유한다.
function posterPage({title,sub,action = "",label = "Info and filters",bottom,body}) {
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
  const write = chat ? '<button type="button" class="primary" data-new-chat>＋ Write</button>' : '<button type="button" class="primary" data-new-note>＋ Write</button>';
  const blank = chat ? emptyAction("No posts yet. Write the first one.",'<button type="button" data-new-chat>＋ Write</button>') :
    emptyAction("No notes yet. Leave the first one.",'<button type="button" data-new-note>＋ Write</button>');
  const names = [[0,"All members"],...members.map((name,index) => [index + 1,name]).filter(([,name]) => name)];
  return posterPage({title:chat ? "Free board" : "Study board",sub:chat ? "Say hi and cheer each other on" : "English study notes from the group",action:write,label:"Board info and filters",
    bottom:`<nav class="pr-group" aria-label="Board type"><b>Board</b><a href="#feed" ${chat ? "" : 'aria-current="page"'}>Study board</a><a href="#feed/chat" ${chat ? 'aria-current="page"' : ""}>Free board</a></nav>
      <div class="pr-group"><b>This week</b><span>${weekCount("study")} notes</span><span>${weekCount("chat")} posts</span><span>${members.filter(Boolean).length} members</span></div>
      <div class="pr-group" role="group" aria-label="Members"><b>Members</b>${names.map(([id,name]) => `<button type="button" data-lab-member="${id}" aria-pressed="${labMember === id}">${e(name)}</button>`).join("")}</div>`,
    body:`<div class="stack">${shown.items.map(chat ? chatCard : postCard).join("") || blank}</div>${shown.nav}`});
}
function renderWords(key) {
  const quizView = key !== "list";
  const nav = `<nav class="pr-group" aria-label="Vocab view"><b>Vocab</b><a href="#words" ${quizView ? 'aria-current="page"' : ""}>Quiz</a><a href="#words/list" ${quizView ? "" : 'aria-current="page"'}>Word list</a></nav>`;
  if (quizView) {
    return posterPage({title:"Vocab",sub:"Take quizzes with the words we collect",label:"Vocab info",
      bottom:nav + `<div class="pr-group"><b>This week</b><span>${inPeriod(board.words,"week").length} new words</span><span>${board.words.length} total</span></div>`,
      body:studyPanel() + renderQuiz()});
  }
  const words = sorted(wordSelection());
  const names = [[0,"All members"],...members.map((name,index) => [index + 1,name]).filter(([,name]) => name)];
  return posterPage({title:"Vocab",sub:"English words and phrases we collect",action:'<button type="button" class="primary" data-new-word>＋ Add a word</button>',label:"Vocab info and filters",
    bottom:nav + `<div class="pr-group" role="group" aria-label="View"><b>View</b><button type="button" data-wview="all" aria-pressed="${wordView === "all"}">By word</button><button type="button" data-wview="group" aria-pressed="${wordView === "group"}">By note</button></div>
      <div class="pr-group"><b>Words</b><span>${words.length}</span></div>
      <div class="pr-group" role="group" aria-label="Author"><b>Members</b>${names.map(([id,name]) => `<button type="button" data-word-member="${id}" aria-pressed="${wordMember === id}">${e(name)}</button>`).join("")}</div>`,
    body:wordView === "group" ? groupedWords(words) : wordList(words)});
}
function renderPost(id) {
  const post = board.posts.find(item => item.id === id);
  if (!post) return '<a class="back" href="#feed"><span class="ar l" aria-hidden="true"></span>Study board</a>' + empty("Note not found.");
  const words = board.words.filter(word => word.post_id === id);
  const link = safeLink(post.link);
  const notes = readNotes(post.body);
  const body = notes ? `<div class="study-notes">
    ${notes.summary ? `<section><h2>Summary</h2><p class="prose">${e(notes.summary)}</p></section>` : ""}
    ${notes.reflection ? `<section><h2>My thoughts</h2><p class="prose">${e(notes.reflection)}</p></section>` : ""}
    ${notes.sentence ? `<section><h2>Key sentence</h2><blockquote lang="en">${e(notes.sentence)}</blockquote></section>` : ""}
  </div>` : `<div class="prose"><p>${e(post.body)}</p></div>`;
  const chatPost = boardKind(post) === "chat";
  return `<a class="back" href="${chatPost ? "#feed/chat" : "#feed"}"><span class="ar l" aria-hidden="true"></span>${chatPost ? "Free board" : "Study board"}</a><article class="card">${chatPost ? "" : `<h1>${e(post.title)}</h1>`}${meta(post)}${body}
  <div class="post-actions">${reactionButton(post,true)}<a class="comment-link" href="#post/${e(post.id)}/comment"><span class="ic chat" aria-hidden="true"></span>Comment · ${commentCount(post)}</a></div>
  ${link ? `<p><a class="back" href="${e(link)}" target="_blank" rel="noopener noreferrer">Reference link<span class="ar ne" aria-hidden="true"></span></a></p>` : ""}
  ${own[id] ? '<div class="row"><button data-edit>Edit</button><button data-delete>Delete</button></div>' : ""}</article>
  ${commentsSection(post)}
  ${words.length ? `<h2 class="section-title">Words in this note</h2><div class="toolbar">${quizButton("post","Quiz this note’s words",words)}</div><div class="stack">${words.map(word => wordCard(word,3,false)).join("")}</div>` : ""}`;
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
    const wrongBox = wrong.length ? `<div class="wrong-box"><h3>Retry missed words</h3><p class="hint">${wrong.length} ${wrong.length === 1 ? "word" : "words"} missed in past quizzes. Get one right and it leaves the list.</p>
      <ul class="wrong-list">${wrong.slice(0,6).map(word => `<li><strong lang="en">${e(word.term)}</strong><span>${e(word.meaning)}</span></li>`).join("")}</ul>
      <div class="row"><button type="button" class="primary" data-quiz="review">Retry ${wrong.length} missed ${wrong.length === 1 ? "word" : "words"}</button></div></div>` : "";
    const options = [quizButton("week","This week’s words",inPeriod(board.words,"week")),quizButton("all","All words",board.words)].join("");
    return `<section class="card quiz"><h2>Choose a quiz range</h2>${options
      ? `${wrongBox}<p>Pick a range for up to 10 questions.</p><div class="row">${options}</div>`
      : "<p>No words to quiz yet. Add words while you write a note.</p>"}</section>`;
  }
  const total = quiz.words.length;
  const word = quiz.words[quiz.index];
  if (!word) {
    return `<section class="card quiz"><h2>Quiz complete</h2><p>You got ${total - quiz.missed.length} of ${total} right.</p>${quiz.missed.length ? '<p class="hint">Missed words are saved for review.</p>' : ""}
    <div class="row">${quiz.missed.length ? '<button class="primary" data-quiz="retry">Retry missed words only</button>' : ""}<button data-quiz="reset">Choose another range</button></div></section>`;
  }
  return `<section class="card quiz"><h2>Word quiz</h2><p class="hint">${quiz.index + 1} / ${total}</p>
  <progress value="${quiz.index}" max="${total}" aria-label="Quiz progress"></progress><h2 lang="en">${e(word.term)}</h2>
  ${quiz.revealed ? `<p>${e(word.meaning)}</p>${word.example ? `<p lang="en">${e(word.example)}</p>` : ""}
    <div class="row"><button class="primary" data-answer="correct">Got it</button><button data-answer="missed">Review again</button></div>` :
    '<p>Try to recall the meaning.</p><div class="row"><button class="primary" data-reveal>Show answer</button></div>'}</section>`;
}
function wordFields(word = {}, removable = true) {
  return `<fieldset class="word-fields" data-word-id="${e(word.id)}">
  <label>English word or phrase<input name="term" required maxlength="120" value="${e(word.term)}"></label>
  <label>Korean meaning<input name="meaning" required maxlength="300" value="${e(word.meaning)}"></label>
  <label>Example (optional)<input name="example" maxlength="600" value="${e(word.example)}"></label>
  ${removable ? '<button type="button" data-remove-word>Remove word</button>' : ""}</fieldset>`;
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
const authorOptions = post => members.map((name,index) => name ? `<option value="${index+1}">${e(name)}</option>` : "").join("") + (post?.author === 0 ? '<option value="0">Other</option>' : "");
// 사담·응원: a short plain message with no title, words or link.
function openChatEditor(post) {
  const selected = post ?? {author:readLocal("active-member",0),author_name:""};
  editorChanged = false;
  editor.innerHTML = `<div class="dialog-head"><h2 id="editor-title">${post ? "Edit post" : "Write"}</h2><button type="button" data-close aria-label="Close">✕</button></div>
  <form novalidate><p class="hint">Author · <strong>${writerName(post)}</strong></p><label class="sr-only">Author<select name="author" disabled>${authorOptions(post)}</select></label>
  <label data-guest>Display name<input name="author_name" maxlength="40" value="${e(selected.author_name)}"></label>
  <label>Message<textarea name="body" required maxlength="1000" rows="6" placeholder="Today’s story, a cheer, a chat — anything goes.">${e(post?.body ?? "")}</textarea></label>
  <div class="row"><button class="primary" type="submit">${post ? "Save changes" : "Post"}</button></div>
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
    if (selected.author === 0 && !guestName) return showFormError(form,"Enter a display name.",[form.elements.author_name]);
    if (!text) return showFormError(form,"Enter a message.",[form.elements.body]);
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
      flash("Posted.");
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
  const heading = standalone ? "Add a word" : post ? "Edit note" : source ? "Write about this item" : "Write";
  target.innerHTML = `<div class="dialog-head"><h2 id="${pre}-title">${heading}</h2><button type="button" data-close aria-label="Close">✕</button></div>
  <form novalidate><p class="hint">Author · <strong>${writerName(post)}</strong></p><label class="sr-only">Author<select name="author" disabled>${authorOptions(post)}</select></label>
  <label data-guest>Display name<input name="author_name" maxlength="40" value="${e(selected.author_name)}"></label>
  ${standalone ? "" : `<label>Title<input name="title" required maxlength="150" value="${e(post?.title ?? source?.title.slice(0,150))}"></label>
  <label>Summary<textarea name="summary" required maxlength="12000" rows="3" placeholder="Sum up what this item is about.">${e(notes.summary)}</textarea></label>
  <label>My thoughts<textarea name="reflection" maxlength="4000" rows="3" placeholder="What you learned or what you think.">${e(notes.reflection)}</textarea></label>
  <label>Key sentence<input name="sentence" lang="en" maxlength="500" value="${e(notes.sentence)}" placeholder="The English sentence you found most important"></label>
  <label>Reference link (optional)<input type="url" name="link" value="${e(post?.link ?? source?.url)}" maxlength="2000" placeholder="https://"></label>
  ${tagOptions(post?.tag ?? (source ? source.type === "video" ? "Video" : "Article" : ""))}`}
  <div class="stack" data-words>${standalone ? wordFields({},false) : words.map(word => wordFields(word)).join("")}</div>
  <div class="row">${standalone ? "" : '<button type="button" data-add-word>＋ Add a word</button>'}<button class="primary" type="submit">${standalone ? "Add" : post ? "Save changes" : "Post note"}</button></div>
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
    if (selected.author === 0 && !entry.author_name) problems.push(["Enter a display name.",[form.elements.author_name]]);
    if (!standalone) {
      const missing = [!entry.title && form.elements.title,!summary && form.elements.summary].filter(Boolean);
      if (missing.length === 2) problems.push(["Enter a title and summary.",missing]);
      else if (!entry.title) problems.push(["Enter a title.",[form.elements.title]]);
      else if (!summary) problems.push(["Enter a summary.",[form.elements.summary]]);
    }
    const incomplete = [...form.querySelectorAll("fieldset")].flatMap(field => [field.querySelector('[name="term"]'),field.querySelector('[name="meaning"]')]).filter(input => !input.value.trim());
    if (incomplete.length) problems.push(["Enter both the word and its meaning.",incomplete]);
    if (entry.link && !safeLink(entry.link)) problems.push(["The reference link must start with https://.",[form.elements.link]]);
    if ([...body].length > 12000) problems.push(["This is too long to save. Shorten the summary a little.",[form.elements.summary]]);
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
        host.innerHTML = `<div class="dialog-head"><h2 id="writer-title">Saved</h2><button type="button" data-close aria-label="Close">✕</button></div>
          <p>Your note is posted. You can keep viewing the item.</p>
          <div class="row"><a class="writer-link" href="#post/${e(id)}">View your note</a><button type="button" data-write-again>Write another</button></div>`;
        studied();
        flash("Saved.");
        return;
      }
      editor.close();
      if (standalone) { period = "all"; wordMember = 0; }
      await refresh();
      studied();
      location.hash = standalone ? "words/list" : "post/" + id;
      flash("Saved.");
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
  if (!editorChanged || confirm("Unsaved changes will be lost. Close?")) editor.close();
}
editor.addEventListener("cancel",event => { event.preventDefault(); closeEditor(); });
function formClick(event, container, close) {
  if (event.target.closest("[data-close]")) close();
  if (event.target.closest("[data-add-word]")) {
    const fields = container.querySelector("[data-words]");
    if (fields.children.length >= 20) return flash("A note can have up to 20 words.");
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
  if (editorChanged && host.querySelector("form") && !confirm("Unsaved changes will be lost. Close?")) return;
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
      overlayEl.querySelector(".tv-writer form") && !confirm("Unsaved changes will be lost. Close?")) event.stopImmediatePropagation();
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
    error.textContent = "Enter a comment.";
    error.hidden = false;
    form.elements.text.setAttribute("aria-invalid","true");
    form.elements.text.focus();
    return;
  }
  const member = activeMember();
  if (!members[member - 1]) { chooseMember(() => form.requestSubmit()); return; }
  addComment(form.dataset.commentForm,member,text);
  render();
  flash("Comment posted.");
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
    if (!confirm("Delete this comment? This cannot be undone.")) return;
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
    if (!confirm("Delete this post? This cannot be undone.")) return;
    button.disabled = true;
    try {
      await removePost(data.deleteId,own[data.deleteId]);
      delete own[data.deleteId];
      writeLocal("own",own);
      await refresh();
      flash("Post deleted.");
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
    return target && boardKind(target) === "chat" ? "Delete this post? This cannot be undone." : `The ${count} linked ${count === 1 ? "word" : "words"} will be deleted too. This cannot be undone.`;
  })())) {
    button.disabled = true;
    try {
      await removePost(id,own[id]);
      delete own[id];
      writeLocal("own",own);
      location.hash = "feed";
      await refresh();
      flash("Deleted.");
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
  if (!members.length) return flash("Try again after the member list loads.");
  const active = readLocal("active-member",0);
  memberPicker.innerHTML = `<div class="dialog-head"><h2 id="member-picker-title">Choose your name</h2></div>
    <p class="hint">Your notes and words are posted under this name.</p>
    <form method="dialog"><label>Member<select name="member" required>
      <option value="">Select your name</option>
      ${members.map((name,index) => `<option value="${index+1}" ${active === index+1 ? "selected" : ""}>${e(name)}</option>`).join("")}
    </select></label><button class="primary">Start with this name</button></form>`;
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
  document.querySelector("#choose-member").textContent = name ? name + " ▾" : "Choose your name";
}
document.querySelector("#choose-member").onclick = () => chooseMember();
const memberDrawer = document.querySelector("#member-drawer");
memberDrawer.addEventListener("click",event => {
  if (event.target === memberDrawer || event.target.closest("#members a")) memberDrawer.close();
});
document.querySelector("#rename-members").onclick = () => {
  memberDrawer.close();
  if (!shared) return flash("Members cannot be added in demo mode.");
  memberEditor.innerHTML = `<div class="dialog-head"><h2 id="member-editor-title">Admin · Add a member</h2></div>
    <form><label>Admin email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <label>New member name<input name="name" required maxlength="24"></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="row"><button class="primary" type="submit">Add member</button><button type="button" id="cancel-rename">Cancel</button></div></form>`;
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
      flash("Member added.");
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
