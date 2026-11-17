/** Bandera: URL de API-Football (imagen) o "emoji:XX" (datos de prueba). */
const SUB: Record<string, string> = {
  "GB-ENG": "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  "GB-SCT": "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
  "GB-WLS": "🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}",
};
export function emojiFlag(code: string): string {
  const c = code.toUpperCase();
  if (SUB[c]) return SUB[c];
  const two = c.slice(0, 2);
  return /^[A-Z]{2}$/.test(two) && two !== "EU" ? String.fromCodePoint(...[...two].map((x) => 127397 + x.charCodeAt(0))) : "🌍";
}
export default function Flag({ flag, title }: { flag?: string | null; title?: string }) {
  if (flag && /^https?:/.test(flag)) return <img className="flag" src={flag} alt="" title={title} loading="lazy" />;
  if (flag?.startsWith("emoji:")) return <span title={title}>{emojiFlag(flag.slice(6))}</span>;
  return <span title={title}>🌍</span>;
}
