import {members as defaultMembers} from "./config.js";
import {renderMedia,leaveMedia,mediaClick,setLandingFilter} from "./media.js";
import {renderHome,leaveHome} from "./home.js";
import {pagerHtml,pageCount,PER_PAGE} from "./pager.js";
import {shared, readLocal, writeLocal, loadBoard, saveEntry, removePost, updateWord, removeWord, addMember, studyState, streakOf, recordStudy, readReactions, toggleReaction, readComments, addComment, removeComment, dayKey, MAX_HEARTS, HEART_EVERY} from "./data.js";

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
// Line breaks (DESIGN.md 2.6): glue short words to the next word, numbers to their unit and month names to the day,
// so a line never ends in "a", "of" or "in" and "Nov. 16" or "25 articles" never splits.
const GLUE_WORDS = /\b(a|an|the|and|or|of|to|in|on|for|with|at|by|from|as|is|are|not|your|our|this|that|my|its|I)[ \t]+(?=\S)/gi;
const GLUE_MONTH = /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?[ \t]+(?=\d)/g;
function glue(root = document.body) {
  const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode: node =>
    !node.nodeValue.trim() || node.parentElement?.closest("script,style,textarea,input,select,option,[data-no-glue]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
  const nodes = [];
  for (let node; (node = walker.nextNode());) nodes.push(node);
  for (const node of nodes) {
    const next = node.nodeValue.replace(GLUE_WORDS,"$1\u00A0").replace(GLUE_MONTH,match => match.replace(/[ \t]+$/,"\u00A0"))
      .replace(/(\d)[ \t]+(?=[A-Za-z])/g,"$1\u00A0").replace(/[ \t]+·[ \t]+/g,"\u00A0· ");
    // The last two words of a block stay together, so no block ends with one word alone on its line.
    const tail = node === node.parentElement.lastChild && node.parentElement.matches("p,li,dd,h1,h2,h3,h4,blockquote,.snippet,.hint,.meta")
      ? next.replace(/[ \t]+(\S+\s*)$/,"\u00A0$1") : next;
    if (tail !== node.nodeValue) node.nodeValue = tail;
  }
}
let glueQueued = false;
new MutationObserver(() => {
  if (glueQueued) return;
  glueQueued = true;
  setTimeout(() => { glueQueued = false; glue(); },0);
}).observe(document.body,{childList:true,subtree:true});
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
  return `<div class="meta"><span>${monogram(item)}${authorLink(item)}</span><time datetime="${e(item.created_at)}">${dateFormat.format(new Date(item.created_at))}</time>${item.tag && item.tag !== "Pinned" ? `<span class="tag">${e(item.tag)}</span>` : ""}</div>`;
}
// ---- Writing: a Note follows the form of its subject (one master list); a Post is plain text ----
// To add a subject (Grammar, Writing ...) add one entry here. "required" fields must be filled; "quote" fields are shown as a quotation.
const SUBJECTS = {
  Article:{hint:"Read something? Capture what it says and what you think.",fields:[
    {label:"Summary",hint:"Sum up what this article is about.",required:true,rows:3},
    {label:"My thoughts",hint:"What you learned or what you think.",required:true,rows:3},
    {label:"Key sentence",hint:"Your key English sentence",quote:true,lang:"en"}]},
  Video:{hint:"Watched something? Capture the main idea and a line to steal.",fields:[
    {label:"Summary",hint:"What is the video about?",required:true,rows:3},
    {label:"My thoughts",hint:"What stayed with you?",required:true,rows:3},
    {label:"Key sentence",hint:"A line you want to say yourself",quote:true,lang:"en"}]},
  TOEIC:{hint:"Studying for the test? Record the question and why you missed it.",fields:[
    {label:"Part",choices:["Part 1","Part 2","Part 3","Part 4","Part 5","Part 6","Part 7"]},
    {label:"What I got wrong",hint:"Paste the question or describe it.",required:true,rows:3},
    {label:"Why",hint:"Why did you choose the wrong answer?",required:true,rows:3},
    {label:"Rule to remember",hint:"The rule in one line",quote:true},
    {label:"Example",hint:"A new example sentence",lang:"en"}]},
  Speaking:{hint:"Practised speaking? Keep what you said and how to say it better.",fields:[
    {label:"Topic",hint:"What was the topic?",required:true},
    {label:"My answer",hint:"What you said, or the script",required:true,rows:3},
    {label:"Better phrases",hint:"Phrases you want to use next time",quote:true,rows:2,lang:"en"},
    {label:"Next time",hint:"One thing to improve"}]},
  Other:{hint:"Anything else. One box, no required sections.",fields:[
    {label:"Notes",hint:"Write anything…",required:true,rows:6}]}
};
const SUBJECT_NAMES = Object.keys(SUBJECTS);
const notesPrefix = "study-notes:v2\n";
const notesPrefixV1 = "study-notes:v1\n";
// Returns {subject, sections:[{label,text}]}; the first version (summary / reflection / sentence) is read as an Article note.
function readNotes(body = "") {
  try {
    if (body.startsWith(notesPrefix)) {
      const data = JSON.parse(body.slice(notesPrefix.length));
      if (Array.isArray(data?.sections) && data.sections.every(item => typeof item?.label === "string" && typeof item?.text === "string"))
        return {subject:SUBJECTS[data.subject] ? data.subject : "Other",sections:data.sections};
    } else if (body.startsWith(notesPrefixV1)) {
      const old = JSON.parse(body.slice(notesPrefixV1.length));
      if ([old?.summary,old?.reflection,old?.sentence].every(value => typeof value === "string"))
        return {subject:"Article",sections:[["Summary",old.summary],["My thoughts",old.reflection],["Key sentence",old.sentence]].filter(([,text]) => text).map(([label,text]) => ({label,text}))};
    }
  } catch { /* Display the saved text if it cannot be decoded. */ }
  return null;
}
const isQuote = (subject, label) => Boolean(SUBJECTS[subject]?.fields.find(field => field.label === label)?.quote);
const isPinned = post => post.tag === "Pinned";
// A Note has a saved form (or, for old plain-text notes, a subject tag); everything else is a Post.
const isNote = post => Boolean(readNotes(post.body)) || SUBJECT_NAMES.includes(post.tag);
const pinFirst = list => [...list.filter(isPinned),...list.filter(post => !isPinned(post))];
const pinIcon = '<span class="ic pin" role="img" aria-label="Pinned"></span>';
function postCard(post, index) {
  const notes = readNotes(post.body);
  const preview = notes ? notes.sections[0]?.text ?? "" : post.body;
  return `<article class="card post-preview" style="--post-delay:${Math.min(index,8)*45}ms"><h2>${isPinned(post) ? pinIcon : ""}<a href="#post/${e(post.id)}">${e(post.title)}</a></h2>${meta(post)}<p class="snippet">${e(preview)}</p>${postActions(post)}</article>`;
}
function wordCard(word, level = 2, noteLink = true) {
  return `<article class="card"><h${level}>${e(word.term)}</h${level}><p>${e(word.meaning)}</p>${word.example ? `<p lang="en">${e(word.example)}</p>` : ""}<div class="meta">${authorLink(word)}${noteLink && word.post_id ? `<a href="#post/${e(word.post_id)}">View note</a>` : ""}</div>${wordActions(word)}</article>`;
}
const plural = (n, word) => `${n} ${n === 1 ? word : word + "s"}`;
const empty = message => `<div class="card empty">${e(message)}</div>`;
const emptyAction = (message, action) => `<div class="card empty"><p>${e(message)}</p><p>${action}</p></div>`;
const activeMember = () => readLocal("active-member",0);
// A post is yours if this browser wrote it (it has the edit key) or it carries the name chosen at the top right.
// A word is yours if it carries the name chosen at the top right.
const canManageWord = word => word.author > 0 && word.author === activeMember();
const wordActions = word => canManageWord(word) ? `<div class="row word-actions"><button type="button" data-edit-word="${e(word.id)}">Edit</button><button type="button" data-delete-word="${e(word.id)}">Delete</button></div>` : "";
const canManage = post => Boolean(own[post.id]) || (post.author > 0 && post.author === activeMember());
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
    ${list.map(word => `<div class="word-row"><strong lang="en">${e(word.term)}</strong><span>${e(word.meaning)}</span>${word.example ? `<em lang="en">${e(word.example)}</em>` : ""}${wordActions(word)}</div>`).join("")}
  </section>`).join("")}</div>${shown.nav}`;
}
function chatCard(post) {
  return `<article class="card chat-post"><p class="chat-body">${e(post.body)}</p>
    <div class="meta"><span>${monogram(post)}${e(author(post))}</span><time datetime="${e(post.created_at)}">${dateFormat.format(new Date(post.created_at))}</time></div>
    ${postActions(post)}
    ${canManage(post) ? `<div class="row"><button type="button" data-edit-id="${e(post.id)}">Edit</button><button type="button" data-delete-id="${e(post.id)}">Delete</button></div>` : ""}</article>`;
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
  const [page, key, claimToken] = (location.hash.slice(1) || "home").split("/");
  // A private link (#claim/<post>/<key>) lets this browser edit or delete that post, like the browser that wrote it.
  if (page === "claim" && key && claimToken) {
    own[key] = claimToken;
    writeLocal("own",own);
    location.replace("#post/" + key);
    flash("You can edit this post from this browser now.");
    return;
  }
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
  const found = sorted(board.posts.filter(post => boardKind(post) === kind && (!labMember || post.author === labMember)));
  const posts = chat ? found : pinFirst(found);
  const shown = paged("feed",posts);
  const weekCount = which => inPeriod(board.posts.filter(post => boardKind(post) === which),"week").length;
  const write = chat ? '<button type="button" class="primary" data-new-chat><span class="ic plus" aria-hidden="true"></span>Write</button>' : '<button type="button" class="primary" data-new-note><span class="ic plus" aria-hidden="true"></span>Write</button>';
  const blank = chat ? emptyAction("No posts yet. Write the first one.",'<button type="button" data-new-chat><span class="ic plus" aria-hidden="true"></span>Write</button>') :
    emptyAction("No notes yet. Leave the first one.",'<button type="button" data-new-note><span class="ic plus" aria-hidden="true"></span>Write</button>');
  const names = [[0,"All members"],...members.map((name,index) => [index + 1,name]).filter(([,name]) => name)];
  return posterPage({title:chat ? "Free board" : "Study board",sub:chat ? "Say hi and cheer each other on" : "English study notes from the group",action:write,label:"Board info and filters",
    bottom:`<nav class="pr-group" aria-label="Board type"><b>Board</b><a href="#feed" ${chat ? "" : 'aria-current="page"'}>Study board</a><a href="#feed/chat" ${chat ? 'aria-current="page"' : ""}>Free board</a></nav>
      <div class="pr-group"><b>This week</b><span>${plural(weekCount("study"),"note")}</span><span>${plural(weekCount("chat"),"post")}</span><span>${plural(members.filter(Boolean).length,"member")}</span></div>
      <div class="pr-group" role="group" aria-label="Members"><b>Members</b>${names.map(([id,name]) => `<button type="button" data-lab-member="${id}" aria-pressed="${labMember === id}">${e(name)}</button>`).join("")}</div>`,
    body:`<div class="stack">${shown.items.map(chat ? chatCard : postCard).join("") || blank}</div>${shown.nav}`});
}
function renderWords(key) {
  const quizView = key !== "list";
  const nav = `<nav class="pr-group" aria-label="Vocab view"><b>Vocab</b><a href="#words" ${quizView ? 'aria-current="page"' : ""}>Quiz</a><a href="#words/list" ${quizView ? "" : 'aria-current="page"'}>Word list</a></nav>`;
  if (quizView) {
    return posterPage({title:"Vocab",sub:"Take quizzes with the words we collect",label:"Vocab info",
      bottom:nav + `<div class="pr-group"><b>This week</b><span>${plural(inPeriod(board.words,"week").length,"new word")}</span><span>${board.words.length} total</span></div>`,
      body:studyPanel() + renderQuiz()});
  }
  const words = sorted(wordSelection());
  const names = [[0,"All members"],...members.map((name,index) => [index + 1,name]).filter(([,name]) => name)];
  return posterPage({title:"Vocab",sub:"English words and phrases we collect",action:'<button type="button" class="primary" data-new-word><span class="ic plus" aria-hidden="true"></span>Add a word</button>',label:"Vocab info and filters",
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
  const body = notes ? `<div class="study-notes">${notes.sections.map(item => `<section>${item.label ? `<h2>${e(item.label)}</h2>` : ""}${isQuote(notes.subject,item.label) ? `<blockquote lang="en">${e(item.text)}</blockquote>` : `<p class="prose">${e(item.text)}</p>`}</section>`).join("")}</div>` : `<div class="prose"><p>${e(post.body)}</p></div>`;
  const chatPost = boardKind(post) === "chat";
  return `<a class="back" href="${chatPost ? "#feed/chat" : "#feed"}"><span class="ar l" aria-hidden="true"></span>${chatPost ? "Free board" : "Study board"}</a><article class="card">${chatPost ? "" : `<h1>${isPinned(post) ? pinIcon : ""}${e(post.title)}</h1>`}${meta(post)}${body}
  <div class="post-actions">${reactionButton(post,true)}<a class="comment-link" href="#post/${e(post.id)}/comment"><span class="ic chat" aria-hidden="true"></span>Comment · ${commentCount(post)}</a></div>
  ${link ? `<p><a class="back" href="${e(link)}" target="_blank" rel="noopener noreferrer">Reference link<span class="ar ne" aria-hidden="true"></span></a></p>` : ""}
  ${canManage(post) ? '<div class="row"><button data-edit>Edit</button><button data-delete>Delete</button></div>' : ""}</article>
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
  quiz = {words:shuffled.slice(0,10),index:0,revealed:false,missed:[],hints:{},choices:{},picked:null,loading:true};
  const started = quiz;
  if (location.hash === "#words" || location.hash === "#words/quiz") render();
  else location.hash = "words";
  loadHints(started);
}
async function loadHints(started) {
  try {
    const terms = started.words.map(word => word.term.trim().toLowerCase()).filter(term => /^[a-z' -]{1,40}$/.test(term));
    if (terms.length) {
      const response = await fetch(`/api/quiz-options?v=2&terms=${encodeURIComponent(terms.join("|"))}`,{signal:AbortSignal.timeout(6000)});
      if (response.ok) started.hints = (await response.json()).options ?? {};
    }
  } catch {}
  started.loading = false;
  if (quiz === started && (location.hash === "#words" || location.hash === "#words/quiz")) { render(); main.querySelector("[data-choice]")?.focus(); }
}
const meaningKey = text => text.replace(/[\s,;.]/g,"");
function choicesFor(word) {
  if (quiz.choices[word.id]) return quiz.choices[word.id];
  const correct = word.meaning.trim();
  const taken = new Set([meaningKey(correct)]);
  const clash = text => [...taken].some(key => key.includes(meaningKey(text)) || meaningKey(text).includes(key));
  const shuffle = list => list.map(item => [Math.random(),item]).sort((a,b) => a[0] - b[0]).map(pair => pair[1]);
  const picks = [];
  const add = list => { for (const text of list) { if (picks.length < 3 && text && text.length <= 40 && !clash(text)) { picks.push(text); taken.add(meaningKey(text)); } } };
  add(shuffle(quiz.hints[word.term.trim().toLowerCase()] ?? []));
  add(shuffle([...new Set(board.words.map(item => item.meaning.trim()))]));
  const list = picks.length ? shuffle([correct,...picks]) : [];
  return quiz.choices[word.id] = list.length >= 2 ? list.map(text => ({text,right:text === correct})) : [];
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
  if (quiz.loading) return `<section class="card quiz"><h2>Word quiz</h2><p class="hint" role="status">Preparing choices…</p></section>`;
  const choices = choicesFor(word);
  const head = `<h2>Word quiz</h2><p class="hint">${quiz.index + 1} / ${total}</p>
  <progress value="${quiz.index}" max="${total}" aria-label="Quiz progress"></progress><h2 lang="en">${e(word.term)}</h2>`;
  if (choices.length) {
    const done = quiz.picked !== null;
    const list = choices.map((choice,index) => {
      const state = !done ? "" : choice.right ? " is-right" : index === quiz.picked ? " is-wrong" : "";
      const mark = !done ? "" : choice.right ? '<span class="ic check" aria-hidden="true"></span>' : index === quiz.picked ? '<span aria-hidden="true">✕</span>' : "";
      return `<button type="button" class="choice${state}" data-choice="${index}" ${done ? "disabled" : ""}><span lang="ko">${e(choice.text)}</span>${mark}</button>`;
    }).join("");
    const right = done && choices[quiz.picked].right;
    return `<section class="card quiz">${head}<p>Pick the meaning.</p><div class="choices" role="group" aria-label="Meanings">${list}</div>
    ${done ? `<p role="status">${right ? "Correct." : `Not quite. It means ${e(word.meaning)}.`}</p>${word.example ? `<p lang="en">${e(word.example)}</p>` : ""}
    <div class="row"><button type="button" class="primary" data-next>${quiz.index + 1 < total ? "Next" : "Finish"}</button></div>` : ""}</section>`;
  }
  return `<section class="card quiz">${head}
  ${quiz.revealed ? `<p>${e(word.meaning)}</p>${word.example ? `<p lang="en">${e(word.example)}</p>` : ""}
    <div class="row"><button class="primary" data-answer="correct">Got it</button><button data-answer="missed">Review again</button></div>` :
    '<p>Try to recall the meaning.</p><div class="row"><button class="primary" data-reveal>Show answer</button></div>'}</section>`;
}
function wordFields(word = {}, removable = true) {
  return `<fieldset class="word-fields" data-word-id="${e(word.id)}">
  <label>English word or phrase<input name="term" required maxlength="120" autocomplete="off" placeholder="e.g. christmas" value="${e(word.term)}"></label>
  <div class="suggest" data-suggest role="group" aria-label="Suggested words"></div>
  <p class="hint" data-define lang="en" hidden></p>
  <label>Korean meaning<input name="meaning" required maxlength="300" autocomplete="off" value="${e(word.meaning)}"></label>
  <p class="hint" data-fill-meaning hidden>Suggested · edit if needed</p>
  <label>Example (optional)<input name="example" maxlength="600" autocomplete="off" value="${e(word.example)}"></label>
  <p class="hint" data-fill-example hidden>Suggested · edit if needed</p>
  ${removable ? '<button type="button" data-remove-word>Remove word</button>' : ""}</fieldset>`;
}
// ---- Word lookup: suggested words while typing, then a suggested Korean meaning and example that stay editable ----
// Free services, only the typed word is sent: Datamuse (suggestions), Free Dictionary (English definition and example), Microsoft Translator through our server (Korean), with MyMemory as the backup.
const lookupCache = new Map();
const getJson = async url => {
  const response = await fetch(url,{signal:AbortSignal.timeout(6000)});
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
};
const suggestWords = async text => (await getJson(`https://api.datamuse.com/sug?s=${encodeURIComponent(text)}&max=6`)).map(item => item.word).filter(word => word.toLowerCase() !== text.toLowerCase());
async function translateKorean(key) {
  try {
    if (/^[a-z' -]{1,60}$/.test(key)) {
      const ours = await getJson(`/api/translate?v=2&term=${encodeURIComponent(key)}`);
      if (ours.configured) return String(ours.korean ?? "").trim();
    }
  } catch {}
  const backup = await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(key)}&langpair=en|ko`);
  return String(backup?.responseData?.translatedText ?? "").trim();
}
async function lookupWord(term) {
  const key = term.toLowerCase().replace(/\s+/g," ");
  if (lookupCache.has(key)) return lookupCache.get(key);
  const [dictionary,translation] = await Promise.allSettled([
    getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`),
    translateKorean(key)]);
  const meaning = dictionary.status === "fulfilled" ? dictionary.value[0]?.meanings?.[0] : null;
  let korean = translation.status === "fulfilled" ? translation.value : "";
  // The free translator sometimes answers a plain word with a whole sentence; only short Korean answers are used.
  const parts = korean.split(/\s+/).length;
  if (/[A-Za-z]{3,}/.test(korean) || parts > key.split(" ").length + 1 || korean.length > 14) korean = "";
  const result = {korean,definition:meaning ? `${meaning.partOfSpeech}: ${meaning.definitions[0].definition}` : "",
    example:dictionary.status === "fulfilled" ? dictionary.value[0]?.meanings?.flatMap(item => item.definitions).find(item => item.example)?.example ?? "" : ""};
  // A failed translation is not remembered, so the next try can succeed.
  if (translation.status === "fulfilled") lookupCache.set(key,result);
  return result;
}
async function fillWord(box, term) {
  try {
    const found = await lookupWord(term);
    if (box.querySelector('[name="term"]').value.trim().toLowerCase() !== term.toLowerCase()) return;
    const define = box.querySelector("[data-define]");
    define.textContent = found.definition;
    define.hidden = !found.definition;
    for (const [name,value,note] of [["meaning",found.korean,"[data-fill-meaning]"],["example",found.example,"[data-fill-example]"]]) {
      const input = box.querySelector(`[name="${name}"]`);
      // A value this lookup filled earlier is replaced by the next lookup; anything the person typed is never touched.
      if (input.dataset.touched || (input.value && input.dataset.auto !== "1")) continue;
      input.value = value;
      input.dataset.auto = value ? "1" : "";
      box.querySelector(note).hidden = !value;
    }
  } catch { /* A failed lookup just leaves the fields as they are. */ }
}
const wordTimers = new WeakMap();
document.addEventListener("input",event => {
  const input = event.target;
  if (!input.matches?.(".word-fields input")) return;
  const box = input.closest(".word-fields");
  if (input.name === "meaning" || input.name === "example") {
    if (event.isTrusted) { input.dataset.touched = "1"; box.querySelector(`[data-fill-${input.name}]`).hidden = true; }
    return;
  }
  if (input.name !== "term") return;
  clearTimeout(wordTimers.get(box));
  const text = input.value.trim();
  const chips = box.querySelector("[data-suggest]");
  if (text.length < 2) { chips.replaceChildren(); return; }
  wordTimers.set(box,setTimeout(async () => {
    try {
      const list = await suggestWords(text);
      if (input.value.trim() === text) chips.replaceChildren(...list.map(word => {
        const chip = document.createElement("button");
        chip.type = "button"; chip.className = "chip"; chip.dataset.suggestWord = word; chip.textContent = word;
        return chip;
      }));
    } catch { chips.replaceChildren(); }
    fillWord(box,text);
  },450));
});
document.addEventListener("click",event => {
  const chip = event.target.closest?.("[data-suggest-word]");
  if (!chip) return;
  const box = chip.closest(".word-fields");
  const input = box.querySelector('[name="term"]');
  input.value = chip.dataset.suggestWord;
  box.querySelector("[data-suggest]").replaceChildren();
  editorChanged = true;
  fillWord(box,input.value.trim());
  box.querySelector('[name="meaning"]').focus();
});
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
// ---- Write: Note (the form follows its subject) or Post (plain text, optionally pinned) ----
const fieldHtml = (field, index, value = "") => {
  const name = `field-${index}`;
  const optional = field.required ? "" : " (optional)";
  if (field.choices) return `<fieldset class="tag-options"><legend>${e(field.label)}${optional}</legend>${["",...field.choices].map(choice => `<label class="chip-radio"><input type="radio" name="${name}" value="${e(choice)}" ${choice === value ? "checked" : ""}><span>${choice ? e(choice) : "None"}</span></label>`).join("")}</fieldset>`;
  const attrs = `name="${name}" maxlength="4000" placeholder="${e(field.hint ?? "")}"${field.lang ? ` lang="${field.lang}"` : ""}`;
  return field.rows ? `<label>${e(field.label)}${optional}<textarea ${attrs} rows="${field.rows}">${e(value)}</textarea></label>` :
    `<label>${e(field.label)}${optional}<input ${attrs} value="${e(value)}"></label>`;
};
const subjectChips = current => `<fieldset class="tag-options"><legend>What did you study?</legend>${SUBJECT_NAMES.map(name => `<label class="chip-radio"><input type="radio" name="subject" value="${e(name)}" ${name === current ? "checked" : ""}><span>${e(name)}</span></label>`).join("")}</fieldset>`;
const whereChips = current => `<fieldset class="tag-options"><legend>Where</legend>${[["study","Study board"],["chat","Free board"]].map(([value,label]) => `<label class="chip-radio"><input type="radio" name="where" value="${value}" ${value === current ? "checked" : ""}><span>${label}</span></label>`).join("")}</fieldset>`;
const joinList = items => items.length > 1 ? `${items.slice(0,-1).join(", ")} and ${items.at(-1)}` : items[0];

function openEditor(standalone, post, source, host, kind, editWord, seed) {
  if (!post && !members[readLocal("active-member",0) - 1]) {
    chooseMember(() => openEditor(standalone,post,source,host,kind,editWord,seed));
    return;
  }
  const pre = host ? "writer" : "editor";
  const target = host ?? editor;
  const selected = post ?? {author:readLocal("active-member",0),author_name:""};
  const editing = Boolean(post);
  const words = editing && !standalone ? board.words.filter(word => word.post_id === post.id) : [];
  const notes = editing ? readNotes(post.body) : null;
  let type = post ? (isNote(post) ? "note" : "post") : source ? "note" : kind === "chat" ? "post" : "note";
  const canSwitch = !standalone && !editing && !source;
  let subject = notes?.subject ?? (SUBJECT_NAMES.includes(post?.tag) ? post.tag : source?.type === "video" ? "Video" : "Article");
  const values = {};
  if (notes) for (const item of notes.sections) values[item.label] = item.text;
  else if (editing && type === "note") values[SUBJECTS[subject].fields.find(field => field.required).label] = post.body;   // an old plain-text note
  if (seed && !editing) {
    // Highlights made while reading: the first key sentences and any highlighted words not yet in the word list.
    const keyField = SUBJECTS[subject].fields.find(field => field.label === "Key sentence");
    if (keyField && seed.sentences.length) values[keyField.label] = seed.sentences.join(" / ").slice(0,3900);
  }
  let where = post ? boardKind(post) : kind === "chat" ? "chat" : "study";
  let pinned = editing && isPinned(post);
  // A note with sections of its own (not one of the subject forms, e.g. a guide) is edited section by section so nothing is lost.
  const formLabels = notes ? SUBJECTS[notes.subject].fields.map(field => field.label) : [];
  const custom = Boolean(notes && notes.sections.some(item => !formLabels.includes(item.label)));
  const customSections = custom ? notes.sections.map(item => ({...item})) : [];
  let title = post?.title ?? source?.title.slice(0,150) ?? "";
  let link = post?.link ?? source?.url ?? "";
  let bodyText = editing && type === "post" ? post.body : "";
  editorChanged = false;
  const heading = standalone ? (editWord ? "Edit word" : "Add a word") : editing ? (type === "note" ? "Edit note" : "Edit post") : source ? "Write about this item" : "Write";
  target.innerHTML = `<div class="dialog-head"><h2 id="${pre}-title">${heading}</h2><button type="button" data-close aria-label="Close">✕</button></div>
  <form novalidate><p class="hint">Author · <strong>${writerName(post)}</strong></p><label class="sr-only">Author<select name="author" disabled>${authorOptions(post)}</select></label>
  <label data-guest>Display name<input name="author_name" maxlength="40" value="${e(selected.author_name)}"></label>
  ${canSwitch ? `<div class="tv-seg type-seg" role="group" aria-label="Post type"><button type="button" data-type="note" aria-pressed="${type === "note"}">Note</button><button type="button" data-type="post" aria-pressed="${type === "post"}">Post</button></div>` : ""}
  <div class="compose" data-compose></div>
  <div class="stack" data-words>${standalone ? wordFields(editWord ?? {},false) : (seed && !editing ? seed.words.slice(0,8).map(term => wordFields({term})) : words).map(word => typeof word === "string" ? word : wordFields(word)).join("")}</div>
  <p class="hint nudge" data-nudge role="status" hidden>Add the words you learned from this note. Tap “Add a word”, or press “Post note” again to post without words.</p>
  <div class="row"><button type="button" data-add-word><span class="ic plus" aria-hidden="true"></span>Add a word</button><button class="primary" type="submit"></button></div>
  <p class="form-error" id="${pre}-error" role="alert" hidden></p></form>`;
  if (!host) editor.setAttribute("aria-labelledby","editor-title");
  const form = target.querySelector("form");
  const compose = form.querySelector("[data-compose]");
  const wordsBox = form.querySelector("[data-words]");
  const addWord = form.querySelector("[data-add-word]");
  const submit = form.querySelector('[type="submit"]');
  const nudge = form.querySelector("[data-nudge]");
  let nudged = false;
  form.elements.author.value = selected.author;
  const setGuest = () => {
    const guest = form.elements.author.value === "0";
    form.querySelector("[data-guest]").hidden = !guest;
    form.elements.author_name.required = guest;
  };
  setGuest();
  // Keep what has been typed when the type, subject or board changes.
  const capture = () => {
    if (standalone) return;
    if (form.elements.title) title = form.elements.title.value;
    if (form.elements.link) link = form.elements.link.value;
    if (type === "post" && form.elements.body) bodyText = form.elements.body.value;
    if (type === "note" && custom) customSections.forEach((item,index) => { if (form.elements[`custom-${index}`]) item.text = form.elements[`custom-${index}`].value; });
    else if (type === "note") SUBJECTS[subject].fields.forEach((field,index) => {
      const input = field.choices ? form.querySelector(`[name="field-${index}"]:checked`) : form.elements[`field-${index}`];
      if (input) values[field.label] = input.value;
    });
  };
  const paint = () => {
    if (!standalone) {
      if (type === "note") {
        const pinRow = `<div class="pin-row"><button type="button" class="chip" data-pin aria-pressed="${pinned}">Pin to top</button><p class="hint">Keeps this note above the others on the Study board.</p></div>`;
        compose.innerHTML = custom ? `<label>Title<input name="title" required maxlength="150" value="${e(title)}"></label>
        <p class="hint">This note has its own sections. Edit them here.</p>
        ${customSections.map((item,index) => `<label>${e(item.label || "Introduction")} (optional)<textarea name="custom-${index}" rows="3" maxlength="4000">${e(item.text)}</textarea></label>`).join("")}
        <label>Reference link (optional)<input type="url" name="link" value="${e(link)}" maxlength="2000" placeholder="https://"></label>${pinRow}` :
        `<label>Title<input name="title" required maxlength="150" value="${e(title)}"></label>
        ${subjectChips(subject)}<p class="hint">${e(SUBJECTS[subject].hint)}</p>
        ${SUBJECTS[subject].fields.map((field,index) => fieldHtml(field,index,values[field.label] ?? "")).join("")}
        <label>Reference link (optional)<input type="url" name="link" value="${e(link)}" maxlength="2000" placeholder="https://"></label>${pinRow}`;
      } else {
        compose.innerHTML = `${where === "chat" ? "" : `<label>Title (optional)<input name="title" maxlength="150" value="${e(title)}"></label>`}
        <label>Message<textarea name="body" required maxlength="10000" rows="6" placeholder="Write anything…">${e(bodyText)}</textarea></label>
        <label>Link (optional)<input type="url" name="link" value="${e(link)}" maxlength="2000" placeholder="https://"></label>
        ${editing ? "" : whereChips(where)}
        ${where === "chat" ? "" : `<div class="pin-row"><button type="button" class="chip" data-pin aria-pressed="${pinned}">Pin to top</button><p class="hint">Keeps this post above the others on the Study board.</p></div>`}`;
      }
    }
    wordsBox.hidden = !standalone && type !== "note";
    addWord.hidden = standalone || type !== "note";
    submit.textContent = standalone ? (editWord ? "Save changes" : "Add") : editing ? "Save changes" : type === "note" ? "Post note" : "Post";
  };
  paint();
  if (seed && !editing && seed.words.length) form.querySelectorAll(".word-fields").forEach(box => fillWord(box,box.querySelector('[name="term"]').value.trim()));
  form.addEventListener("input",event => { capture(); editorChanged = true; clearInvalid(event); });
  form.addEventListener("change",event => {
    const input = event.target;
    if (input.name === "subject") { capture(); subject = input.value; paint(); }
    if (input.name === "where") { capture(); where = input.value; paint(); }
  });
  form.addEventListener("click",event => {
    const typeButton = event.target.closest("[data-type]");
    if (typeButton) {
      capture();
      type = typeButton.dataset.type;
      form.querySelectorAll("[data-type]").forEach(button => button.setAttribute("aria-pressed",button === typeButton));
      paint();
    }
    const pin = event.target.closest("[data-pin]");
    if (pin) { pinned = !pinned; pin.setAttribute("aria-pressed",pinned); editorChanged = true; }
  });
  form.onsubmit = async event => {
    event.preventDefault();
    capture();
    const guestName = String(form.elements.author_name.value).trim();
    const problems = [];
    if (selected.author === 0 && !guestName) problems.push(["Enter a display name.",[form.elements.author_name]]);
    let entry = {author:selected.author,author_name:selected.author === 0 ? guestName : "",title:"",body:"",link:"",tag:"",board:"study",words:[]};
    const wordEntries = () => [...form.querySelectorAll("[data-words] fieldset")].map(field => ({
      id:field.dataset.wordId,term:field.querySelector('[name="term"]').value.trim(),
      meaning:field.querySelector('[name="meaning"]').value.trim(),example:field.querySelector('[name="example"]').value.trim()
    }));
    if (standalone) entry.words = wordEntries();
    else if (type === "note") {
      const fields = custom ? [] : SUBJECTS[subject].fields;
      const sections = custom ? customSections.map(item => ({label:item.label,text:item.text.trim()})) : fields.map(field => ({label:field.label,text:String(values[field.label] ?? "").trim()}));
      const missing = [];
      const missingFields = [];
      if (!title.trim()) { missing.push("“Title”"); missingFields.push(form.elements.title); }
      fields.forEach((field,index) => {
        if (field.required && !sections[index].text) { missing.push(`“${field.label}”`); missingFields.push(form.elements[`field-${index}`]); }
      });
      if (!sections.some(item => item.text)) { missing.push("at least one section"); }
      if (missing.length) problems.push([`Fill in ${joinList(missing)}.`,missingFields]);
      entry = {...entry,title:title.trim(),body:notesPrefix + JSON.stringify({subject,sections:sections.filter(item => item.text)}),link:link.trim(),tag:pinned ? "Pinned" : subject,words:wordEntries()};
    } else {
      const text = bodyText.trim();
      if (!text) problems.push(["Enter a message.",[form.elements.body]]);
      const derived = [...text.replace(/\s+/g," ")].slice(0,40).join("");
      entry = {...entry,title:where === "chat" ? derived : title.trim() || derived,body:text,link:link.trim(),tag:where === "study" && pinned ? "Pinned" : "",board:where};
    }
    const incomplete = [...form.querySelectorAll("[data-words] fieldset")].flatMap(field => [field.querySelector('[name="term"]'),field.querySelector('[name="meaning"]')]).filter(input => !input.value.trim()).filter(() => standalone || type === "note");
    if (incomplete.length) problems.push(["Enter both the word and its meaning.",incomplete]);
    if (entry.link && !safeLink(entry.link)) problems.push(["The reference link must start with https://.",[form.elements.link]]);
    if ([...entry.body].length > 12000) problems.push(["This is too long to save. Shorten it a little.",[form.elements.body ?? form.elements["field-0"]]]);
    if (problems.length) return showFormError(form,problems.map(problem => problem[0]).join(" "),problems.flatMap(problem => problem[1]).filter(Boolean));
    // A new note without words: the first press points at "Add a word" (a short highlight and one line in English); the second press posts.
    if (!standalone && type === "note" && !editing && !entry.words.length && !nudged) {
      nudged = true;
      nudge.hidden = false;
      addWord.classList.remove("is-nudged");
      void addWord.offsetWidth;
      addWord.classList.add("is-nudged");
      addWord.scrollIntoView({block:"center",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
      addWord.focus({preventScroll:true});
      setTimeout(() => addWord.classList.remove("is-nudged"),2800);
      return;
    }
    form.querySelector(".form-error").hidden = true;
    submit.disabled = true;
    try {
      const token = editing ? own[post.id] : crypto.randomUUID() + crypto.randomUUID();
      const id = editWord ? await updateWord(editWord.id,entry.words[0],activeMember()) : await saveEntry(entry,token,post?.id,editing ? activeMember() : 0);
      if (id && !editWord) {
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
      if ((standalone && !editWord) || type === "note") studied();
      location.hash = standalone ? "words/list" : entry.board === "chat" ? "feed/chat" : "post/" + id;
      flash(!standalone && type === "post" ? "Posted." : "Saved.");
    } catch (failure) {
      showFormError(form,failure.message);
    } finally { submit.disabled = false; }
  };
  form.elements.author.onchange = setGuest;
  if (!host) {
    editor.showModal();
    (form.elements.title ?? form.elements.body ?? form.querySelector('[name="term"]'))?.focus();
  }
}
// Our own confirmation window. The browser's confirm() is blocked in app browsers and phone web views (it answers "no" at once, so buttons seem dead).
const confirmBox = document.querySelector("#confirm-box");
function askConfirm({title,message,confirmLabel = "OK",cancelLabel = "Cancel"}) {
  return new Promise(resolve => {
    confirmBox.innerHTML = `<div class="dialog-head"><h2 id="confirm-title">${e(title)}</h2><button type="button" data-confirm="no" aria-label="Close">✕</button></div>
      <p>${e(message)}</p>
      <div class="row"><button type="button" data-cancel data-confirm="no">${e(cancelLabel)}</button><button type="button" class="primary" data-confirm="yes">${e(confirmLabel)}</button></div>`;
    const done = answer => {
      confirmBox.removeEventListener("click",onClick);
      confirmBox.removeEventListener("cancel",onCancel);
      confirmBox.close();
      resolve(answer);
    };
    const onClick = event => {
      const choice = event.target.closest("[data-confirm]");
      if (choice) done(choice.dataset.confirm === "yes");
    };
    const onCancel = event => { event.preventDefault(); done(false); };
    confirmBox.addEventListener("click",onClick);
    confirmBox.addEventListener("cancel",onCancel);
    confirmBox.showModal();
    confirmBox.querySelector("[data-cancel]").focus();
  });
}
const unsavedAsk = () => askConfirm({title:"Close without saving?",message:"Unsaved changes will be lost.",confirmLabel:"Close"});
async function closeEditor() {
  if (editor.querySelector('[type="submit"]')?.disabled) return;
  if (!editorChanged || await unsavedAsk()) editor.close();
}
editor.addEventListener("cancel",event => { event.preventDefault(); closeEditor(); });
function formClick(event, container, close) {
  if (event.target.closest("[data-close]")) close();
  if (event.target.closest("[data-add-word]")) {
    const fields = container.querySelector("[data-words]");
    const nudgeLine = container.querySelector("[data-nudge]");
    if (nudgeLine) nudgeLine.hidden = true;
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
async function closeWriter(host) {
  if (!host || host.querySelector('[type="submit"]')?.disabled) return;
  if (editorChanged && host.querySelector("form") && !(await unsavedAsk())) return;
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
  if (event.target.closest(".tv-close") && overlayEl.classList.contains("is-writing") && editorChanged && overlayEl.querySelector(".tv-writer form")) {
    event.stopImmediatePropagation();
    unsavedAsk().then(close => { if (close) { editorChanged = false; overlayEl.querySelector(".tv-close").click(); } });
  }
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
    if (!(await askConfirm({title:"Delete this comment?",message:"This cannot be undone.",confirmLabel:"Delete"}))) return;
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
  if (data.editWord) {
    const word = board.words.find(item => item.id === data.editWord);
    if (word) openEditor(true,undefined,undefined,undefined,undefined,word);
    return;
  }
  if (data.deleteWord) {
    if (!(await askConfirm({title:"Delete this word?",message:"This cannot be undone.",confirmLabel:"Delete"}))) return;
    button.disabled = true;
    try {
      await removeWord(data.deleteWord,activeMember());
      await refresh();
      flash("Word deleted.");
    } catch (failure) { flash(failure.message); button.disabled = false; }
    return;
  }
  if (data.deleteId) {
    if (!(await askConfirm({title:"Delete this post?",message:"This cannot be undone.",confirmLabel:"Delete"}))) return;
    button.disabled = true;
    try {
      await removePost(data.deleteId,own[data.deleteId],activeMember());
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
  if ("delete" in data && await askConfirm({title:"Delete this post?",confirmLabel:"Delete",message:(() => {
    const target = board.posts.find(post => post.id === id);
    const count = board.words.filter(word => word.post_id === id).length;
    return !count || (target && boardKind(target) === "chat") ? "This cannot be undone." : `The ${count} linked ${count === 1 ? "word" : "words"} will be deleted too. This cannot be undone.`;
  })()})) {
    button.disabled = true;
    try {
      await removePost(id,own[id],activeMember());
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
  if (data.choice !== undefined && quiz && quiz.picked === null) {
    const word = quiz.words[quiz.index];
    const choice = choicesFor(word)[Number(data.choice)];
    if (choice) {
      const review = new Set(readLocal("review",[]));
      if (choice.right) review.delete(word.id); else { quiz.missed.push(word); review.add(word.id); }
      writeLocal("review",[...review]);
      studied();
      quiz.picked = Number(data.choice);
      render();
      main.querySelector("[data-next]")?.focus();
    }
  }
  if ("next" in data && quiz) {
    quiz.index++;
    quiz.picked = null;
    render();
    main.querySelector("[data-choice], [data-reveal], [data-quiz]")?.focus();
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
// ---- Reading an article: click a word (or drag a phrase) and a bar offers to add it to the word list ----
const ARTICLE_TEXT = "[data-article] .tv-para > p[lang=en]";
let wordPick = null;
function refreshSavedMarks() {
  const host = overlayEl.querySelector("[data-article]");
  if (!host?.renderMarks) return;
  host.savedTerms = board.words.map(word => word.term.trim().toLowerCase()).filter(term => term.length >= 2);
  host.renderMarks();
}
overlayEl.addEventListener("article-ready",refreshSavedMarks);
const sameWord = (word, term) => word.term.trim().toLowerCase() === term.toLowerCase();
function wordBarHtml() {
  const pick = wordPick;
  const found = board.words.find(word => sameWord(word,pick.term));
  const close = '<button type="button" class="wb-close" data-wb-close aria-label="Close">✕</button>';
  const sentence = pick.sentence ? `<p class="wb-sentence" lang="en">“${e(pick.sentence)}”</p>` : "";
  if (pick.done) return `<div class="wb-top"><strong lang="en">${e(pick.term)}</strong><span lang="ko">${e(pick.korean)}</span>${close}</div><p role="status">Added to your words.</p>`;
  if (found) {
    return `<div class="wb-top"><strong lang="en">${e(pick.term)}</strong><span lang="ko">${e(found.meaning)}</span>${close}</div>
      <p role="status">Already in your words.</p>${canManageWord(found) ? '<div class="row"><button type="button" class="tv-action" data-wb-edit-saved>Edit</button></div>' : ""}`;
  }
  const meaning = pick.editing || (!pick.loading && !pick.korean)
    ? `<input class="wb-input" name="meaning" lang="ko" aria-label="Korean meaning" maxlength="120" autocomplete="off" placeholder="Korean meaning" value="${e(pick.korean)}">`
    : `<span lang="ko">${pick.loading ? "…" : e(pick.korean)}</span>`;
  return `<div class="wb-top"><strong lang="en">${e(pick.term)}</strong>${meaning}${close}</div>${sentence}
    ${pick.error ? `<p class="form-error" role="alert">${e(pick.error)}</p>` : ""}
    <div class="row"><button type="button" class="tv-action" data-wb-add ${pick.busy ? "disabled" : ""}>Add to words</button>${pick.editing || (!pick.loading && !pick.korean) ? "" : '<button type="button" class="tv-action" data-wb-edit>Edit meaning</button>'}</div>`;
}
function paintWordBar(focusInput) {
  const detail = overlayEl.querySelector(".tv-scroll") ?? overlayEl.querySelector(".tv-detail");
  if (!detail) return;
  let bar = detail.querySelector(".tv-wordbar");
  if (!wordPick) { bar?.remove(); detail.style.removeProperty("--bar-h"); return; }
  if (!bar) { bar = document.createElement("div"); bar.className = "tv-wordbar"; bar.setAttribute("role","region"); bar.setAttribute("aria-label","Add this word"); detail.appendChild(bar); }
  bar.innerHTML = wordBarHtml();
  detail.style.setProperty("--bar-h",bar.offsetHeight + "px");
  if (focusInput) bar.querySelector(".wb-input")?.focus();
}
function pickWord(para, event) {
  const selection = getSelection();
  if (!selection.rangeCount) return;
  let range = selection.getRangeAt(0);
  if (!para.contains(range.commonAncestorContainer)) return;
  if (selection.isCollapsed) {
    const at = document.caretPositionFromPoint?.(event.clientX,event.clientY);
    const node = at?.offsetNode ?? document.caretRangeFromPoint?.(event.clientX,event.clientY)?.startContainer;
    const offset = at?.offset ?? document.caretRangeFromPoint?.(event.clientX,event.clientY)?.startOffset ?? 0;
    if (!node || node.nodeType !== 3 || !para.contains(node)) return;
    const text = node.textContent;
    let from = offset, to = offset;
    while (from > 0 && /[A-Za-z'’-]/.test(text[from - 1])) from--;
    while (to < text.length && /[A-Za-z'’-]/.test(text[to])) to++;
    if (to - from < 2) return;
    range = document.createRange();
    range.setStart(node,from);
    range.setEnd(node,to);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const term = range.toString().replace(/\s+/g," ").replace(/’/g,"'").trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g,"");
  if (!/^[A-Za-z][A-Za-z' -]{0,58}$/.test(term) || term.split(" ").length > 6) return;
  const before = document.createRange();
  before.selectNodeContents(para);
  before.setEnd(range.startContainer,range.startOffset);
  const full = para.textContent;
  const start = before.toString().length;
  const breaks = [". ","! ","? "].map(mark => full.lastIndexOf(mark,start - 1));
  const sentenceStart = Math.max(...breaks) < 0 ? 0 : Math.max(...breaks) + 2;
  const stop = full.slice(start).search(/[.!?]["”’]?(\s|$)/);
  const sentence = full.slice(sentenceStart,stop < 0 ? full.length : start + stop + 1).trim().slice(0,300);
  const current = {term,sentence,korean:"",loading:true,editing:false,error:"",busy:false,done:false};
  wordPick = current;
  paintWordBar();
  lookupWord(term.toLowerCase()).then(found => {
    if (wordPick !== current) return;
    current.korean = found.korean || "";
    current.loading = false;
    paintWordBar(!current.korean);
  }).catch(() => {
    if (wordPick !== current) return;
    current.loading = false;
    paintWordBar(true);
  });
}
overlayEl.addEventListener("pointerup",event => {
  const para = event.target.closest?.(ARTICLE_TEXT);
  if (para) setTimeout(() => pickWord(para,event),0);
});
overlayEl.addEventListener("keyup",event => {
  if (event.key !== "Shift" && !event.shiftKey) return;
  const selection = getSelection();
  const para = selection.anchorNode?.parentElement?.closest(ARTICLE_TEXT);
  if (para && !selection.isCollapsed) pickWord(para,event);
});
overlayEl.addEventListener("click",async event => {
  if (!wordPick) return;
  if (event.target.closest("[data-wb-close]")) { wordPick = null; paintWordBar(); return; }
  if (event.target.closest("[data-wb-edit]")) { wordPick.editing = true; paintWordBar(true); return; }
  if (event.target.closest("[data-wb-edit-saved]")) {
    const word = board.words.find(item => sameWord(item,wordPick.term));
    if (word) openEditor(true,undefined,undefined,undefined,undefined,word);
    return;
  }
  if (!event.target.closest("[data-wb-add]")) return;
  const current = wordPick;
  const input = overlayEl.querySelector(".wb-input");
  const meaning = (input ? input.value : current.korean).trim();
  if (!meaning) { current.editing = true; current.error = "Enter the Korean meaning."; paintWordBar(true); return; }
  const member = activeMember();
  if (!members[member - 1]) { chooseMember(() => overlayEl.querySelector("[data-wb-add]")?.click()); return; }
  current.korean = meaning;
  current.busy = true;
  current.error = "";
  paintWordBar();
  try {
    const entry = {author:member,author_name:"",title:"",body:"",link:"",tag:"",board:"study",
      words:[{id:"",term:current.term,meaning,example:current.sentence}]};
    await saveEntry(entry,crypto.randomUUID() + crypto.randomUUID(),undefined,0);
    try { board = await loadBoard(); } catch {}
    studied();
    current.done = true;
    refreshSavedMarks();
    current.busy = false;
    if (wordPick === current) paintWordBar();
    flash("Word added.");
  } catch (failure) {
    current.busy = false;
    current.error = failure.message;
    if (wordPick === current) paintWordBar();
  }
});
overlayEl.addEventListener("cancel",event => {
  if (!wordPick) return;
  event.preventDefault();
  wordPick = null;
  paintWordBar();
});
overlayEl.addEventListener("close",() => { wordPick = null; });
overlayEl.addEventListener("write-media",event => {
  const {item,host,seed} = event.detail;
  writerSource = item;
  openEditor(false,undefined,item,host,undefined,undefined,seed ? {sentences:seed.sentences,words:seed.words.filter(term => !board.words.some(word => sameWord(word,term)))} : undefined);
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
