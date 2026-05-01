export function getTitle(raw: string) {
  const line = raw
    .split("\n")
    .find(
      (l) => /^#[ \t\u3000]+/.test(l.trimEnd()) && !/^##/.test(l.trimStart()),
    );
  return line?.replace(/^#[ \t\u3000]+/, "").trim() || "タイトル未設定";
}
