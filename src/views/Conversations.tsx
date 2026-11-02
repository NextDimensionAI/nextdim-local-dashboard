import { useInfiniteQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { api, type ConversationRow, type Page } from "../api";
import { TableSkeletonRows } from "../components/Skeleton";
import { UrgencyChip } from "../components/UrgencyChip";
import { duration, humanize, personName, when } from "../format";
import { navigate } from "../router";
import { isUnfinished, UNFINISHED_POLL_MS } from "../useLiveStream";

const PAGE_SIZE = 40;

export function Conversations({ tenant }: { tenant: string }) {
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());

  const list = useInfiniteQuery({
    queryKey: ["conversations", tenant, query],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), with_count: "false" });
      if (pageParam) params.set("cursor", pageParam);
      if (query) params.set("q", query);
      return api<Page<ConversationRow>>(`/v1/conversations?${params}`, tenant);
    },
    getNextPageParam: (last) => last.next_cursor || undefined,
    staleTime: 15_000,
    refetchInterval: (q) => {
      const now = Date.now();
      return q.state.data?.pages.some((page) => page.items.some((row) => isUnfinished(row, now))) ? UNFINISHED_POLL_MS : false;
    },
  });

  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section>
      <header className="page-head">
        <h1>Conversations</h1>
        <input
          className="search"
          type="search"
          placeholder="Search name, phone or ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </header>

      {list.isError ? <p className="error">{String(list.error)}</p> : null}
      {!list.isPending && rows.length === 0 && !list.isError ? <p className="muted pad">No conversations.</p> : null}

      {rows.length || list.isPending ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Caller</th>
                <th>Agent</th>
                <th>Started</th>
                <th className="num">Length</th>
                <th>Intent</th>
                <th>Status</th>
                <th>Urgency</th>
                <th>Flags</th>
                <th className="num">Tasks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ConversationRowView key={row.id} row={row} />
              ))}
              {list.isPending ? <TableSkeletonRows rows={12} /> : null}
              {list.isFetchingNextPage ? <TableSkeletonRows rows={4} /> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {list.hasNextPage && !list.isFetchingNextPage ? (
        <button className="more" onClick={() => list.fetchNextPage()}>
          Load more
        </button>
      ) : null}
    </section>
  );
}

function ConversationRowView({ row }: { row: ConversationRow }) {
  const agents = row.agents_display_names?.length ? row.agents_display_names : [row.agent_display_name ?? ""];
  const open = () => navigate(`/c/${row.id}`);
  return (
    <tr className="clickable" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
      <td>
        <strong>{personName(row)}</strong>
        {row.phone_number ? <div className="muted small">{row.phone_number}</div> : null}
      </td>
      <td>{agents.filter(Boolean).map(humanize).join(" → ") || "—"}</td>
      <td className="nowrap">{when(row.call_start_time)}</td>
      <td className="num nowrap">{duration(row.call_duration)}</td>
      <td>{row.primary_intent ?? "—"}</td>
      <td>{row.call_status ? <span className={`chip status-${row.call_status}`}>{humanize(row.call_status)}</span> : "—"}</td>
      <td>{row.urgency ? <UrgencyChip urgency={row.urgency} /> : "—"}</td>
      <td>
        <div className="chips">
          {row.channel_direction === "outbound" ? <span className="chip">Outbound</span> : null}
          {row.abrupt_end ? <span className="chip">Abrupt end</span> : null}
          {row.escalation_requested ? <span className="chip warn">Escalation</span> : null}
        </div>
      </td>
      <td className="num">{row.tasks_count ? <span className="badge">{row.tasks_count}</span> : <span className="muted">0</span>}</td>
    </tr>
  );
}
