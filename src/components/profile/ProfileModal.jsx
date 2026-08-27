import React, { useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Dialog, IconAction } from '@/components/ui';
import { X } from 'lucide-react';
import ProfileView from './ProfileView';
import { useTeamMembers } from '@/lib/hooks/useTeamMembers';

export default function ProfileModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const memberId = searchParams.get('member');
  const isOpen = !!memberId;

  const uids = useMemo(() => memberId ? [memberId] : [], [memberId]);
  const { members, loading } = useTeamMembers(uids);
  const user = members[0] || null;

  const handleClose = () => {
    // Remove 'member' from searchParams
    const params = new URLSearchParams(searchParams.toString());
    params.delete('member');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      className="overflow-hidden"
      bodyPadding="flush"
    >
      <div className="w-full h-[80vh] flex flex-col relative">
        {user ? (
          <ProfileView user={user} onClose={handleClose} />
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center bg-white">
             <div className="animate-spin w-8 h-8 border-4 border-ink border-t-transparent rounded-full"></div>
             <IconAction label="Закрити" icon={X} size="lg" appearance="surface-plain" shape="circle" onClick={handleClose} className="absolute top-4 right-4 z-10" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-white">
            <p className="text-muted">Користувача не знайдено</p>
             <IconAction label="Закрити" icon={X} size="lg" appearance="surface-plain" shape="circle" onClick={handleClose} className="absolute top-4 right-4 z-10" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
