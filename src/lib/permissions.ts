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
  | "comissoes.pagar";

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
};

export function can(role: SalonRole | null, feature: Feature): boolean {
  return role ? MATRIX[feature].includes(role) : false;
}
