import { writeFileSync } from "node:fs";
import { join } from "node:path";

const username = "Titiuu";
const rootDir = new URL("..", import.meta.url).pathname;
const endpoint = `https://github.com/users/${username}/contributions`;

function decodeHtml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function parseContributionCount(label) {
  if (label.startsWith("No contributions")) {
    return 0;
  }
  const match = label.match(/^([\d,]+)\s+contributions?/i);
  return match ? Number.parseInt(match[1].replaceAll(",", ""), 10) : 0;
}

function parseContributions(html) {
  const totalMatch = html.match(
    /<h2[^>]*id="js-contribution-activity-description"[^>]*>\s*([\d,]+)\s+contributions?\s+in the last year\s*<\/h2>/i,
  );
  const rangeMatch = html.match(
    /<title>A graph representing .*? from\s+([^<]+?)\s+to\s+([^<]+?)\.\s+The contributions are/i,
  );
  const days = [];
  const cellPattern = /<td\b(?=[^>]*\bdata-date="([^"]+)")(?=[^>]*\bdata-level="([^"]+)")[^>]*><\/td>\s*<tool-tip[^>]*>([^<]+)<\/tool-tip>/g;

  for (const match of html.matchAll(cellPattern)) {
    const [, date, level, rawLabel] = match;
    const label = decodeHtml(rawLabel.trim());
    days.push({
      date,
      count: parseContributionCount(label),
      level: Number.parseInt(level, 10) || 0,
    });
  }

  if (!totalMatch || days.length === 0) {
    throw new Error("Unable to parse GitHub contributions data.");
  }

  days.sort((a, b) => a.date.localeCompare(b.date));

  return {
    username,
    total: Number.parseInt(totalMatch[1].replaceAll(",", ""), 10),
    from: rangeMatch?.[1]?.trim() || days[0].date,
    to: rangeMatch?.[2]?.trim() || days.at(-1).date,
    days,
  };
}

async function main() {
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": `${username}.github.io contribution generator`,
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub contributions request failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const data = parseContributions(html);
  const output = `window.GITHUB_CONTRIBUTIONS = ${JSON.stringify(data, null, 2)};\n`;
  writeFileSync(join(rootDir, "github-contributions-data.js"), output, "utf8");
  console.log(`Generated github-contributions-data.js with ${data.total} contributions.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
