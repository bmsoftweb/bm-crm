import Dexie, { liveQuery, type Table } from 'dexie';
import { useEffect, useState } from 'react';

/**
 * App do técnico, offline-first: as OS ficam no IndexedDB do aparelho (Dexie). Cada alteração grava na hora
 * na OS local e entra numa fila; a fila vai para o servidor quando há sinal (server/os.ts, /api/os-tecnico).
 * A fila só sai do aparelho depois que o servidor aceitou: fechar o app ou ficar sem sinal não perde nada.
 */

export interface OS {
  id: number;
  numero: number;
  tipo: string;
  status: 'aberta' | 'em_execucao' | 'concluida' | 'cancelada';
  data_agendada: string | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  contato_nome: string | null;
  contato_telefone: string | null;
  endereco: string | null;
  servico_solicitado: string | null;
  servico_executado: string | null;
  inicio_em: string | null;
  fim_em: string | null;
  inicio_geo?: string | null;
  fim_geo?: string | null;
  /** Só a coletada aqui, até ir para o servidor (a do servidor não volta: basta saber que existe) */
  assinatura?: string | null;
  assinada: number | boolean;
  assinatura_nome: string | null;
  assinatura_documento: string | null;
  pessoa_nome: string;
  pessoa_cpf: string | null;
  pessoa_telefone: string | null;
  pessoa_whatsapp: string | null;
  /** Serviços feitos (lista inteira: o app manda a lista toda a cada mudança) */
  itens?: ItemOS[];
  /** O servidor recusou uma alteração desta OS (ex.: cancelada): a fila dela para até o técnico decidir */
  erro?: string | null;
}

export interface ItemOS {
  servico_id: number;
  quantidade: number | string;
  /** Do escritório (vêm do servidor e voltam como estão); lançado no app vai sem: vale o do cadastro */
  preco_unitario?: number | string | null;
  desconto?: number | string | null;
  servico_nome: string;
  unidade: string;
}

/** Catálogo de serviços ativos, para lançar sem sinal */
export interface Servico {
  id: number;
  codigo: string | null;
  nome: string;
  unidade: string;
}

export type Alteracao = Partial<
  Pick<OS, 'status' | 'servico_executado' | 'inicio_em' | 'fim_em' | 'inicio_geo' | 'fim_geo' | 'assinatura' | 'assinatura_nome' | 'assinatura_documento' | 'itens'>
>;

/** Foto de antes/depois. Até ir para o servidor, a imagem fica aqui (data URI); depois, só o endereço */
export interface Foto {
  uuid: string;
  osId: number;
  momento: 'antes' | 'depois';
  url?: string | null;
  imagem?: string | null;
  /** Já estava no servidor e o técnico tirou: sai de lá na próxima sincronização */
  remover?: boolean;
  criada: number;
}

interface Pendencia {
  seq?: number;
  osId: number;
  dados: Alteracao;
}

class Banco extends Dexie {
  os!: Table<OS, number>;
  fila!: Table<Pendencia, number>;
  fotos!: Table<Foto, string>;
  servicos!: Table<Servico, number>;
  constructor() {
    super('crmweb_tecnico');
    this.version(1).stores({ os: 'id', fila: '++seq, osId' });
    this.version(2).stores({ fotos: 'uuid, osId' });
    this.version(3).stores({ servicos: 'id' });
  }
}

export const db = new Banco();

/** Data e hora do aparelho (Brasília), no formato do MySQL — nunca toISOString() */
export function agora(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * "lat,lng" do aparelho; sem permissão, sem sinal de GPS ou demorando, segue sem (null). O timeout do navegador
 * não conta enquanto o pedido de permissão está na tela: o relógio próprio garante que o técnico não fica preso.
 */
export function localizacao(): Promise<string | null> {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    setTimeout(() => ok(null), 12000);
    navigator.geolocation.getCurrentPosition(
      (p) => ok(`${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)}`),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

/** Grava na OS local e põe na fila (as duas coisas ou nenhuma) */
export async function alterar(osId: number, dados: Alteracao) {
  await db.transaction('rw', db.os, db.fila, async () => {
    await db.os.update(osId, { ...dados, ...('assinatura' in dados ? { assinada: Boolean(dados.assinatura) } : {}) });
    await db.fila.add({ osId, dados });
  });
}

/** Reduz a foto da câmera (1600 px no lado maior, JPEG): de 4 MB para uns 300 KB, cabe no aparelho e no envio */
// createImageBitmap, não Image.decode(): o decode não termina com a página em segundo plano (câmera aberta)
export async function reduzirFoto(arquivo: File): Promise<string> {
  const img = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  try {
    const fator = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * fator);
    canvas.height = Math.round(img.height * fator);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    img.close();
  }
}

export async function adicionarFoto(osId: number, momento: Foto['momento'], imagem: string) {
  await db.fotos.add({ uuid: crypto.randomUUID(), osId, momento, imagem, criada: Date.now() });
}

/** Ainda não enviada: some daqui. Já no servidor: marcada para sair de lá */
export async function removerFoto(f: Foto) {
  if (f.url) await db.fotos.update(f.uuid, { remover: true });
  else await db.fotos.delete(f.uuid);
}

/** Desiste do que está na fila da OS (depois de o servidor recusar); a próxima sincronização traz a do servidor */
export async function descartar(osId: number) {
  await db.transaction('rw', db.os, db.fila, db.fotos, async () => {
    await db.fila.where('osId').equals(osId).delete();
    await db.fotos.where('osId').equals(osId).filter((f) => !f.url).delete();
    await db.fotos.where('osId').equals(osId).modify({ remover: false });
    await db.os.update(osId, { erro: null });
  });
}

export async function limparTudo() {
  await db.transaction('rw', db.os, db.fila, db.fotos, db.servicos, async () => {
    await db.os.clear();
    await db.fila.clear();
    await db.fotos.clear();
    await db.servicos.clear();
  });
}

export class SessaoExpirada extends Error {}

let emAndamento: Promise<void> | null = null;

/**
 * Envia a fila e depois baixa as OS do técnico. Sem sinal, para no primeiro envio que falhar (tenta de novo
 * depois). Recusa do servidor (4xx) trava só a fila daquela OS, com o motivo na própria OS.
 */
export function sincronizar(token: string): Promise<void> {
  emAndamento ??= (async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const travadas = new Set<number>();
    /** Manda um pedido da OS; null = recusado (a OS fica com o motivo e a fila dela para) */
    const enviar = async (osId: number, caminho: string, method: string, corpo?: unknown): Promise<any> => {
      if (travadas.has(osId) || (await db.os.get(osId))?.erro) {
        travadas.add(osId);
        return null;
      }
      const r = await fetch(`/api/os-tecnico/${osId}${caminho}`, {
        method,
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      if (r.status === 401) throw new SessaoExpirada('Sessão expirada. Entre novamente.');
      if (r.status >= 500) throw new Error((await r.json().catch(() => ({})))?.error || `Servidor indisponível (HTTP ${r.status}).`);
      const resposta = await r.json().catch(() => ({}));
      if (!r.ok) {
        await db.os.update(osId, { erro: resposta?.error || `Recusado (HTTP ${r.status}).` });
        travadas.add(osId);
        return null;
      }
      return resposta;
    };

    for (const p of await db.fila.orderBy('seq').toArray()) {
      if (await enviar(p.osId, '', 'POST', p.dados)) await db.fila.delete(p.seq!);
    }
    // Fotos depois das alterações, uma por vez (cada uma tem uns 300 KB)
    for (const f of (await db.fotos.toArray()).sort((a, b) => a.criada - b.criada)) {
      if (f.remover) {
        if (await enviar(f.osId, `/fotos/${f.uuid}`, 'DELETE')) await db.fotos.delete(f.uuid);
      } else if (!f.url && f.imagem) {
        const r = await enviar(f.osId, '/fotos', 'POST', { uuid: f.uuid, momento: f.momento, imagem: f.imagem });
        if (r) await db.fotos.update(f.uuid, { url: r.url, imagem: null });
      }
    }

    const r = await fetch('/api/os-tecnico', { headers: auth });
    if (r.status === 401) throw new SessaoExpirada('Sessão expirada. Entre novamente.');
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Falha ao baixar as OS (HTTP ${r.status}).`);
    const cat = await fetch('/api/os-tecnico-servicos', { headers: auth });
    if (cat.ok) {
      const servicos: Servico[] = await cat.json();
      await db.transaction('rw', db.servicos, async () => {
        await db.servicos.clear();
        await db.servicos.bulkPut(servicos);
      });
    }

    const recebidas: (OS & { fotos: { uuid: string; momento: Foto['momento']; url: string }[] })[] = await r.json();
    const doServidor: OS[] = recebidas.map(({ fotos, ...o }) => o);

    // A do servidor, com o que ainda está na fila por cima (assim nada digitado aqui some)
    await db.transaction('rw', db.os, db.fila, db.fotos, async () => {
      // Fotos: as do servidor, mais as daqui que ainda não foram (ou que vão sair de lá)
      const fotosLocais = new Map((await db.fotos.toArray()).map((f) => [f.uuid, f]));
      const noServidor = recebidas.flatMap((o) => o.fotos.map((f) => ({ ...f, osId: o.id })));
      const uuids = new Set(noServidor.map((f) => f.uuid));
      await db.fotos.bulkDelete([...fotosLocais.values()].filter((f) => f.url && !uuids.has(f.uuid)).map((f) => f.uuid));
      await db.fotos.bulkPut(
        noServidor.map((f) => ({ ...f, remover: fotosLocais.get(f.uuid)?.remover ?? false, criada: fotosLocais.get(f.uuid)?.criada ?? 0 })),
      );

      const fila = await db.fila.orderBy('seq').toArray();
      const comFila = new Set(fila.map((p) => p.osId));
      const ids = new Set(doServidor.map((o) => o.id));
      const locais = await db.os.toArray();
      await db.os.bulkDelete(locais.filter((o) => !ids.has(o.id) && !comFila.has(o.id)).map((o) => o.id));
      const erros = new Map(locais.map((o) => [o.id, o.erro]));
      await db.os.bulkPut(
        doServidor.map((o) =>
          fila
            .filter((p) => p.osId === o.id)
            .reduce<OS>((os, p) => ({ ...os, ...p.dados, ...('assinatura' in p.dados ? { assinada: Boolean(p.dados.assinatura) } : {}) }), {
              ...o,
              erro: comFila.has(o.id) ? erros.get(o.id) ?? null : null,
            }),
        ),
      );
    });
  })().finally(() => (emAndamento = null));
  return emAndamento;
}

/** Resultado de uma consulta ao Dexie que se atualiza sozinho quando os dados mudam */
export function useConsulta<T>(consulta: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [valor, setValor] = useState<T>();
  useEffect(() => {
    const s = liveQuery(consulta).subscribe({ next: setValor, error: (e) => console.error(e) });
    return () => s.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return valor;
}
