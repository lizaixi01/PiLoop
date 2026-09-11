export function scopePath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === "*") return normalized;
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes(":") ||
    normalized.split("/").some((x) => x === ".." || x === "." || !x)
  )
    throw new Error("范围应是项目内的文件或目录，例如 index.html、styles 或 *");
  return normalized;
}
