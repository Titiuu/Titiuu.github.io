const translations = {
  zh: {
    "nav.tech": "技术分享",
    "nav.papers": "论文解读",
    "nav.projects": "项目分享",
    "profile.eyebrow": "个人主页",
    "profile.role": "AI工程师",
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
    "search.label": "搜索博客",
    "search.placeholder": "搜索博客名称",
  },
  en: {
    "nav.tech": "Tech",
    "nav.papers": "Papers",
    "nav.projects": "Projects",
    "profile.eyebrow": "Personal site",
    "profile.role": "AI Engineer",
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
  const sortButtons = document.querySelectorAll("[data-sort]");
  let direction = "desc";
  let selectedSlug = initialSlug;

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

  function selectPost(post, pushState = true) {
    if (!post) {
      preview.innerHTML = `<div class="empty-preview">没有找到可展示的文章。</div>`;
      return;
    }

    selectedSlug = post.slug;
    preview.innerHTML = renderMarkdown(post.content);
    list.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.slug === selectedSlug);
    });

    if (pushState) {
      const url = `category.html?category=${encodeURIComponent(category)}&post=${encodeURIComponent(post.slug)}`;
      history.replaceState(null, "", url);
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

  search?.addEventListener("input", renderList);
  sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      direction = button.dataset.sort;
      sortButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      renderList();
    });
  });

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

function renderMarkdown(markdown) {
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
