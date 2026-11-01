import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface TenantOption {
  id: string;
  label: string;
}

interface TenantMenuProps {
  value: string;
  options: TenantOption[];
  onChange: (tenant: string) => void;
}

export function TenantMenu({ value, options, onChange }: TenantMenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(true);
  };

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const handleKey = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") setOpen(false);
    if (e.key === "ArrowDown") setActive((i) => Math.min(options.length - 1, i + 1));
    if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    if (e.key === "Enter" && options[active]) choose(options[active].id);
    if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) e.preventDefault();
  };

  return (
    <div className="menu" ref={root} onKeyDown={handleKey}>
      <button className="menu-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? setOpen(false) : openMenu())}>
        <span className="menu-label">Tenant</span>
        <span>{current?.label ?? value}</span>
        <svg className="menu-caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <ul className="menu-list" role="listbox" aria-label="Tenant">
          {options.map((option, i) => (
            <li
              key={option.id}
              role="option"
              aria-selected={option.id === value}
              className={`menu-item ${i === active ? "active" : ""} ${option.id === value ? "selected" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => (e.preventDefault(), choose(option.id))}
            >
              <span>{option.label}</span>
              {option.id === value ? <span className="menu-check" aria-hidden>✓</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
