import {
  BarChart3,
  LayoutDashboard,
  KanbanSquare,
  Handshake,
  CalendarCheck,
  History,
  FileSignature,
  ShoppingCart,
  Building2,
  Users,
  Package,
  Layers,
  CreditCard,
  Filter,
  Columns3,
  KeyRound,
  ListOrdered,
  Tags,
  Network,
  Megaphone,
  ScrollText,
  Target,
  MessageSquareText,
  MessageCircle,
  Send,
  Star,
  Settings,
  Inbox,
  Headset,
  Database,
  ClipboardCheck,
  Radar,
  MessagesSquare,
  Globe,
  Wrench,
  Hammer,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import { ResourceDef, ResourceGroup, Usuario } from '../types';
import { GROUP_LABELS } from './formatters';

/** Mapa dos ícones declarados no registro de metadados do servidor */
const ICONS: Record<string, LucideIcon> = {
  Handshake,
  CalendarCheck,
  History,
  FileSignature,
  ShoppingCart,
  Building2,
  Users,
  Package,
  Layers,
  CreditCard,
  Filter,
  Columns3,
  KeyRound,
  ListOrdered,
  Tags,
  Network,
  Megaphone,
  ScrollText,
  Target,
  MessageSquareText,
  Send,
  Star,
  Globe,
  Wrench,
  Hammer,
  Receipt,
  ClipboardCheck,
};

const GROUP_ORDER: ResourceGroup[] = ['vendas', 'marketing', 'cadastros', 'acesso'];

/** Cadastros que aparecem na Visão Geral em vez do grupo deles */
const NA_VISAO_GERAL = ['atividades'];

export interface ItemMenu {
  id: string;
  label: string;
  descricao: string;
  icone: LucideIcon;
  /** Só administrador: aparece no menu dele, mas não entra nas permissões */
  somenteAdmin?: boolean;
}

/** Opções só de administrador (mesma lista de SO_ADMIN em server/permissoes.ts) */
const SO_ADMIN = ['usuarios', 'configuracoes'];

/**
 * Opções do menu, agrupadas como na barra lateral. É a mesma lista das permissões do usuário
 * (Usuários › Permissões): o id de cada opção é o que fica gravado em usuarios.permissoes.
 * Usuários fica de fora: é só para administradores, que acessam tudo.
 */
export function gruposDoMenu(resources: ResourceDef[]): { titulo: string; itens: ItemMenu[] }[] {
  const grupos = [
    {
      titulo: 'Visão Geral',
      itens: [
        { id: 'dashboard', label: 'Painel de Vendas', descricao: 'Indicadores do funil', icone: LayoutDashboard },
        { id: 'kanban', label: 'Funil de Vendas', descricao: 'Kanban dos negócios', icone: KanbanSquare },
        // Atividades/Tarefas: cadastro do grupo vendas, mas é o dia a dia de todos (vendas, suporte, pendências, Bot)
        ...resources
          .filter((r) => NA_VISAO_GERAL.includes(r.name) && !r.oculto)
          .map((r) => ({ id: r.name, label: r.label, descricao: r.description, icone: ICONS[r.icon] || Database })),
      ],
    },
    {
      titulo: 'Suporte',
      itens: [
        { id: 'painel_suporte', label: 'Painel de Suporte', descricao: 'Indicadores dos atendimentos', icone: BarChart3 },
        { id: 'chamados_fila', label: 'Fila de Chamados', descricao: 'Chamados aguardando atendimento', icone: Inbox },
        { id: 'conversas', label: 'Whatsapp', descricao: 'Mensagens do WhatsApp', icone: MessageCircle },
        { id: 'chamados_ativos', label: 'Chamados Ativos', descricao: 'Atendimento dos chamados', icone: Headset },
        // Cadastros do grupo suporte entram aqui, depois das telas (Templates foi para Cadastros)
        ...resources
          .filter((r) => r.group === 'suporte' && !r.oculto)
          .map((r) => ({ id: r.name, label: r.label, descricao: r.description, icone: ICONS[r.icon] || Database })),
      ],
    },
    ...GROUP_ORDER.map((group) => ({
      titulo: GROUP_LABELS[group] || group,
      itens: [
        // Prospecção abre o grupo Marketing, antes dos cadastros dele
        ...(group === 'marketing'
          ? [
              { id: 'prospeccao', label: 'Prospecção', descricao: 'Busca de leads no Google Maps', icone: Radar },
              { id: 'consultas', label: 'Consultas', descricao: 'Pergunte sobre os seus dados e veja o resultado em tabela', icone: MessagesSquare },
            ]
          : []),
        ...resources
          .filter((r) => r.group === group && !r.oculto && r.name !== 'usuarios' && !NA_VISAO_GERAL.includes(r.name))
          .map((r) => ({ id: r.name, label: r.label, descricao: r.description, icone: ICONS[r.icon] || Database })),
      ],
    })),
    { titulo: 'Sistema', itens: [{ id: 'configuracoes', label: 'Configurações', descricao: 'Preferências da empresa', icone: Settings, somenteAdmin: true }] },
  ];
  return grupos.filter((g) => g.itens.length);
}

/** Importação de dados (do BM e de arquivo): só gerente e administrador (mesma regra em server/permissoes.ts) */
export const podeImportar = (usuario: Usuario | null): boolean => usuario?.tipo === 'admin' || usuario?.tipo === 'gerente';

/** O usuário acessa a opção: administrador acessa tudo; sem permissões gravadas, também */
export function podeAcessar(usuario: Usuario | null, id: string): boolean {
  if (!usuario) return false;
  if (SO_ADMIN.includes(id)) return usuario.tipo === 'admin';
  if (usuario.tipo === 'admin' || !Array.isArray(usuario.permissoes)) return true;
  return usuario.permissoes.includes(id);
}
