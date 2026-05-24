const translations = {
  zh: {
    "nav.tech": "技术分享",
    "nav.papers": "论文解读",
    "nav.projects": "项目分享",
    "profile.eyebrow": "个人主页",
    "profile.role": "AI工程师",
    "profile.summary":
      "一个在学点有趣的东西的开发者。专业是计算机 / 通信方向，目前是 Agent、大模型工程师。",
    "profile.focusTitle": "关注方向",
    "profile.focus": "Agent、大模型应用工程，以及能够真实落地的 AI 系统。",
    "board.eyebrow": "个人博客",
    "board.title": "三类笔记，按时间倒序更新",
    "board.note":
      "博客正文以中文为主。当前先创建只有标题的 Markdown 占位文件，链接均指向真实 GitHub 文件页。",
    "columns.tech": "技术分享",
    "columns.papers": "论文解读",
    "columns.projects": "项目分享",
  },
  en: {
    "nav.tech": "Tech",
    "nav.papers": "Papers",
    "nav.projects": "Projects",
    "profile.eyebrow": "Personal site",
    "profile.role": "AI Engineer",
    "profile.summary":
      "A developer learning interesting things. My background is in computer science and communications, and I currently work on agents and large language model engineering.",
    "profile.focusTitle": "Focus",
    "profile.focus": "Agents, LLM application engineering, and AI systems that can become real products.",
    "board.eyebrow": "Personal Blog",
    "board.title": "Three note streams in reverse chronological order",
    "board.note":
      "Posts will mainly be written in Chinese. The current Markdown placeholders contain only titles, and every link points to a real GitHub file page.",
    "columns.tech": "Tech Notes",
    "columns.papers": "Paper Reading",
    "columns.projects": "Project Logs",
  },
};

const langButtons = document.querySelectorAll(".lang-button");
const translatableNodes = document.querySelectorAll("[data-i18n]");

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

  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  langButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.lang === language);
  });
  storeLanguage(language);
}

langButtons.forEach((button) => {
  button.addEventListener("click", () => applyLanguage(button.dataset.lang));
});

applyLanguage(readStoredLanguage() || "zh");
