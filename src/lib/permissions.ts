import type { SalonRole } from "./types";

/**
 * Espelho do que o banco permite (RLS). Serve para esconder menus e botões;
 * a garantia de verdade está nas policies.
 */
export type Feature =
  | "agenda"
  | "agenda.gerenciar"     // criar/remarcar/cancelar qualquer agendamento
  | "clientes"
  | "clientes.editar"
  | "servicos"
  | "servicos.editar"
  | "profissionais"
  | "profissionais.editar"
  | "equipe"
  | "configuracoes"
  | "comandas"
  | "comandas.cancelar_fechada"
  | "caixa"
  | "estoque"
  | "estoque.editar"         // cadastro de produto, ajuste e perda
  | "pacotes"
  | "pacotes.editar"
  | "comissoes"              // admin vê todas; profissional, as próprias
  | "comissoes.pagar"
  | "crm"
  | "automacoes"             // fila, campanhas e opt-out
  | "automacoes.editar"      // textos, liga/desliga e regras de envio
  | "dashboard"
  | "marketing"
  | "inteligencia"
  | "fidelidade"             // saldos, extrato e resgate na comanda
  | "fidelidade.editar"      // regras, prêmios e ajustes
  | "meu_painel";            // resultado do próprio profissional (o admin abre o de qualquer um pelo dashboard)

const MATRIX: Record<Feature, SalonRole[]> = {
  agenda: ["admin", "recepcao", "profissional"],
  "agenda.gerenciar": ["admin", "recepcao"],
  clientes: ["admin", "recepcao", "profissional"],
  "clientes.editar": ["admin", "recepcao"],
  servicos: ["admin", "recepcao"],
  "servicos.editar": ["admin"],
  profissionais: ["admin", "recepcao"],
  "profissionais.editar": ["admin"],
  equipe: ["admin"],
  configuracoes: ["admin"],
  comandas: ["admin", "recepcao"],
  "comandas.cancelar_fechada": ["admin"],
  caixa: ["admin", "recepcao"],
  estoque: ["admin", "recepcao"],
  "estoque.editar": ["admin"],
  pacotes: ["admin", "recepcao"],
  "pacotes.editar": ["admin"],
  comissoes: ["admin", "profissional"],
  "comissoes.pagar": ["admin"],
  crm: ["admin", "recepcao"],
  automacoes: ["admin", "recepcao"],
  "automacoes.editar": ["admin"],
  dashboard: ["admin"],
  marketing: ["admin"],
  inteligencia: ["admin"],
  fidelidade: ["admin", "recepcao"],
  "fidelidade.editar": ["admin"],
  meu_painel: ["profissional"],
};

export function can(role: SalonRole | null, feature: Feature): boolean {
  return role ? MATRIX[feature].includes(role) : false;
}
