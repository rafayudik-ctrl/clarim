/**
 * Une os blocos de comentários com exatamente três linhas em branco
 * entre eles (quatro quebras de linha consecutivas).
 */
export function formatCommentsExport(blocks) {
  return blocks.join("\n\n\n\n");
}
