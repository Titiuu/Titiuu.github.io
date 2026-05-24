const translations = {
  zh: {
    "nav.about": "关于",
    "nav.blog": "博客",
    "nav.projects": "项目",
    "nav.contact": "联系",
    "hero.eyebrow": "个人主页",
    "hero.role": "AI工程师",
    "hero.summary":
      "一个在学点有趣的东西的开发者。专业是计算机 / 通信方向，目前是 Agent、大模型工程师。",
    "about.eyebrow": "关于我",
    "about.title": "计算机 / 通信背景下的大模型工程实践",
    "about.body":
      "我关注 Agent、大模型应用工程和能够真实落地的 AI 系统，也会持续记录论文阅读、技术实验与项目复盘。",
    "blog.eyebrow": "个人博客",
    "blog.title": "即将写下的三类笔记",
    "blog.note":
      "文章正文会以中文为主。首版先保留分类入口，等内容成熟后再补充链接或独立文章页。",
    "projects.eyebrow": "项目",
    "projects.title": "项目会在这里慢慢补齐",
    "projects.cardTitle": "AI Agent 与大模型工程实践",
    "projects.cardBody":
      "后续会补充可公开的 Agent、大模型应用或其他个人项目，包括目标、架构、实现要点和仓库链接。",
    "projects.status": "待发布",
    "contact.eyebrow": "联系",
    "contact.title": "欢迎交流 AI 工程、Agent 和技术写作",
  },
  en: {
    "nav.about": "About",
    "nav.blog": "Blog",
    "nav.projects": "Projects",
    "nav.contact": "Contact",
    "hero.eyebrow": "Personal site",
    "hero.role": "AI Engineer",
    "hero.summary":
      "A developer learning interesting things. My background is in computer science and communications, and I currently work on agents and large language model engineering.",
    "about.eyebrow": "About",
    "about.title": "LLM engineering from a computer science and communications background",
    "about.body":
      "I focus on agents, LLM application engineering, and AI systems that can move from ideas into working products. I also use this site to collect paper notes, technical experiments, and project retrospectives.",
    "blog.eyebrow": "Personal Blog",
    "blog.title": "Three kinds of notes to come",
    "blog.note":
      "Blog posts will mainly be written in Chinese. This first version keeps the categories in place, with links or article pages added later.",
    "projects.eyebrow": "Projects",
    "projects.title": "Projects will be added here over time",
    "projects.cardTitle": "AI Agent and LLM engineering practice",
    "projects.cardBody":
      "Public agent, LLM application, and personal engineering projects will be added here with goals, architecture notes, implementation details, and repository links.",
    "projects.status": "Coming soon",
    "contact.eyebrow": "Contact",
    "contact.title": "Open to conversations about AI engineering, agents, and technical writing",
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
