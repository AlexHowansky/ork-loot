import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type { CampaignSummary, CampaignView, Me, PlayView } from "../shared/types.ts";

export const keys = {
  me: ["me"] as const,
  campaigns: ["campaigns"] as const,
  campaign: (id: number) => ["campaign", id] as const,
  play: (id: number) => ["play", id] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>("/api/auth/me") });

export const useCampaigns = () =>
  useQuery({ queryKey: keys.campaigns, queryFn: () => api.get<CampaignSummary[]>("/api/campaigns") });

export const useCampaign = (id: number) =>
  useQuery({ queryKey: keys.campaign(id), queryFn: () => api.get<CampaignView>(`/api/campaigns/${id}`) });

export const usePlay = (id: number) =>
  useQuery({
    queryKey: keys.play(id),
    queryFn: () => api.get<PlayView>(`/api/play/${id}`),
    // Other players claim things too; keep the pool fresh.
    refetchInterval: 15_000,
  });

/** Refreshes everything that depends on campaign data. */
export function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
