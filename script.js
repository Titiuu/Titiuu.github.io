const translations = {
  zh: {
    "nav.tech": "技术分享",
    "nav.papers": "论文解读",
    "nav.projects": "项目分享",
    "profile.eyebrow": "个人主页",
    "profile.role": "AI应用工程师",
    "profile.summary":
      "一个AI应用方向的开发者。目前是 Agent、大模型工程师。",
    "profile.focusTitle": "关注方向",
    "profile.focus": "Agent、大模型应用工程，以及能够真实落地的 AI 系统。",
    "board.eyebrow": "知识分享",
    "board.title": "我的博客笔记",
    "board.note": "大模型、Agent方向的技术和论文分享。",
    "columns.tech": "技术分享",
    "columns.papers": "论文解读",
    "columns.projects": "项目分享",
    "github.eyebrow": "开源轨迹",
    "github.title": "GitHub 贡献",
    "github.noteTemplate": "最近一年提交 {count} 次。",
    "github.syncing": "正在同步 GitHub 数据。",
    "github.link": "查看 GitHub",
    "search.label": "搜索博客",
    "search.placeholder": "搜索博客名称",
  },
  en: {
    "nav.tech": "Tech",
    "nav.papers": "Papers",
    "nav.projects": "Projects",
    "profile.eyebrow": "Personal site",
    "profile.role": "AI Application Engineer",
    "profile.summary":
      "A developer focused on AI applications. I currently work as an agent and large language model engineer.",
    "profile.focusTitle": "Focus",
    "profile.focus": "Agents, LLM application engineering, and AI systems that can become real products.",
    "board.eyebrow": "Knowledge Sharing",
    "board.title": "My Blog Notes",
    "board.note": "Technical and paper notes on LLMs and agents.",
    "columns.tech": "Tech Notes",
    "columns.papers": "Paper Reading",
    "columns.projects": "Project Logs",
    "github.eyebrow": "Open Source",
    "github.title": "GitHub Contributions",
    "github.noteTemplate": "{count} contributions in the last year.",
    "github.syncing": "Syncing GitHub data.",
    "github.link": "View GitHub",
    "search.label": "Search posts",
    "search.placeholder": "Search blog titles",
  },
};

const categoryNames = {
  tech: "技术分享",
  papers: "论文解读",
  projects: "项目分享",
};

const posts = Array.isArray(window.BLOG_POSTS) ? window.BLOG_POSTS : [];
const langButtons = document.querySelectorAll(".lang-button");
const translatableNodes = document.querySelectorAll("[data-i18n]");
const translatablePlaceholders = document.querySelectorAll("[data-i18n-placeholder]");
let mermaidInitialized = false;
let currentLanguage = "zh";
let homeListLayoutFrame = null;
const markdownCache = new Map();

function readStoredLanguage() {
  try {
    return localStorage.getItem("preferred-language");
  } catch {
    return null;
  }
}

function storeLanguage(language) {
  try {
    localStorage.setItem("preferred-language", language);
  } catch {
    // Language switching should still work when storage is unavailable.
  }
}

function applyLanguage(language) {
  const dictionary = translations[language] || translations.zh;
  currentLanguage = translations[language] ? language : "zh";

  translatableNodes.forEach((node) => {
    const key = node.dataset.i18n;
    if (dictionary[key]) {
      node.textContent = dictionary[key];
    }
  });

  translatablePlaceholders.forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (dictionary[key]) {
      node.placeholder = dictionary[key];
    }
  });

  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  langButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.lang === language);
  });
  storeLanguage(language);
  renderGithubContributions();
  scheduleHomeListLayout();
}

function formatDate(date) {
  return date ? date.replaceAll("-", ".") : "";
}

function buildPostUrl(post) {
  return `category.html?category=${encodeURIComponent(post.category)}&post=${encodeURIComponent(post.slug)}`;
}

function sortByDate(items, direction = "desc") {
  return [...items].sort((a, b) => {
    const result = a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
    return direction === "asc" ? result : -result;
  });
}

function renderHomeLists() {
  document.querySelectorAll("[data-home-category]").forEach((list) => {
    const category = list.dataset.homeCategory;
    const categoryPosts = sortByDate(posts.filter((post) => post.category === category)).slice(0, 5);

    if (categoryPosts.length === 0) {
      list.innerHTML = `<li class="empty-item">暂无文章</li>`;
      return;
    }

    list.innerHTML = categoryPosts
      .map(
        (post) => `
          <li>
            <time datetime="${post.date}">${formatDate(post.date)}</time>
            <a href="${buildPostUrl(post)}">${escapeHtml(post.title)}</a>
          </li>
        `,
      )
      .join("");
  });

  scheduleHomeListLayout();
}

function fitHomeLists() {
  const isMobile = window.matchMedia("(max-width: 820px)").matches;

  document.querySelectorAll("[data-home-category]").forEach((list) => {
    const items = [...list.children];
    items.forEach((item) => {
      item.hidden = false;
    });

    if (isMobile) {
      return;
    }

    const listBottom = list.getBoundingClientRect().bottom;
    let hasOverflowed = false;
    items.forEach((item) => {
      const itemBottom = item.getBoundingClientRect().bottom;
      if (hasOverflowed || itemBottom > listBottom + 1) {
        item.hidden = true;
        hasOverflowed = true;
      }
    });
  });
}

function scheduleHomeListLayout() {
  if (homeListLayoutFrame !== null) {
    cancelAnimationFrame(homeListLayoutFrame);
  }

  homeListLayoutFrame = requestAnimationFrame(() => {
    homeListLayoutFrame = null;
    fitHomeLists();
  });
}

function renderGithubContributions() {
  const grid = document.getElementById("github-contribution-grid");
  const note = document.getElementById("github-contributions-note");
  if (!grid || !note) {
    return;
  }

  const dictionary = translations[currentLanguage] || translations.zh;
  const data = window.GITHUB_CONTRIBUTIONS;

  if (!data || !Array.isArray(data.days) || data.days.length === 0) {
    note.textContent = dictionary["github.syncing"];
    grid.innerHTML = "";
    grid.classList.add("is-empty");
    return;
  }

  const count = Number.isFinite(data.total) ? data.total : 0;
  note.textContent = dictionary["github.noteTemplate"].replace("{count}", count);
  grid.classList.remove("is-empty");
  grid.innerHTML = data.days
    .map((day) => {
      const date = escapeHtml(day.date);
      const contributions = Number.isFinite(day.count) ? day.count : 0;
      const level = Math.max(0, Math.min(4, Number.isFinite(day.level) ? day.level : 0));
      const label =
        currentLanguage === "en"
          ? `${contributions} contributions on ${date}`
          : `${date} 提交 ${contributions} 次`;

      return `
        <span
          class="contribution-day"
          data-level="${level}"
          role="gridcell"
          aria-label="${escapeHtml(label)}"
          title="${escapeHtml(label)}"
        ></span>
      `;
    })
    .join("");
}

function setupGlobalSearch() {
  const form = document.getElementById("site-search-form");
  const input = document.getElementById("site-search-input");
  const results = document.getElementById("site-search-results");

  if (!form || !input || !results) {
    return;
  }

  function matches(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    return posts
      .filter((post) => post.title.toLowerCase().includes(normalized))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }

  function renderResults(query) {
    const found = matches(query);
    if (!query.trim()) {
      results.innerHTML = "";
      results.classList.remove("is-open");
      return;
    }

    if (found.length === 0) {
      results.innerHTML = `<p>没有匹配的博客</p>`;
      results.classList.add("is-open");
      return;
    }

    results.innerHTML = found
      .map(
        (post) => `
          <a href="${buildPostUrl(post)}">
            <span>${escapeHtml(post.title)}</span>
            <small>${categoryNames[post.category]} · ${formatDate(post.date)}</small>
          </a>
        `,
      )
      .join("");
    results.classList.add("is-open");
  }

  input.addEventListener("input", () => renderResults(input.value));
  input.addEventListener("focus", () => renderResults(input.value));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const firstMatch = matches(input.value)[0];
    if (firstMatch) {
      window.location.href = buildPostUrl(firstMatch);
    }
  });

  document.addEventListener("click", (event) => {
    if (!form.contains(event.target)) {
      results.classList.remove("is-open");
    }
  });
}

function setupReaderPage() {
  const reader = document.querySelector("[data-reader]");
  if (!reader) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const requestedCategory = params.get("category");
  const category = categoryNames[requestedCategory] ? requestedCategory : "papers";
  const initialSlug = params.get("post");
  const title = document.getElementById("reader-title");
  const count = document.getElementById("reader-count");
  const list = document.getElementById("reader-list");
  const search = document.getElementById("category-search");
  const preview = document.getElementById("markdown-preview");
  const sortToggle = document.querySelector("[data-sort-toggle]");
  const sortLabel = sortToggle?.querySelector("[data-sort-label]");
  let direction = "desc";
  let selectedSlug = initialSlug;
  let selectionRequest = 0;

  document.title = `Titiuu | ${categoryNames[category]}`;
  title.textContent = categoryNames[category];
  document.querySelectorAll(".nav-links a").forEach((link) => {
    link.classList.toggle("is-active", link.href.includes(`category=${category}`));
  });

  function categoryPosts() {
    const query = (search?.value || "").trim().toLowerCase();
    return sortByDate(
      posts.filter((post) => {
        return post.category === category && post.title.toLowerCase().includes(query);
      }),
      direction,
    );
  }

  async function loadPostMarkdown(post) {
    if (markdownCache.has(post.path)) {
      return markdownCache.get(post.path);
    }

    const response = await fetch(post.path);
    if (!response.ok) {
      throw new Error(`Unable to load ${post.path}: ${response.status}`);
    }

    const markdown = await response.text();
    markdownCache.set(post.path, markdown);
    return markdown;
  }

  async function selectPost(post, pushState = true) {
    const requestId = (selectionRequest += 1);

    if (!post) {
      preview.innerHTML = `<div class="empty-preview">没有找到可展示的文章。</div>`;
      return;
    }

    selectedSlug = post.slug;
    list.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.slug === selectedSlug);
    });

    if (pushState) {
      const url = `category.html?category=${encodeURIComponent(category)}&post=${encodeURIComponent(post.slug)}`;
      history.replaceState(null, "", url);
    }

    preview.innerHTML = `<div class="empty-preview">正在加载文章...</div>`;

    try {
      const markdown = await loadPostMarkdown(post);
      if (requestId !== selectionRequest) {
        return;
      }

      preview.innerHTML = renderMarkdown(markdown);
      enhanceRenderedMarkdown(preview);
      renderMermaidDiagrams(preview);
    } catch {
      if (requestId !== selectionRequest) {
        return;
      }

      preview.innerHTML = `
        <div class="empty-preview">
          无法加载文章内容。请通过本地静态服务器或 GitHub Pages 访问页面。
        </div>
      `;
    }
  }

  function renderList() {
    const visiblePosts = categoryPosts();
    count.textContent = `${visiblePosts.length} 篇文章`;

    if (visiblePosts.length === 0) {
      list.innerHTML = `<li class="empty-item">没有匹配的文章</li>`;
      selectPost(null, false);
      return;
    }

    list.innerHTML = visiblePosts
      .map(
        (post) => `
          <li>
            <button type="button" data-slug="${post.slug}">
              <time datetime="${post.date}">${formatDate(post.date)}</time>
              <span>${escapeHtml(post.title)}</span>
            </button>
          </li>
        `,
      )
      .join("");

    list.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const post = visiblePosts.find((item) => item.slug === button.dataset.slug);
        selectPost(post);
      });
    });

    const selected = visiblePosts.find((post) => post.slug === selectedSlug) || visiblePosts[0];
    selectPost(selected, selected.slug !== initialSlug);
  }

  function updateSortToggle() {
    if (!sortToggle || !sortLabel) {
      return;
    }

    const isDesc = direction === "desc";
    sortLabel.textContent = isDesc ? "新到旧" : "旧到新";
    sortToggle.classList.toggle("is-desc", isDesc);
    sortToggle.classList.toggle("is-asc", !isDesc);
    sortToggle.setAttribute(
      "aria-label",
      isDesc ? "当前排序：新到旧，点击切换为旧到新" : "当前排序：旧到新，点击切换为新到旧",
    );
    sortToggle.title = isDesc ? "新到旧" : "旧到新";
  }

  search?.addEventListener("input", renderList);
  sortToggle?.addEventListener("click", () => {
    direction = direction === "desc" ? "asc" : "desc";
    updateSortToggle();
    renderList();
  });

  updateSortToggle();
  renderList();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInline(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return text;
}

function renderTable(lines) {
  const rows = lines
    .filter((line, index) => index !== 1)
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));

  const head = rows[0] || [];
  const body = rows.slice(1);

  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${head.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>
        <tbody>
          ${body.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderWithMarked(markdown) {
  if (!window.marked) {
    return "";
  }

  const html = window.marked.parse(markdown, {
    async: false,
    breaks: false,
    gfm: true,
  });

  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    '<div class="mermaid">$1</div>',
  );
}

function enhanceRenderedMarkdown(container) {
  container.querySelectorAll("a[href]").forEach((link) => {
    if (/^https?:\/\//i.test(link.getAttribute("href"))) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
  });
}

async function renderMermaidDiagrams(container) {
  const diagrams = container.querySelectorAll(".mermaid");
  if (!diagrams.length || !window.mermaid) {
    return;
  }

  try {
    if (!mermaidInitialized) {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: {
          fontFamily: '"Source Serif 4", "Noto Serif SC", Georgia, serif',
          primaryColor: "#f7f4ec",
          primaryTextColor: "#1c2621",
          primaryBorderColor: "#d8d0c0",
          lineColor: "#244d3f",
          secondaryColor: "#eee7db",
          tertiaryColor: "#ffffff",
        },
      });
      mermaidInitialized = true;
    }

    await window.mermaid.run({ nodes: diagrams });
  } catch (error) {
    diagrams.forEach((diagram) => {
      diagram.classList.add("mermaid-fallback");
    });
  }
}

function renderMarkdown(markdown) {
  const markedHtml = renderWithMarked(markdown);
  if (markedHtml) {
    return markedHtml;
  }

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w+)?/);
    if (fence) {
      const language = fence[1] || "text";
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      if (language.toLowerCase() === "mermaid") {
        html.push(`<div class="mermaid">${escapeHtml(code.join("\n"))}</div>`);
        continue;
      }
      html.push(`<pre><code class="language-${language}">${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      html.push("<hr />");
      index += 1;
      continue;
    }

    if (line.includes("|") && lines[index + 1] && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      html.push(renderTable(tableLines));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    if (/^\s*>\s+/.test(line)) {
      const quotes = [];
      while (index < lines.length && /^\s*>\s+/.test(lines[index])) {
        quotes.push(lines[index].replace(/^\s*>\s+/, ""));
        index += 1;
      }
      html.push(`<blockquote>${quotes.map(renderInline).join("<br />")}</blockquote>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^```/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^\s*>\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return html.join("\n");
}

langButtons.forEach((button) => {
  button.addEventListener("click", () => applyLanguage(button.dataset.lang));
});

applyLanguage(readStoredLanguage() || "zh");
renderHomeLists();
setupGlobalSearch();
setupReaderPage();

window.addEventListener("resize", scheduleHomeListLayout);
document.fonts?.ready.then(scheduleHomeListLayout);
