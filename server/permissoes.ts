import { NextFunction, Request, Response } from 'express';
import { RESOURCES } from './schema.js';

/**
 * Permissões de acesso do usuário (usuarios.permissoes): as opções do menu que ele acessa, pelos
 * mesmos ids da barra lateral (src/utils/menu.ts). NULL = acessa tudo; administrador acessa tudo.
 */

/** Opções do menu que não são cadastros (Configurações fica fora: só administrador) */
const TELAS = ['dashboard', 'kanban', 'conversas', 'painel_suporte', 'chamados_fila', 'chamados_ativos', 'prospeccao'];

/** Opções só de administrador: não entram nas permissões */
const SO_ADMIN = ['usuarios', 'configuracoes'];

/** Ids que podem ser gravados: as telas e os cadastros do menu (menos os só de administrador) */
export const OPCOES_MENU = [...TELAS, ...RESOURCES.filter((r) => !r.oculto && r.name !== 'usuarios').map((r) => r.name)];

/** Lista gravada (JSON) → ids; null = sem restrição */
export function lerPermissoes(valor: unknown): string[] | null {
  if (valor == null) return null;
  try {
    const lista = typeof valor === 'string' ? JSON.parse(valor) : valor;
    return Array.isArray(lista) ? lista.map(String) : null;
  } catch {
    return null;
  }
}

/** Valor da tela → o que vai para o banco: só ids conhecidos, sem repetir; null = acessa tudo */
export function prepararPermissoes(valor: unknown): string[] | null {
  if (valor === null) return null;
  if (!Array.isArray(valor)) throw new Error('Permissões inválidas.');
  return [...new Set(valor.map(String))].filter((id) => OPCOES_MENU.includes(id));
}

/** O usuário acessa a opção do menu (mesma regra de podeAcessar em src/utils/menu.ts) */
export function podeAcessar(usuario: any, id: string): boolean {
  if (!usuario) return false;
  if (SO_ADMIN.includes(id)) return usuario.tipo === 'admin';
  if (usuario.tipo === 'admin') return true;
  const lista = lerPermissoes(usuario.permissoes);
  return !lista || lista.includes(id);
}

/** Importação de dados (do BM e de arquivo): só gerente e administrador (mesma regra em src/utils/menu.ts) */
export const podeImportar = (usuario: any): boolean => usuario?.tipo === 'admin' || usuario?.tipo === 'gerente';

/** Middleware das rotas de importação: recusa (403) quem não é gerente nem administrador */
export function exigirImportador(_req: Request, res: Response, next: NextFunction) {
  if (podeImportar(res.locals.usuario)) return next();
  res.status(403).json({ error: 'Somente gerentes importam dados.' });
}

/** Recusa (403) quem não tem acesso à opção */
export function exigirAcesso(res: Response, id: string, nome: string) {
  if (!podeAcessar(res.locals.usuario, id)) {
    throw Object.assign(new Error(`Você não tem permissão para acessar ${nome}. Fale com o administrador.`), { status: 403 });
  }
}
