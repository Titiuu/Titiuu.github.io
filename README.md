# Titiuu.github.io

Titiuu 的 GitHub Pages 个人主页。

## 本地预览

直接在浏览器中打开 `index.html` 即可预览，无需构建流程。
新增、删除或改名博客 Markdown 后，运行 `node scripts/generate-blog-data.mjs` 更新前端使用的博客清单。
运行 `node scripts/generate-github-contributions.mjs` 可更新首页 GitHub contributions 数据；线上会由 GitHub Actions 定时更新。

## 内容结构

- `index.html`：页面内容与结构
- `styles.css`：页面样式与响应式布局
- `script.js`：中英切换逻辑
- `blog-data.js`：由脚本生成的博客清单与 Markdown 内容
- `github-contributions-data.js`：由脚本生成的 GitHub contributions 数据
- `blogs/`：博客 Markdown 占位文件
