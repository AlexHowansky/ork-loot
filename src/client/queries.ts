import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type {
  CampaignSummary,
  CampaignView,
  Me,
  PlayView,
  ReferenceMatch,
} from "../shared/types.ts";

export const keys = {
  me: ["me"] as const,
  campaigns: ["campaigns"] as const,
  campaign: (id: string) => ["campaign", id] as const,
  play: (id: string) => ["play", id] as const,
  reference: (id: string, q: string) => ["reference", id, q] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>("/api/auth/me") });

export const useCampaigns = () =>
  useQuery({ queryKey: keys.campaigns, queryFn: () => api.get<CampaignSummary[]>("/api/campaigns") });

export const useCampaign = (id: string) =>
  useQuery({ queryKey: keys.campaign(id), queryFn: () => api.get<CampaignView>(`/api/campaigns/${id}`) });

export const usePlay = (id: string) =>
  useQuery({
    queryKey: keys.play(id),
    queryFn: () => api.get<PlayView>(`/api/play/${id}`),
    // Other players claim things too; keep the pool fresh.
    refetchInterval: 15_000,
  });

/** Items on the campaign's reference site matching `q`. */
export const useReferenceSearch = (campaignId: string, q: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.reference(campaignId, q),
    queryFn: () =>
      api.get<ReferenceMatch[]>(`/api/campaigns/${campaignId}/reference?q=${encodeURIComponent(q)}`),
    enabled: enabled && q.length >= 2,
    staleTime: Infinity,
    retry: false,
  });

/** Refreshes everything that depends on campaign data. */
export function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
