import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { keys, useCampaigns } from "../queries.ts";
import { LoadError, Loading } from "../components/Layout.tsx";
import { CampaignForm } from "../components/CampaignForm.tsx";
import { Money } from "../components/Money.tsx";
import { CampaignCover } from "../components/CampaignCover.tsx";
import { Icon, faCalendarDays, faPlus, faUsers } from "../components/Icon.tsx";

export function CampaignsPage() {
  const { data, error, isPending } = useCampaigns();
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (isPending) return <Loading />;
  if (error) return <LoadError error={error} />;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your campaigns</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon icon={faPlus} /> New campaign
        </button>
      </div>
      {data.length === 0 ? (
        <div className="card bg-base-100 shadow">
          <div className="card-body items-center text-center">
            <p>No campaigns yet. Create one to start tracking loot.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="card bg-base-100 shadow transition hover:shadow-lg">
              <CampaignCover image={c.backgroundImage} />
              <div className="card-body p-4">
                <h2 className="card-title">{c.name}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-base-content/70">
                  <span>
                    <Icon icon={faCalendarDays} /> {c.startDate}
                  </span>
                  <span>
                    <Icon icon={faUsers} /> {c.characterCount} characters
                  </span>
                  <span>{c.sessionCount} sessions</span>
                </div>
                <div className="text-sm">
                  Pool: <Money amount={c.poolTotal} campaign={c} className="font-semibold" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && (
        <CampaignForm
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            qc.invalidateQueries({ queryKey: keys.campaigns });
            navigate(`/campaigns/${id}`);
          }}
        />
      )}
    </div>
  );
}
