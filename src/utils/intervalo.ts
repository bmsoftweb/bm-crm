/**
 * setInterval das consultas periódicas ao servidor: com a aba visível, a cada `ms`; em segundo plano (aba
 * minimizada ou escondida), no máximo a cada `msOculto`, para as abas esquecidas abertas não gastarem a
 * Vercel. Ao voltar para a aba, atualiza na hora. Devolve a função de limpeza (para o return do useEffect).
 */
export function repetirConsulta(fn: () => void, ms: number, msOculto = 30_000): () => void {
  let ultima = Date.now();
  const rodar = () => {
    ultima = Date.now();
    fn();
  };
  const i = setInterval(() => {
    if (!document.hidden || Date.now() - ultima >= msOculto) rodar();
  }, ms);
  const aoVoltar = () => {
    if (!document.hidden && Date.now() - ultima >= ms) rodar();
  };
  document.addEventListener('visibilitychange', aoVoltar);
  return () => {
    clearInterval(i);
    document.removeEventListener('visibilitychange', aoVoltar);
  };
}
