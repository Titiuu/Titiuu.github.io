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
