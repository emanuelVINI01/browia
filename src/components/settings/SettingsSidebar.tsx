import type { LucideIcon } from "lucide-react";

export interface SettingsTabItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface SettingsSidebarProps {
  tabs: SettingsTabItem[];
  activeTab: string;
  onSelect: (tabId: string) => void;
}

export function SettingsSidebar({ tabs, activeTab, onSelect }: SettingsSidebarProps) {
  return (
    <nav className="flex sm:w-44 sm:flex-col gap-2 overflow-x-auto sm:overflow-visible border-b sm:border-b-0 sm:border-r border-[var(--theme-border)] pb-3 sm:pb-0 sm:pr-4 shrink-0">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={`flex min-w-max sm:min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-bold transition-all ${
              isActive
                ? "border-[var(--theme-primary)] bg-[rgba(214,168,79,0.14)] text-[var(--theme-primary-light)]"
                : "border-transparent bg-[var(--theme-surface-2)] text-[var(--theme-muted)] hover:border-[rgba(214,168,79,0.22)] hover:text-[var(--theme-text)]"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
