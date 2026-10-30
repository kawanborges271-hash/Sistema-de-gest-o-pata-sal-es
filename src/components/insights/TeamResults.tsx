import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { SectionCard } from "@/components/common/SectionCard";
import { Delta } from "@/components/insights/shared";
import { useTeamReport } from "@/hooks/useInsights";
import { pct } from "@/lib/insights";
import { initials, money, num } from "@/lib/format";

/** Dashboard do dono: quanto cada pessoa faturou e quanto isso representa do salão. */
export function TeamResults({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useTeamReport(from, to);

  return (
    <SectionCard className="mt-6" title="Faturamento por colaborador"
      hint="Serviços e produtos que cada pessoa fez ou vendeu nas comandas fechadas, já com o desconto da comanda dividido entre os itens."
      bodyClassName="p-0 pb-2">
      {error && <p className="px-5 pb-4 text-sm text-destructive">Não foi possível carregar. Confira se a atualização 020 já rodou no banco.</p>}
      {isLoading && <div className="mx-5 mb-4 h-32 animate-pulse rounded-xl bg-muted" />}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-2 font-medium">Profissional</th>
                <th className="px-3 py-2 text-right font-medium">Faturou</th>
                <th className="w-44 px-3 py-2 font-medium">% do salão</th>
                <th className="px-3 py-2 text-right font-medium">Atendimentos</th>
                <th className="px-3 py-2 text-right font-medium">Ticket médio</th>
                <th className="px-3 py-2 text-right font-medium">Comparecimento</th>
                <th className="px-3 py-2 text-right font-medium">Comissão</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.professionals.map((r) => (
                <tr key={r.professional_id} className="border-b border-border last:border-0">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: r.color }}>{initials(r.name)}</span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground">{!r.active ? "inativo" : r.has_login ? "tem login" : "sem login"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="font-medium tabular-nums">{money(r.current.revenue)}</div>
                    <Delta current={r.current.revenue} previous={r.previous_revenue} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (r.share ?? 0) * 100)}%`, background: r.color }} />
                      </div>
                      <span className="w-12 text-right text-xs tabular-nums">{pct(r.share)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.current.attended)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(r.current.avg_ticket)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.current.attendance_rate)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="tabular-nums">{money(r.current.commissions)}</div>
                    <div className="text-[11px] text-muted-foreground">{pct(r.commission_share)} do que faturou</div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Link to={`/meu-painel?profissional=${r.professional_id}`} className="inline-flex items-center text-xs font-semibold hover:underline">
                      Painel <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
              {data.unassigned_revenue > 0.009 && (
                <tr className="border-b border-border text-muted-foreground last:border-0">
                  <td className="px-5 py-2.5">Sem profissional <span className="text-[11px]">(produtos e pacotes vendidos no balcão)</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(data.unassigned_revenue)}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{pct(data.revenue > 0 ? data.unassigned_revenue / data.revenue : null)}</td>
                  <td colSpan={5} />
                </tr>
              )}
              <tr className="bg-muted/40 font-medium">
                <td className="px-5 py-2.5">Salão inteiro</td>
                <td className="px-3 py-2.5 text-right">
                  <div className="tabular-nums">{money(data.revenue)}</div>
                  <Delta current={data.revenue} previous={data.previous_revenue} />
                </td>
                <td className="px-3 py-2.5 text-xs">100%</td>
                <td colSpan={5} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
