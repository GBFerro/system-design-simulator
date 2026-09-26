"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComponentPalette } from "./ComponentPalette";
import { ProblemSelector } from "./ProblemSelector";
import { LearningPath } from "./LearningPath";
import { useAppStore } from "@/store/appStore";

interface SidebarProps {
  open?: boolean;
  onCreateProblem?: () => void;
  onCreateCustomComponent?: () => void;
  /** Called after a component is added from the palette (closes the mobile drawer). */
  onComponentAdded?: () => void;
  variant?: "desktop" | "mobile";
}

function SidebarTabs({
  onCreateProblem,
  onCreateCustomComponent,
  onComponentAdded,
}: {
  onCreateProblem?: () => void;
  onCreateCustomComponent?: () => void;
  onComponentAdded?: () => void;
}) {
  const activeLeftTab = useAppStore((s) => s.activeLeftTab);
  const setActiveLeftTab = useAppStore((s) => s.setActiveLeftTab);
  return (
    <Tabs
      value={activeLeftTab}
      onValueChange={(v) => setActiveLeftTab(v as typeof activeLeftTab)}
      className="flex flex-1 flex-col min-h-0"
    >
      <TabsList className="mx-2 mt-2 h-9 w-auto shrink-0 bg-zinc-800">
        <TabsTrigger
          value="components"
          className="h-7 px-3 text-xs data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
        >
          Components
        </TabsTrigger>
        <TabsTrigger
          value="problems"
          className="h-7 px-3 text-xs data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
        >
          Problems
        </TabsTrigger>
        <TabsTrigger
          value="learn"
          className="h-7 px-3 text-xs data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
        >
          Learn
        </TabsTrigger>
      </TabsList>

      <TabsContent value="components" className="mt-0 flex-1 min-h-0 overflow-hidden">
        <ComponentPalette
          onCreateCustomComponent={onCreateCustomComponent}
          onComponentAdded={onComponentAdded}
        />
      </TabsContent>

      <TabsContent value="problems" className="mt-0 flex-1 min-h-0 overflow-hidden">
        <ProblemSelector onCreateProblem={onCreateProblem} />
      </TabsContent>

      <TabsContent value="learn" className="mt-0 flex-1 min-h-0 overflow-hidden">
        <LearningPath />
      </TabsContent>
    </Tabs>
  );
}

export function Sidebar({
  open = true,
  onCreateProblem,
  onCreateCustomComponent,
  onComponentAdded,
  variant = "desktop",
}: SidebarProps) {
  if (variant === "mobile") {
    return (
      <div className="flex h-full w-full flex-col bg-zinc-900">
        <SidebarTabs
          onCreateProblem={onCreateProblem}
          onCreateCustomComponent={onCreateCustomComponent}
          onComponentAdded={onComponentAdded}
        />
      </div>
    );
  }

  return (
    <aside
      className={`hidden shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 overflow-hidden transition-all duration-200 md:flex ${
        open ? "w-[280px] opacity-100" : "w-0 opacity-0 border-r-0"
      }`}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
    >
      <div className="flex w-[280px] flex-1 flex-col min-h-0">
        <SidebarTabs
          onCreateProblem={onCreateProblem}
          onCreateCustomComponent={onCreateCustomComponent}
        />
      </div>
    </aside>
  );
}
