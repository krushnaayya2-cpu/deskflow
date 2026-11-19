// Small inline icons for the convert menu.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const s = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, ...P };
  switch (name) {
    case "image":
      return <svg {...s}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></svg>;
    case "pdf":
      return <svg {...s}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M8.5 15.5h1a1.5 1.5 0 0 0 0-3h-1v5M13 12.5v5h1a2.5 2.5 0 0 0 0-5z" /></svg>;
    case "doc":
      return <svg {...s}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M8 13h8M8 17h6" /></svg>;
    case "video":
      return <svg {...s}><rect x="3" y="5" width="13" height="14" rx="2" /><path d="m16 10 5-3v10l-5-3" /></svg>;
    case "audio":
      return <svg {...s}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
    case "compress":
      return <svg {...s}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>;
    case "merge":
      return <svg {...s}><path d="M8 3v5a4 4 0 0 0 4 4 4 4 0 0 1 4 4v5M16 3v5a4 4 0 0 1-4 4" /></svg>;
    case "close":
      return <svg {...s}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case "check":
      return <svg {...s}><path d="m5 12 5 5L20 7" /></svg>;
    case "download":
      return <svg {...s}><path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14" /></svg>;
    case "convert":
      return <svg {...s}><path d="M4 7h13l-3-3M20 17H7l3 3" /></svg>;
    case "alert":
      return <svg {...s}><path d="M12 8v5M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>;
    default:
      return <svg {...s}><circle cx="12" cy="12" r="8" /></svg>;
  }
}
