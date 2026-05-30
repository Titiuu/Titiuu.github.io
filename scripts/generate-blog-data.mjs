import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const rootDir = new URL("..", import.meta.url).pathname;
const blogRoot = join(rootDir, "blogs");
const categories = {
  tech: "技术分享",
  papers: "论文解读",
  projects: "项目分享",
};

function extractTitle(markdown, fallback) {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : fallback;
}

function extractExcerpt(markdown) {
  const paragraph = markdown
    .replace(/^#\s+.+$/m, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find((block) => {
      return (
        block &&
        !block.startsWith("#") &&
        !block.startsWith("```") &&
        !block.startsWith("|") &&
        !/^\s*[-*]\s+/.test(block)
      );
    });

  if (!paragraph) {
    return "";
  }

  return paragraph
    .replace(/\s+/g, " ")
    .replace(/[`*_>#]/g, "")
    .slice(0, 120);
}

function slugFromFile(fileName) {
  return fileName.replace(/\.md$/i, "");
}

function dateFromFile(fileName) {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})-/);
  return match ? match[1] : "";
}

function toPosixPath(path) {
  return path.split("\\").join("/");
}

const posts = Object.keys(categories).flatMap((category) => {
  const categoryDir = join(blogRoot, category);
  let files = [];

  try {
    files = readdirSync(categoryDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  return files.map((fileName) => {
    const absolutePath = join(categoryDir, fileName);
    const content = readFileSync(absolutePath, "utf8");
    const slug = slugFromFile(fileName);

    return {
      category,
      categoryName: categories[category],
      date: dateFromFile(fileName),
      title: extractTitle(content, slug),
      excerpt: extractExcerpt(content),
      slug,
      path: toPosixPath(relative(rootDir, absolutePath)),
    };
  });
});

posts.sort((a, b) => {
  if (a.category !== b.category) {
    return a.category.localeCompare(b.category);
  }
  return b.date.localeCompare(a.date) || a.title.localeCompare(b.title);
});

const output = `window.BLOG_POSTS = ${JSON.stringify(posts, null, 2)};\n`;
writeFileSync(join(rootDir, "blog-data.js"), output, "utf8");

console.log(`Generated blog-data.js with ${posts.length} posts.`);
