import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, getTenant, setTenant, type Page } from "./api";
import { humanize } from "./format";
import { TenantMenu, type TenantOption } from "./components/TenantMenu";
import { useRoute } from "./router";
import { liveCount, useLiveStream } from "./useLiveStream";
import { useNow } from "./useNow";
import { ConversationDetail } from "./views/ConversationDetail";
import { Conversations } from "./views/Conversations";
import { Live } from "./views/Live";

interface TenantRow {
  tenantId?: string;
  tenant_id?: string;
  id?: string;
  slug?: string;
  displayName?: string;
  display_name?: string;
}

export function App() {
  const route = useRoute();
  const [tenant, setTenantState] = useState(getTenant);
  const tenants = useQuery({
    queryKey: ["tenants"],
    queryFn: () => api<Page<TenantRow> | TenantRow[]>("/v1/tenants", tenant),
    staleTime: Infinity,
  });
  const tenantOptions = tenantRows(tenants.data);
  const stream = useLiveStream(tenant);
  const liveCalls = liveCount(stream.calls, useNow(30_000));

  const switchTenant = (next: string) => {
    setTenant(next);
    setTenantState(next);
  };

  const detailId = route.startsWith("/c/") ? decodeURIComponent(route.slice(3)) : null;

  return (
    <div className="app">
      <nav className="nav">
        <span className="brand">NextDim</span>
        <a className={route === "/" || detailId ? "on" : ""} href="#/">Conversations</a>
        <a className={`nav-live ${route === "/live" ? "on" : ""}`} href="#/live">
          Live
          {liveCalls ? (
            <span className="badge live-badge" aria-label={`${liveCalls} live`}>
              {liveCalls}
            </span>
          ) : null}
        </a>
        <div className="nav-end">
          <TenantMenu
            value={tenant}
            options={(tenantOptions.some((o) => o.id === tenant) ? tenantOptions : [{ id: tenant, label: tenantLabel(tenant) }, ...tenantOptions])}
            onChange={switchTenant}
          />
        </div>
      </nav>
      <main className="content">
        {route === "/live" ? <Live tenant={tenant} stream={stream} /> : detailId ? <ConversationDetail key={`${tenant}/${detailId}`} tenant={tenant} id={detailId} /> : <Conversations tenant={tenant} />}
      </main>
    </div>
  );
}

function tenantRows(data: Page<TenantRow> | TenantRow[] | undefined): TenantOption[] {
  const rows = Array.isArray(data) ? data : (data?.items ?? []);
  return rows
    .map((row) => {
      const id = row.tenantId ?? row.tenant_id ?? row.slug ?? row.id ?? "";
      const name = row.displayName ?? row.display_name ?? "";
      return { id, label: name && name.toLowerCase() !== id.toLowerCase() ? name : tenantLabel(id) };
    })
    .filter((option) => option.id)
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Short tenant slugs are acronyms (NYGA, MDP); longer ones read as words.
function tenantLabel(slug: string): string {
  return slug.length <= 4 ? slug.toUpperCase() : humanize(slug);
}
