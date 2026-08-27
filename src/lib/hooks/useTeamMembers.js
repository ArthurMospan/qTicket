'use client';

// src/lib/hooks/useTeamMembers.js — Fetch user profiles for a list of UIDs
import { useMemo } from 'react';
import { useOrganization } from '@/lib/hooks/useOrganization';
export function useTeamMembers(teamUids) {
  const { members: organizationMembers, loading } = useOrganization();
  const key = teamUids?.join(',') ?? '';
  const members = useMemo(() => {
    if (!key) return [];
    const uids = new Set(key.split(','));
    return organizationMembers.filter(member => uids.has(member.id || member.uid));
  }, [key, organizationMembers]);
  return {
    members,
    loading
  };
}
