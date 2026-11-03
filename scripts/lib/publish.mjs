import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Troca `data/` de forma quase atômica: grava tudo num diretório temporário
 * e só então substitui. Se algo falhar, a versão anterior é preservada.
 */
export async function publishOutputs({ root = process.cwd(), manifest, files }) {
  const dataDir = resolve(root, "data");
  const stamp = `${process.pid}-${Date.now()}`;
  const tempRoot = resolve(root, `.data-build-${stamp}`);
  const tempData = resolve(tempRoot, "data");
  const previousDir = resolve(root, `.data-previous-${stamp}`);

  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempData, { recursive: true });

  try {
    for (const file of files) {
      const relativePath = safePath(file.path);
      const fullPath = resolve(tempRoot, relativePath);

      if (!isInside(tempRoot, fullPath)) {
        throw new Error(`Caminho inseguro: ${file.path}`);
      }

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, "utf8");
    }

    await writeFile(resolve(tempData, "manifest.json"), JSON.stringify(manifest), "utf8");

    let movedOld = false;
    let movedNew = false;

    try {
      try {
        await rename(dataDir, previousDir);
        movedOld = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      await rename(tempData, dataDir);
      movedNew = true;

      if (movedOld) {
        await rm(previousDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch (error) {
      if (!movedNew && movedOld) {
        await rename(previousDir, dataDir).catch(() => {});
      }
      throw error;
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function safePath(value) {
  if (typeof value !== "string" || value === "") {
    throw new Error("Caminho de saída vazio.");
  }

  const normalized = value.replaceAll("\\", "/");

  if (
    !normalized.startsWith("data/") ||
    normalized.includes("../") ||
    normalized.startsWith("/") ||
    normalized.includes("://")
  ) {
    throw new Error(`Caminho de saída inválido: ${value}`);
  }

  return normalized;
}

function isInside(parent, child) {
  return child === parent || child.startsWith(parent + sep);
}
