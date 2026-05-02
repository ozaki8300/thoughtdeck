// scripts/exportAllFiles.js

const fs = require("fs");
const path = require("path");

// ===== 設定 =====
const TARGET_DIRS = ["app", "lib", "components"];
const OUTPUT_DIR = "./scripts/projectfile_text";
const TARGET_EXT = [".ts", ".tsx"];

// ===== ディレクトリ作成 =====
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ===== 拡張子判定 =====
function isTargetFile(fileName) {
  return TARGET_EXT.some((ext) => fileName.endsWith(ext));
}

// ===== ファイル名変換 =====
function toSafeName(filePath) {
  return filePath.replace(/\//g, "__") + ".txt";
}

// ===== 全ファイル取得 =====
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

// ===== ツリー構造生成（見やすい版） =====
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

// ===== メイン処理 =====
function main() {
  ensureDir(OUTPUT_DIR);

  // ====================
  // ① フォルダ構成出力
  // ====================
  let structure = "■ フォルダ構成（.ts/.tsxのみ）\n\n";

  TARGET_DIRS.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      structure += `❌ ${dir} not found\n`;
      return;
    }

    structure += `${dir}/\n`;
    structure += buildTree(dir);
    structure += "\n";
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "folder_structure.txt"),
    structure,
    "utf-8"
  );

  // ====================
  // ② 各ファイルを個別に出力
  // ====================
  TARGET_DIRS.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    const files = getAllFiles(dir);

    files.forEach((file) => {
      try {
        const content = fs.readFileSync(file.fullPath, "utf-8");

        const outputFileName = toSafeName(file.original);
        const outputPath = path.join(OUTPUT_DIR, outputFileName);

        const output =
          `====================\n` +
          `FILE: ${file.original}\n` +
          `====================\n\n` +
          content;

        fs.writeFileSync(outputPath, output, "utf-8");
      } catch (err) {
        console.error("❌ 読み込み失敗:", file.original);
      }
    });
  });

  console.log("✅ 完了");
  console.log(`📁 出力先: ${OUTPUT_DIR}`);
}

// ===== 実行 =====
main();