// scripts/exportAllFiles.js

const fs = require("fs");
const path = require("path");

const TARGET_DIRS = ["app", "lib", "components"];
const OUTPUT_DIR = "./scripts/projectfile_text";
const TARGET_EXT = [".ts", ".tsx",".css"];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isTargetFile(fileName) {
  return TARGET_EXT.some((ext) => fileName.endsWith(ext));
}

function getAllFiles(dir, base = "") {
  const current = path.join(dir, base);
  const entries = fs.readdirSync(current, { withFileTypes: true });

  let results = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const relativePath = path.join(base, entry.name);
    const fullPath = path.join(dir, relativePath);

    if (entry.isDirectory()) {
      results = results.concat(getAllFiles(dir, relativePath));
    } else {
      if (isTargetFile(entry.name)) {
        results.push({
          original: `${dir}/${relativePath}`,
          fullPath,
        });
      }
    }
  }

  return results;
}

function buildTree(dir, prefix = "") {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."));

  let result = "";

  entries.forEach((entry, index) => {
    const isLast = index === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const child = buildTree(
        fullPath,
        prefix + (isLast ? "    " : "│   ")
      );

      if (child.trim() !== "") {
        result += `${prefix}${connector}${entry.name}/\n`;
        result += child;
      }
    } else {
      if (isTargetFile(entry.name)) {
        result += `${prefix}${connector}${entry.name}\n`;
      }
    }
  });

  return result;
}

function toSafeFileName(filePath) {
  return filePath.replace(/[\/\\]/g, "__");
}

function main() {
  ensureDir(OUTPUT_DIR);

  let allOutput = "";
  let treeOutput = "■ フォルダ構成（.ts/.tsxのみ）\n\n";

  // ===== ツリー作成 =====
  TARGET_DIRS.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    treeOutput += `${dir}/\n`;
    treeOutput += buildTree(dir);
    treeOutput += "\n";
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "tree.txt"),
    treeOutput,
    "utf-8"
  );

  // ===== ファイル処理 =====
  TARGET_DIRS.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    const files = getAllFiles(dir);

    files.forEach((file) => {
      try {
        const content = fs.readFileSync(file.fullPath, "utf-8");

        const header =
          "====================\n" +
          `FILE: ${file.original}\n` +
          "====================\n\n";

        // ===== ALL版 =====
        allOutput += header + content + "\n\n";

        // ===== 分割版 =====
        const safeName = toSafeFileName(file.original);

        fs.writeFileSync(
          path.join(OUTPUT_DIR, `${safeName}.txt`),
          header + content,
          "utf-8"
        );

      } catch (err) {
        console.error("❌ 読み込み失敗:", file.original);
      }
    });
  });

  // ===== ALL出力 =====
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "ALL.txt"),
    allOutput,
    "utf-8"
  );

  console.log("✅ 完了");
  console.log("・ALL.txt（統合）");
  console.log("・tree.txt（構造）");
  console.log("・分割ファイル（1ファイル1テキスト）");
}

main();