import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePortal } from "@/contexts/portal-context";
import { toast } from "sonner";

export function PortalSwitcher({ compact = false }: { compact?: boolean }) {
  const { portal, portals, setPortalId } = usePortal();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent/60 transition-colors"
          aria-label="Switch portal"
        >
          {!compact && (
            <>
              <span className="flex flex-col items-start leading-tight">
                <span className="text-sm font-semibold text-foreground">{portal.name}</span>
                <span className="text-[10px] text-muted-foreground">{portal.shortCode}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch Portal</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {portals.map((p) => {
          const isActive = p.id === portal.id;
          return (
            <DropdownMenuItem
              key={p.id}
              onClick={() => {
                if (!isActive) {
                  setPortalId(p.id);
                  toast.success(`Switched to ${p.name}`);
                }
              }}
              className={`flex items-center gap-2 cursor-pointer ${isActive ? "bg-accent/60 font-medium" : ""}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-border">
                <img src={p.emblem} alt="" className="h-full w-full object-contain" />
              </span>
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: p.primaryHex }}
                aria-hidden
              />
              <span className="flex-1 truncate">{p.name}</span>
              {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
