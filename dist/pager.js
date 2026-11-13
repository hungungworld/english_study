// Shared page selector: five items per page, shown under every long list.
export const PER_PAGE = 5;
export function pageCount(total) {
  return Math.max(1,Math.ceil(total / PER_PAGE));
}
export function pagerHtml(key, page, pages) {
  if (pages <= 1) return "";
  const numbers = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) numbers.push(i);
  } else {
    numbers.push(1);
    if (page > 3) numbers.push("…");
    for (let i = Math.max(2,page - 1); i <= Math.min(pages - 1,page + 1); i++) numbers.push(i);
    if (page < pages - 2) numbers.push("…");
    numbers.push(pages);
  }
  const button = (label, target, extra = "") => `<button type="button" data-page-key="${key}" data-page="${target}" ${extra}>${label}</button>`;
  return `<nav class="pager" aria-label="페이지 이동">${button("이전",page - 1,page === 1 ? "disabled" : "")}${numbers.map(number =>
    number === "…" ? '<span class="gap" aria-hidden="true">…</span>' :
    button(number,number,number === page ? 'aria-current="page"' : `aria-label="${number}쪽"`)).join("")}${button("다음",page + 1,page === pages ? "disabled" : "")}</nav>`;
}
