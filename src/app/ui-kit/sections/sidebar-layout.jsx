'use client';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import { PreviewBlock } from '../preview';

export default function SidebarSection() {
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Workspace Layout Shell (Сайдбар + Мейн Контент)" description="Головний каркас інтерфейсу: лівий сайдбар окремим блоком та права біла контентна область із вбудованим WorkspaceHeader." filePath="src/components/WorkspaceSidebar.jsx" fullWidth>
        <div className="h-[550px] rounded-[24px] overflow-hidden flex bg-[#f5f5f5] w-full p-[12px] relative">
          {/* Left: Sidebar wrapper with exact layout.js paddings */}
          <div className="shrink-0 h-full flex pr-[6px]">
            <div className="h-full rounded-[24px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.02)] flex bg-[#1f1f1f]">
              <WorkspaceSidebar />
            </div>
          </div>

          {/* Right: Main content panel with header and child page area */}
          <div className="flex-1 h-full flex flex-col pl-[6px] overflow-hidden">
            <div className="flex flex-col flex-1 bg-white rounded-[24px] overflow-hidden relative">
              {/* Header inside the container */}
              <div className="border-b border-[#f0f0f0] bg-white z-10 shrink-0">
                <WorkspaceHeader />
              </div>

              {/* Main Content Area */}
              <div className="flex-1 p-[24px] overflow-y-auto bg-white flex flex-col gap-4">
                <div className="h-full border-2 border-dashed border-[#f0f0f0] rounded-[16px] flex items-center justify-center bg-[#fbfbfb]">
                  <span className="text-[#cfcfcf] font-bold text-[13px]">Main Work Area (Контентна зона)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PreviewBlock>
    </div>
  );
}
