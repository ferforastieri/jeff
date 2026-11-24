import type { IconName } from "faang-ui";

export interface AgentRole {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  /** The face's colour on the cargo list and on the card. */
  color: string;
  title: string;
  persona: string;
}

export interface AgentRoleGroup {
  id: string;
  label: string;
  icon: IconName;
  roles: AgentRole[];
}

const role = (
  id: string,
  label: string,
  description: string,
  icon: IconName,
  color: string,
): AgentRole => ({
  id,
  label,
  description,
  icon,
  color,
  title: label,
  persona: `Você é ${label} do time. ${description} Trabalhe com autonomia, peça contexto quando faltar e confirme antes de ações arriscadas.`,
});

/** The agent cargos of the reference's new-agent step, grouped as its role picker. */
export const AGENT_ROLE_GROUPS: AgentRoleGroup[] = [
  {
    id: "tech",
    label: "Tecnologia",
    icon: "code",
    roles: [
      role("dev", "Dev", "Escreve e revisa código, abre PRs e cuida do repositório.", "code", "#3B82F6"),
      role("ops", "Ops", "Monitora incidentes, infraestrutura e alertas.", "bolt", "#F59E0B"),
      role("qa", "QA", "Testa, reproduz bugs e acompanha a qualidade.", "checks", "#10B981"),
      role("pm", "PM", "Organiza roadmap, issues e especificações.", "issues", "#8B5CF6"),
    ],
  },
  {
    id: "customers",
    label: "Clientes",
    icon: "members",
    roles: [
      role("support", "Suporte", "Responde clientes e organiza atendimentos.", "message", "#06B6D4"),
      role("sales", "Vendas", "Cuida de leads, propostas e pipeline.", "coin", "#F97316"),
      role("marketing", "Marketing", "Campanhas, growth e lançamentos.", "globe", "#EC4899"),
      role("content", "Conteúdo", "Escreve, edita e publica conteúdo.", "edit", "#14B8A6"),
    ],
  },
  {
    id: "operations",
    label: "Operações",
    icon: "chart",
    roles: [
      role("data", "Dados", "Consulta dados, métricas e relatórios.", "chart", "#6366F1"),
      role("finance", "Financeiro", "Acompanha pagamentos, cobranças e números.", "wallet", "#22C55E"),
      role("people", "Pessoas", "Ajuda com time, contratação e pessoas.", "members", "#E11D48"),
      role("research", "Pesquisa", "Pesquisa referências e organiza insights.", "search", "#0EA5E9"),
      role("assistant", "Assistente", "Agenda, lembretes e tarefas do dia a dia.", "calendar", "#A855F7"),
      role("custom", "Do zero", "Um agente sem ponto de partida, com as suas instruções.", "plus", "#64748B"),
    ],
  },
];

/** The cargo currently chosen, if any (`custom` is the "do zero" row). */
export function agentRoleById(id: string): AgentRole | undefined {
  for (const group of AGENT_ROLE_GROUPS) {
    const found = group.roles.find((role) => role.id === id);
    if (found) return found;
  }
  return undefined;
}
